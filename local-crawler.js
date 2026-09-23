const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const axios = require('axios');
const { LANGUAGES, DEFAULT_ENTRY_PATTERN } = require('./languages');

const CRAWLER_USER_AGENT = 'Mozilla/5.0 (compatible; SCPCrawler/2.0; Multi-Language)';
// 一部ページ（PLのlista-pl等）はクローラー系UAを503でブロックするため、
// pageConfig.browserUserAgent: true のページのみブラウザ相当のUAを使う
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/** 正規表現メタ文字をエスケープする */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * "リンクテキスト - タイトル" 形式のテキストからタイトル部分を抽出する。
 * 区切りはサイトによって - / – / — が使われる（PLは—、THの一部は–）。
 */
function titleAfterLink(text, linkText) {
  const match = text.match(new RegExp(escapeRegExp(linkText) + '\\s*[-–—]\\s*(.+)'));
  return match ? match[1].trim() : '';
}

/**
 * HTMLをJSDOMでパースしてfnを実行し、必ずwindowを閉じて返す。
 * 外部リソース（CSS/フォント/画像）は読み込まない。resources:'usable'指定や
 * close()忘れはサブリソースの取得・保持でメモリリークし、記事数の多いジョブが
 * OOMで落ちる（scp-series-koで発生）。パース箇所は必ずこのヘルパーを使うこと。
 */
function withDom(html, fn) {
  const dom = new JSDOM(html);
  try {
    return fn(dom.window.document);
  } finally {
    dom.window.close();
  }
}

/** SCP記事本文からオブジェクトクラス（支部ごとの表記を含む）を抽出する。 */
const OBJECT_CLASS_VALUE_PATTERN = /(?:Safe|Euclid|Keter|Thaumiel|Apollyon|Archon|Cernunnos|Ticonderoga|Explained|Neutralized|Decommissioned|Pending|Uncontained|無力化|説明済み|未収容|保留|廃止|アポリオン|タウミエル|アーコン)/gi;

function isStruckElement(element) {
  if (!element || element.nodeType !== 1) return false;
  const style = element.getAttribute('style') || '';
  const className = typeof element.className === 'string' ? element.className : '';
  return /^(del|s|strike)$/i.test(element.tagName)
    || /text-decoration(?:-line)?\s*:[^;]*line-through/i.test(style)
    || /(?:^|\s)(?:strike|strikethrough|line-through)(?:\s|$)/i.test(className);
}

function isStruckNode(node) {
  return node?.nodeType === 1 ? isStruckElement(node) : isStruckElement(node?.parentElement);
}

function textContentWithoutStruck(node) {
  if (isStruckNode(node)) return '';
  if (node?.nodeType === 1 && node.matches?.('.fnnum, .fncon, .footnoteref')) return '';
  const clone = node.cloneNode(true);
  clone.querySelectorAll?.('del, s, strike, [style*="line-through"], .strike, .strikethrough, .line-through, .fnnum, .fncon, .footnoteref')
    .forEach(element => element.remove());
  return clone.textContent || '';
}

function isObjectClassLabel(text, labelPattern) {
  const match = text.match(labelPattern);
  if (!match) return false;
  const before = text.slice(0, match.index).trim();
  const after = text.slice(match.index + match[0].length).replace(/[\s:：]/g, '');
  return !before && !after;
}

function selectCurrentObjectClass(value) {
  const normalized = value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  OBJECT_CLASS_VALUE_PATTERN.lastIndex = 0;
  const matches = [...normalized.matchAll(OBJECT_CLASS_VALUE_PATTERN)].map(match => ({ value: match[0], index: match.index }));
  if (!matches.length) {
    if (/^[A-Za-z][A-Za-z0-9 /_-]{0,40}$/.test(normalized) && !/^(?:s|d|t|r)$/i.test(normalized)) return normalized;
    return null;
  }
  if (matches[0].index > 0 && !/^[(:：\-\s]*$/.test(normalized.slice(0, matches[0].index))) return null;

  const canonical = new Map([
    ['safe', 'Safe'], ['euclid', 'Euclid'], ['keter', 'Keter'],
    ['thaumiel', 'Thaumiel'], ['apollyon', 'Apollyon'], ['archon', 'Archon'],
    ['cernunnos', 'Cernunnos'], ['ticonderoga', 'Ticonderoga'],
    ['explained', 'Explained'], ['neutralized', 'Neutralized'],
    ['decommissioned', 'Decommissioned'], ['pending', 'Pending'],
    ['uncontained', 'Uncontained'],
  ]);
  const last = matches[matches.length - 1];
  const between = normalized.slice(matches[0].index + matches[0].value.length, last.index);
  const selected = matches.length > 1 && between.length <= 40 && !/[.!?]/.test(between) ? last.value : matches[0].value;
  return canonical.get(selected.toLowerCase()) || selected;
}

function extractObjectClassFromDocument(document) {
  for (const valueElement of document.querySelectorAll('.class-text, .objclass .obj-text')) {
    if (isStruckNode(valueElement)) continue;
    const value = textContentWithoutStruck(valueElement).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    OBJECT_CLASS_VALUE_PATTERN.lastIndex = 0;
    if (value && OBJECT_CLASS_VALUE_PATTERN.test(value)) return selectCurrentObjectClass(value);
  }

  const labelPattern = /(?:object\s*class|containment\s*class|オブジェクトクラス|项目等级|項目等級|třída\s+objektu|klassifizierung|clasificación\s+del\s+objeto|classe(?:\s+dell?'oggetto|\s+do\s+objeto)?|klasa\s+podmiotu|ระดับ|клас\s+об'єкта|phân loại|객체\s*등급|개체\s*등급|등급)\s*[:：]?/i;

  // Wikidot記事の標準形式（<strong>ラベル:</strong> 値）を優先する。
  for (const label of document.querySelectorAll('strong, b')) {
    const labelText = label.textContent.replace(/\u00a0/g, ' ').trim();
    if (!isObjectClassLabel(labelText, labelPattern)) continue;

    let value = '';
    for (let node = label.nextSibling; node; node = node.nextSibling) {
      if (node.nodeType === 1 && /^(strong|b)$/i.test(node.tagName)) break;
      value += textContentWithoutStruck(node);
    }
    value = value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').replace(/^[:：]\s*/, '').trim();
    if (value) return selectCurrentObjectClass(value);
  }

  // strong要素を使わないページ向けのフォールバック。
  const selectors = 'p, li, td, th';

  for (const element of document.querySelectorAll(selectors)) {
    const text = textContentWithoutStruck(element).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    const match = text.match(new RegExp('^' + labelPattern.source, 'i'));
    if (!match) continue;
    if (!/[:：]/.test(match[0])) continue;

    const value = text.slice(match.index + match[0].length)
      .split(/\s+(?:object\s*class|special containment procedures?|description|项目等级|項目等級|třída objektu|klassifizierung|clasificación del objeto|classe|klasa podmiotu|ระดับ|клас об'єкта|phân loại|등급|격리 절차|특수 격리 절차|オブジェクトクラス)\s*[:：]/i)[0]
      .split(/[|;]/)[0]
      .trim();
    if (value) return selectCurrentObjectClass(value);
  }

  // EXTDOC/ACS形式など、アイテム番号の直後にクラスだけを置く記事向け。
  const content = (document.querySelector('#page-content') || document.body).textContent
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ');
  const itemMatch = content.match(/item\s*#\s*:?\s*(?:scp-)?\d+/i);
  if (itemMatch) {
    const header = content.slice(itemMatch.index, itemMatch.index + 180)
      .split(/special containment procedures|description/i)[0];
    OBJECT_CLASS_VALUE_PATTERN.lastIndex = 0;
    const matches = [...header.matchAll(OBJECT_CLASS_VALUE_PATTERN)].map(match => match[0]);
    if (matches.length) return selectCurrentObjectClass(matches.join(' '));
  }

  return null;
}

const DESCRIPTION_LABEL_PATTERN = /^(?:description|説明|描述|popis|beschreibung|descripción|descrizione|opis|설명|รายละเอียด|опис|mô tả)\s*[:：]?$/i;

const DESCRIPTION_TAG_RULES = [
  { tag: '人間型', pattern: /humanoid|human[- ]like|人型|人間型|인간형|гуманоид|человекоподоб|hình người|człekokształtn/i },
  { tag: '生物', pattern: /organism|creature|biological|animal|生物|생물|생명체|organismo|organisme|organismus|criatura|biologique|биолог|sinh vật/i },
  { tag: '物品', pattern: /artifact|artefact|device|item|物品|物体|装置|アイテム|물체|장치|artefacto|предмет|objeto|dispositivo/i },
  { tag: '伝染性', pattern: /infect|contag|pathogen|virus|disease|pandemic|感染|伝染|病原|ウイルス|감염|전염|바이러스|infecc|contagio|infekc|зараз|инфекц|truyền nhiễm/i },
  { tag: '知性', pattern: /sentient|sapient|intelligent|conscious|知性|知能|自我|知的|지성|지능|의식|разумн|сознатель|trí tuệ/i },
  { tag: '情報災害', pattern: /infohazard|cognitohazard|memetic|information hazard|情報災害|認識災害|ミーム|정보재해|인지재해|memético|memético|инфоопас|когнитивн|thông tin nguy hại/i },
  { tag: '精神影響', pattern: /mind[- ]affect|psycholog|mental|hallucin|精神|心理|幻覚|정신|심리|환각|психичес|галлюцин|tâm lý|ảo giác/i },
  { tag: '時間', pattern: /temporal|time[- ]based|時間|시공간|시간적|временн|thời gian/i },
  { tag: '空間', pattern: /spatial|dimension|extradimensional|portal|空間|異次元|차원|포털|пространств|измерени|không gian|chiều không gian/i },
  { tag: '機械', pattern: /mechanical|machine|robot|機械|ロボット|기계|로봇|механичес|робот|máy móc/i },
  { tag: '植物', pattern: /plant|flora|植物|식물|растени|thực vật/i },
  { tag: '液体', pattern: /liquid|fluid|液体|액체|líquido|liquide|жидк|chất lỏng/i },
];

function textContentPreservingBreaks(node) {
  if (node.nodeType === 3) return node.textContent || '';
  const clone = node.cloneNode(true);
  clone.querySelectorAll?.('br').forEach(br => br.replaceWith('\n'));
  return clone.textContent || '';
}

function normalizeDescriptionText(value) {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .trim();
}

function extractDescriptionAndTagsFromDocument(document) {
  let excerpt = '';
  let descriptionText = '';
  for (const label of document.querySelectorAll('strong, b, h1, h2, h3, h4, h5, h6')) {
    const labelText = label.textContent.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    if (!DESCRIPTION_LABEL_PATTERN.test(labelText)) continue;

    const parts = [];
    for (let node = label.nextSibling; node; node = node.nextSibling) {
      if (node.nodeType === 1 && /^(strong|b)$/i.test(node.tagName)) break;
      parts.push(node.nodeType === 1 && node.tagName.toLowerCase() === 'br'
        ? '\n'
        : textContentPreservingBreaks(node));
    }
    const heading = label.closest('h1, h2, h3, h4, h5, h6');
    const section = heading || label.parentElement;
    if (section) {
      let next = section.nextElementSibling;
      while (next && !/^H[1-6]$/i.test(next.tagName) && !next.querySelector('strong, b') && parts.join('').length < 10000) {
        parts.push('\n', textContentPreservingBreaks(next));
        next = next.nextElementSibling;
      }
    }
    const value = normalizeDescriptionText(parts.join('')
      .replace(/\u00a0/g, ' '))
      .replace(/^[:：]\s*/, '')
      .trim();
    if (value) {
      descriptionText = value;
      // バイト数ではなく、Unicodeコードポイント単位で冒頭500文字を保存する。
      excerpt = Array.from(value).slice(0, 500).join('');
      break;
    }
  }

  if (!excerpt) return { descriptionExcerpt: null, tags: [] };
  const tags = DESCRIPTION_TAG_RULES
    .filter(rule => rule.pattern.test(descriptionText))
    .map(rule => rule.tag);
  return { descriptionExcerpt: excerpt, tags };
}

/** pageTypeから支部コードを取り出す（国際版ページはnull） */
function branchCodeOf(pageType) {
  const match = pageType.match(/^scp-series-([a-z-]+)$/)
    || pageType.match(/^joke-scps-([a-z-]+)$/)
    || pageType.match(/^scp-([a-z-]+)-ex$/);
  return match ? match[1] : null;
}

/**
 * 番号バリアント記事用のitemId接尾辞をスラッグから作る。
 * pageTypeに既に含まれる支部コードはスラッグ側から取り除き、
 * 「joke-scps-cn-cn-001-x-j」のような二重化を防ぐ。
 */
function variantSlugPart(href, pageType) {
  let slug = href.replace(/^\//, '').replace(/^scp-/, '');
  const code = branchCodeOf(pageType);
  if (code) {
    if (slug.startsWith(`${code}-`)) {
      slug = slug.slice(code.length + 1);
    } else if (slug.endsWith(`-${code}`)) {
      slug = slug.slice(0, -(code.length + 1));
    } else {
      const middle = slug.indexOf(`-${code}-`);
      if (middle >= 0) {
        slug = slug.slice(0, middle) + slug.slice(middle + code.length + 1);
      }
    }
  }
  return slug;
}

/**
 * 収集したリンク候補からエントリ一覧を組み立てる。
 * - 同一URLの重複掲載は1件に統合（タイトルが取れている出現を優先）
 * - 同一番号の別記事（バリアント）は、最短スラッグ（＝正規記事）が基本番号IDを持ち、
 *   残りはスラッグ由来のIDになる。ページの記載順に依存しない決定的な割り当てのため、
 *   サイト側で一覧の並びが変わってもitemIdの帰属は揺れない。
 */
function buildEntries(candidates, pageConfig) {
  const byNumber = new Map();
  for (const candidate of candidates) {
    if (!byNumber.has(candidate.scpNumber)) byNumber.set(candidate.scpNumber, []);
    byNumber.get(candidate.scpNumber).push(candidate);
  }

  const entries = [];
  const usedIds = new Set();
  for (const [scpNumber, group] of byNumber) {
    const byHref = new Map();
    for (const candidate of group) {
      const existing = byHref.get(candidate.href);
      if (!existing || (!existing.title && candidate.title)) {
        byHref.set(candidate.href, candidate);
      }
    }

    const articles = [...byHref.values()].sort((a, b) =>
      a.href.length - b.href.length || a.href.localeCompare(b.href));

    articles.forEach((article, index) => {
      const itemId = index === 0
        ? `${pageConfig.pageType}-${scpNumber}`
        : `${pageConfig.pageType}-${variantSlugPart(article.href, pageConfig.pageType)}`;
      if (usedIds.has(itemId)) return;
      usedIds.add(itemId);
      entries.push({
        itemId: itemId,
        numericItemId: parseInt(scpNumber, 10),
        title: article.title,
        url: article.href,
        isUntranslated: article.isUnwritten,
        type: 'scp'
      });
    });
  }
  return entries;
}

/**
 * SCP Crawler（多言語対応版）
 * languages.jsの設定に基づき、指定言語の支部サイトから記事一覧を抽出する。
 * ローカル一括実行: node local-crawler.js [lang]  (省略時: jp)
 *
 * 出力フィールド名について:
 *   titleJP / urlJP / isTranslatedJP のJPは歴史的経緯による命名で、
 *   多言語化後は「選択言語（現地語）のタイトル / URL / 翻訳済みか」を意味する。
 *   既存アプリとの互換性のためフィールド名は維持している。
 */
class LocalSCPCrawler {
  constructor(langCode = 'jp') {
    if (!LANGUAGES[langCode]) {
      throw new Error(`未対応の言語コード: ${langCode}（有効: ${Object.keys(LANGUAGES).join(', ')}）`);
    }
    this.langCode = langCode;
    this.config = LANGUAGES[langCode];
    this.baseUrl = this.config.baseUrl;
    this.enBaseUrl = this.config.enBaseUrl;
    this.results = [];
    this.outputDir = path.join(__dirname, 'local-data', langCode);
    this.processedCount = 0;
    this.totalUrls = 0;
    this.startTime = null;
    // レート制限対策のエントリ間待機時間（並列実行時はCRAWL_DELAY_MSで延長する）
    this.entryDelayMs = parseInt(process.env.CRAWL_DELAY_MS || '500', 10);

    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * 対象URLリスト
   */
  getUrls() {
    return this.config.pages.map(page => `${this.baseUrl}/${page.path}`);
  }

  /**
   * URLに対応するページ設定を取得
   */
  getPageConfig(url) {
    const pageName = path.basename(url);
    const pageConfig = this.config.pages.find(page => page.path === pageName);
    if (!pageConfig) {
      throw new Error(`ページ設定が見つかりません: ${pageName} (${this.langCode})`);
    }
    return pageConfig;
  }

  /**
   * シリーズ一覧ページからデータを抽出。
   * リンク候補の収集（ul li / anyLink）とエントリ組み立て（重複統合・ID割り当て）を分離している。
   */
  extractFromScpSeries(document, pageConfig) {
    const candidates = pageConfig.extractMode === 'anyLink'
      ? this.collectFromAnyLinks(document, pageConfig)
      : this.collectFromListItems(document, pageConfig);
    return buildEntries(candidates, pageConfig);
  }

  /**
   * 標準的なul li構造の一覧からリンク候補を収集する
   */
  collectFromListItems(document, pageConfig) {
    const entryPattern = new RegExp(pageConfig.entryPattern || DEFAULT_ENTRY_PATTERN);
    const candidates = [];

    document.querySelectorAll('ul li').forEach(entry => {
      // ES支部などはli > strong > aのネスト構造のため、descendantセレクタで取得する
      const link = entry.querySelector('a[href^="/scp-"]');
      if (!link) return;

      const href = link.getAttribute('href');
      const scpNumberMatch = href ? href.match(entryPattern) : null;
      if (!scpNumberMatch) return;

      const isUnwritten = link.classList.contains('newpage');
      // 支部独自リストのnewpage=記事が存在しない枠のため除外する
      if (isUnwritten && pageConfig.skipUnwritten) return;

      candidates.push({
        href: href,
        scpNumber: scpNumberMatch[1],
        title: titleAfterLink(entry.textContent.trim(), link.textContent.trim()),
        isUnwritten: isUnwritten,
      });
    });

    return candidates;
  }

  /**
   * ul liに依存せず、本文内のパターン一致リンクを総当たりで収集する。
   * UA支部のようにリスト構造が特殊なページ用（extractMode: 'anyLink'）。
   */
  collectFromAnyLinks(document, pageConfig) {
    const entryPattern = new RegExp(pageConfig.entryPattern || DEFAULT_ENTRY_PATTERN);
    const contentArea = document.querySelector('#page-content') || document;
    const candidates = [];

    contentArea.querySelectorAll('a[href^="/scp-"]').forEach(link => {
      const href = link.getAttribute('href');
      const scpNumberMatch = href ? href.match(entryPattern) : null;
      if (!scpNumberMatch) return;

      const isUnwritten = link.classList.contains('newpage');
      if (isUnwritten && pageConfig.skipUnwritten) return;

      const scpNumber = scpNumberMatch[1];

      // ページの担当番号範囲外のリンク（注目記事ブロック等の混在）を除外する
      if (pageConfig.numberRange) {
        const num = parseInt(scpNumber, 10);
        if (num < pageConfig.numberRange[0] || num > pageConfig.numberRange[1]) return;
      }

      // タイトルはリンク直後のテキスト → li全体 → リンクテキスト内の順で探す
      let scpTitle = '';
      const linkText = link.textContent.trim();
      const nextText = link.nextSibling ? String(link.nextSibling.textContent || '') : '';
      const titleMatch = nextText.match(/^\s*[-–—]\s*(.+)/);
      if (titleMatch) {
        scpTitle = titleMatch[1].trim();
      } else {
        const li = link.closest('li');
        if (li) {
          scpTitle = titleAfterLink(li.textContent.trim(), linkText);
        }
      }
      if (!scpTitle) {
        // UAの国際版ミラーはリンクテキスト自体にタイトルが埋め込まれている
        // （例: "SCP-2602, який колись був бібліотекою"）。
        // タイトルなしの素の "SCP-NNNN" を誤マッチしないよう、区切り後の空白を必須にする
        const inlineMatch = linkText.match(/^SCP-[^\s,]+[,:]?\s*[-–—]?\s+(.+)$/i);
        if (inlineMatch) {
          scpTitle = inlineMatch[1].trim();
        } else if (!/^scp/i.test(linkText)) {
          // "SCP-XXX"の形式ですらないリンクテキストは全体が表示名（SCP-2521のドット表記等）
          scpTitle = linkText;
        }
      }

      candidates.push({
        href: href,
        scpNumber: scpNumber,
        title: scpTitle,
        isUnwritten: isUnwritten,
      });
    });

    return candidates;
  }

  /**
   * SCPページから画像URLを取得
   */
  async extractImageUrlFromScpPage(scpUrl, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await axios.get(scpUrl, {
          timeout: 30000,
          headers: {
            'User-Agent': CRAWLER_USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US;q=0.9,en;q=0.8,*;q=0.5',
          }
        });

        // HTML属性を読むだけなので外部リソース（CSS/フォント/画像）は読み込まない。
        return withDom(response.data, (document) => {
        // 本文コンテンツエリアを特定
        const contentSelectors = [
          '#page-content',        // メインコンテンツエリア
          '.page-source',         // ページソース表示時
          '#main-content',        // 代替メインコンテンツ
          '.content-panel'        // コンテンツパネル
        ];

        let contentArea = null;
        for (const selector of contentSelectors) {
          contentArea = document.querySelector(selector);
          if (contentArea) {
            break;
          }
        }

        if (!contentArea) {
          return null;
        }

        // 除外すべき画像のパターン
        const excludePatterns = [
          '/files/util/',          // ユーティリティ画像
          '/common/media/',        // 共通メディア
          'nav/',                  // ナビゲーション
          'side/',                 // サイドバー
          'help.png',              // ヘルプアイコン
          'icon',                  // アイコン類
          'button',                // ボタン画像
          'logo',                  // ロゴ
          'heritage-rating',       // heritage-rating関連アイコン
          'scp-heritage',          // SCPヘリテージアイコン
          'component:'             // コンポーネント関連画像
        ];

        // 本文コンテンツ内の画像を検索（優先順位順、除外パターンを考慮）
        const imageSelectors = [
          'img[src*=".jpg"]',
          'img[src*=".jpeg"]',
          'img[src*=".png"]',
          'img[src*=".gif"]',
          'img[src*=".webp"]'
        ];

        // 画像の相対URLは取得先ページのオリジンで解決する
        const pageOrigin = new URL(scpUrl).origin;

        for (const selector of imageSelectors) {
          const images = contentArea.querySelectorAll(selector);

          for (const img of images) {
            let src = img.getAttribute('src');

            // 除外パターンをチェック
            const shouldExclude = excludePatterns.some(pattern =>
              src && src.toLowerCase().includes(pattern.toLowerCase())
            );

            if (shouldExclude) {
              continue;
            }

            if (src) {
              // 相対URLを絶対URLに変換
              if (src.startsWith('//')) {
                src = `http:${src}`;
              } else if (src.startsWith('/')) {
                src = `${pageOrigin}${src}`;
              } else if (!src.startsWith('http')) {
                src = `${pageOrigin}/${src}`;
              }
              return src;
            }
          }
        }

        return null;
        });
      } catch (error) {
        console.warn(`画像URL取得エラー ${scpUrl} (試行 ${attempt}/${maxRetries}):`, error.message);

        if (attempt === maxRetries) {
          return null;
        }

        // 2秒待機後にリトライ
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    return null;
  }

  /** SCP記事ページからオブジェクトクラスを取得する。 */
  async extractObjectClassFromScpPage(scpUrl, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await axios.get(scpUrl, {
          timeout: 30000,
          headers: {
            'User-Agent': CRAWLER_USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US;q=0.9,en;q=0.8,*;q=0.5',
          }
        });

        return withDom(response.data, extractObjectClassFromDocument);
      } catch (error) {
        console.warn(`オブジェクトクラス取得エラー ${scpUrl} (試行${attempt}/${maxRetries}):`, error.message);
        if (attempt === maxRetries) return null;
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    return null;
  }

  /** SCP記事ページからオブジェクトクラス、説明冒頭、特徴タグをまとめて取得する。 */
  async extractScpDetailsFromPage(scpUrl, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await axios.get(scpUrl, {
          timeout: 30000,
          headers: {
            'User-Agent': CRAWLER_USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US;q=0.9,en;q=0.8,*;q=0.5',
          }
        });

        return withDom(response.data, document => ({
          objectClass: extractObjectClassFromDocument(document),
          ...extractDescriptionAndTagsFromDocument(document),
        }));
      } catch (error) {
        console.warn(`SCP詳細情報取得エラー ${scpUrl} (試行${attempt}/${maxRetries}):`, error.message);
        if (attempt === maxRetries) return { objectClass: null, descriptionExcerpt: null, tags: [] };
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    return { objectClass: null, descriptionExcerpt: null, tags: [] };
  }

  /**
   * 進捗表示
   */
  displayProgress(currentIndex, totalCount, message = '') {
    const percentage = Math.round((currentIndex / totalCount) * 100);
    const elapsed = Date.now() - this.startTime;
    const elapsedMinutes = Math.floor(elapsed / 60000);
    const elapsedSeconds = Math.floor((elapsed % 60000) / 1000);
    const avgTimePerUrl = elapsed / (currentIndex || 1);
    const estimatedTotal = avgTimePerUrl * totalCount;
    const remainingTime = estimatedTotal - elapsed;
    const remainingMinutes = Math.floor(remainingTime / 60000);
    const remainingSeconds = Math.floor((remainingTime % 60000) / 1000);

    console.log(`\n[${percentage}%] ${currentIndex}/${totalCount} - 経過時間: ${elapsedMinutes}:${elapsedSeconds.toString().padStart(2, '0')} - 残り予想: ${remainingMinutes}:${remainingSeconds.toString().padStart(2, '0')}`);
    if (message) {
      console.log(`現在: ${message}`);
    }
  }

  /**
   * URLからSCPデータを抽出
   */
  async extractScpDataFromUrl(url, existingData, maxRetries = 3) {
    const pageConfig = this.getPageConfig(url);
    // 一部サイトの負荷の高い一覧ページはクローラー系UAを503でブロックすることがある
    // （lista-pl、liste-frで確認）。403/503を受けたら以降はブラウザUAに切り替える。
    let useBrowserUa = !!pageConfig.browserUserAgent;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.displayProgress(this.processedCount, this.totalUrls, `${url}を処理中...`);

        const response = await axios.get(url, {
          timeout: 60000,
          headers: {
            'User-Agent': useBrowserUa ? BROWSER_USER_AGENT : CRAWLER_USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US;q=0.9,en;q=0.8,*;q=0.5',
          }
        });

        console.log(`レスポンス受信: ${response.status}`);
        const rawEntries = withDom(response.data, (document) =>
          this.extractFromScpSeries(document, pageConfig));
        console.log(`${rawEntries.length}件のエントリを抽出`);

        // 統一フォーマットに変換
        const currentTime = new Date().toISOString();
        const scpEntries = [];

        for (const entry of rawEntries) {
          const existingItem = existingData.get(entry.itemId);
          const isNewItem = !existingItem;
          const fullUrl = entry.url ? `${this.baseUrl}${entry.url}` : null;

          // URLを英語版と現地語版に分ける
          let urlEn = '';   // 英語版URL
          let urlLocal = null;  // 現地語版URL（存在しない場合はnull）

          if (fullUrl && entry.isUntranslated) {
            // 未翻訳の場合：英語版のみ存在
            urlEn = `${this.enBaseUrl}${entry.url}`;
            urlLocal = null;
          } else if (fullUrl) {
            // 翻訳済みの場合：現地語版が存在し、英語版も推測できる
            urlLocal = fullUrl;
            urlEn = `${this.enBaseUrl}${entry.url}`;
          }

          // 画像URLを取得（新しいアイテムまたは既存の画像URLがない場合のみ）
          // 現地語版があればそれを、なければ英語版を使用
          // SKIP_IMAGE_FETCH=1で画像取得を省略できる（一覧抽出のみのテスト用）
          let imageUrl = existingItem?.imageUrl || null;
          let objectClass = existingItem?.objectClass || null;
          let descriptionExcerpt = existingItem?.descriptionExcerpt || null;
          let tags = existingItem?.tags || [];
          const skipImageFetch = process.env.SKIP_IMAGE_FETCH === '1';
          const urlForArticleExtraction = urlLocal || urlEn;
          const urlForImageExtraction = skipImageFetch ? null : urlForArticleExtraction;
          if (urlForImageExtraction && (!existingItem || !existingItem.imageUrl) && entry.type === 'scp') {
            console.log(`  画像URL取得中: ${entry.itemId}`);
            imageUrl = await this.extractImageUrlFromScpPage(urlForImageExtraction);
            if (imageUrl) {
              console.log(`  ✓ 画像URL取得成功: ${imageUrl}`);
            } else {
              console.log(`  - 画像なし`);
            }
          }

          if (urlForArticleExtraction && (!objectClass || !descriptionExcerpt || !Array.isArray(existingItem?.tags)) && entry.type === 'scp') {
            console.log(`  SCP詳細情報取得中: ${entry.itemId}`);
            const details = await this.extractScpDetailsFromPage(urlForArticleExtraction);
            objectClass = objectClass || details.objectClass;
            descriptionExcerpt = descriptionExcerpt || details.descriptionExcerpt;
            if (!Array.isArray(existingItem?.tags)) tags = details.tags;
            if (details.objectClass) console.log(`  ✓ オブジェクトクラス取得成功: ${details.objectClass}`);
            if (details.tags.length) console.log(`  ✓ 自動タグ取得成功: ${details.tags.join(', ')}`);
          }

          scpEntries.push({
            itemId: entry.itemId,
            // ??にすること（||だと000番記事のnumericItemId=0がnullになる）
            numericItemId: entry.numericItemId ?? null,
            titleJP: entry.title,
            urlEN: urlEn,
            urlJP: urlLocal,
            imageUrl: imageUrl,
            objectClass: objectClass,
            descriptionExcerpt: descriptionExcerpt,
            tags: tags,
            isTranslatedJP: !entry.isUntranslated,
            extractedFrom: path.basename(url),
            pageType: pageConfig.pageType,
            contentType: entry.type,
            lastUpdated: currentTime,
            createdAt: isNewItem ? currentTime : (existingItem.createdAt || existingItem.lastUpdated)
          });

          // 各エントリ処理後に待機（レート制限対策）
          if (urlForArticleExtraction && entry.type === 'scp') {
            await new Promise(resolve => setTimeout(resolve, this.entryDelayMs));
          }
        }

        console.log(`${url}から${scpEntries.length}件のデータを抽出完了\n`);
        this.processedCount++;
        return scpEntries;

      } catch (error) {
        console.error(`URL ${url}の処理エラー (試行 ${attempt}/${maxRetries}):`, error.message);

        // UAベースのbotブロック（403/503）はブラウザUAに切り替えてリトライ
        const status = error.response?.status;
        if (!useBrowserUa && (status === 403 || status === 503)) {
          console.log('ブラウザUAに切り替えてリトライします...');
          useBrowserUa = true;
        }

        if (attempt === maxRetries) {
          console.error(`${url}の処理に${maxRetries}回失敗しました`);
          this.processedCount++;
          return [];
        }

        // 10秒待機後にリトライ
        console.log('10秒待機後にリトライします...');
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }

    return [];
  }

  /**
   * 既存データを読み込み（createdAt・取得済み画像URLの引き継ぎ用）
   */
  loadExistingData() {
    const candidates = [path.join(this.outputDir, 'scp-data.json')];
    // JPは旧来のlocal-data直下にもデータがあるため、初回移行時のフォールバックにする
    if (this.langCode === 'jp') {
      candidates.push(path.join(__dirname, 'local-data', 'scp-data.json'));
    }

    for (const dataFilePath of candidates) {
      if (!fs.existsSync(dataFilePath)) continue;
      try {
        const existingContent = fs.readFileSync(dataFilePath, 'utf8');
        const existingData = JSON.parse(existingContent);
        if (existingData.data && Array.isArray(existingData.data)) {
          const existingMap = new Map();
          existingData.data.forEach(item => {
            existingMap.set(item.itemId, item);
          });
          console.log(`既存データを読み込み: ${dataFilePath} (${existingMap.size}件)`);
          return existingMap;
        }
      } catch (error) {
        console.warn(`既存データの読み込みに失敗 (${dataFilePath}):`, error.message);
      }
    }
    return new Map();
  }

  /**
   * 中間結果を保存
   */
  saveIntermediateResults(results, urlIndex) {
    const intermediateFilePath = path.join(this.outputDir, `intermediate-${urlIndex}.json`);
    const data = {
      urlIndex: urlIndex,
      timestamp: new Date().toISOString(),
      totalCount: results.length,
      data: results
    };
    fs.writeFileSync(intermediateFilePath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`中間結果を保存: ${intermediateFilePath} (${results.length}件)`);
  }

  /**
   * すべてのURLからデータを収集
   */
  async crawlAllData() {
    console.log(`=== ローカル全URL処理開始 (${this.langCode}) ===`);
    this.startTime = new Date();

    // 既存データを読み込み
    const existingData = this.loadExistingData();
    console.log(`既存データ件数: ${existingData.size}`);

    const urls = this.getUrls();
    this.totalUrls = urls.length;
    console.log(`対象URL数: ${urls.length}`);

    this.results = [];
    this.processedCount = 0;

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      console.log(`\n=== URL ${i + 1}/${urls.length}: ${path.basename(url)} ===`);

      const entries = await this.extractScpDataFromUrl(url, existingData);
      this.results.push(...entries);

      // 各URL処理後に中間結果を保存
      this.saveIntermediateResults(this.results, i + 1);

      // 各URL処理後に2秒待機
      if (i < urls.length - 1) {
        console.log('次のURL処理まで2秒待機...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    const endTime = new Date();
    const duration = Math.round((endTime - this.startTime) / 1000);

    console.log(`\n=== 全URL処理完了 ===`);
    console.log(`総件数: ${this.results.length}`);
    console.log(`実行時間: ${Math.floor(duration / 60)}分${duration % 60}秒`);

    // 統計情報
    const withImage = this.results.filter(item => item.imageUrl).length;
    const untranslated = this.results.filter(item => !item.isTranslatedJP).length;
    const translated = this.results.filter(item => item.isTranslatedJP).length;

    console.log(`\n=== 統計情報 ===`);
    console.log(`翻訳済み記事: ${translated}件`);
    console.log(`未翻訳記事: ${untranslated}件`);
    console.log(`画像付き記事: ${withImage}件`);

    return {
      totalCount: this.results.length,
      language: this.langCode,
      timestamp: this.startTime.toISOString(),
      duration: duration,
      status: 'local-completed',
      statistics: {
        translated: translated,
        untranslated: untranslated,
        withImage: withImage
      },
      data: this.results
    };
  }

  /**
   * 結果をファイルに保存
   */
  async saveResults() {
    const crawlResult = await this.crawlAllData();

    // メインデータファイル
    const dataFilePath = path.join(this.outputDir, 'scp-data.json');
    fs.writeFileSync(dataFilePath, stringifyAsciiSafe(crawlResult), 'utf8');
    console.log(`\nデータを保存: ${dataFilePath}`);

    // メタデータファイル
    const metaFilePath = path.join(this.outputDir, 'meta.json');
    const meta = {
      lastUpdated: crawlResult.timestamp,
      language: this.langCode,
      totalCount: crawlResult.totalCount,
      status: crawlResult.status,
      duration: crawlResult.duration,
      statistics: crawlResult.statistics,
      dataFile: 'scp-data.json'
    };
    fs.writeFileSync(metaFilePath, stringifyAsciiSafe(meta), 'utf8');
    console.log(`メタデータを保存: ${metaFilePath}`);

    // 中間ファイルを削除
    const intermediateFiles = fs.readdirSync(this.outputDir).filter(file => file.startsWith('intermediate-'));
    intermediateFiles.forEach(file => {
      fs.unlinkSync(path.join(this.outputDir, file));
    });
    console.log(`中間ファイル ${intermediateFiles.length}件を削除`);

    return crawlResult;
  }
}

/**
 * 非ASCII文字をJSONのユニコードエスケープに変換して文字列化する。
 * raw.githubusercontent.comはcharset指定なし(application/octet-stream)で配信するため、
 * アプリ側(Dart http)がLatin-1として読むと生のUTF-8日本語は文字化けする。
 * ASCIIのみの出力ならどの文字コードで読んでもJSONパース時に正しく復元される。
 * 正規表現は「改行と印字可能ASCII(空白～チルダ)以外」にマッチする。
 */
function stringifyAsciiSafe(value) {
  return JSON.stringify(value, null, 2).replace(
    /[^\n -~]/g,
    ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')
  );
}

// メイン実行
if (require.main === module) {
  const langCode = process.argv[2] || 'jp';
  const crawler = new LocalSCPCrawler(langCode);
  crawler.saveResults().catch(error => {
    console.error('ローカルクローラー実行エラー:', error);
    process.exit(1);
  });
}

module.exports = { LocalSCPCrawler, stringifyAsciiSafe, variantSlugPart, buildEntries };
