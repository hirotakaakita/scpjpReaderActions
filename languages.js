/**
 * 各言語（SCP支部サイト）のクロール設定。
 *
 * 各pageの定義:
 *   path         : サイト上のページ名（baseUrl直下）
 *   pageType     : 出力データ上の分類。支部独自ページはJPの命名規則を全支部に展開した
 *                  canonical形式（scp-series-<code> / joke-scps-<code> / scp-<code>-ex）に正規化する。
 *                  ページ名がサイトごとに違っても（liste-fr, lista-pl等）pageTypeは共通形式。
 *   entryPattern : hrefから記事番号を抽出する正規表現（キャプチャ1=番号）。
 *                  省略時はDEFAULT_ENTRY_PATTERN（国際版/サフィックス型支部の両方にマッチ）。
 *                  プレフィックス型支部（scp-es-001等）はページごとに指定が必要。
 *   skipUnwritten: trueならclass="newpage"（リンク先未作成）のエントリを除外する。
 *                  支部独自リストのnewpage=記事が存在しない（読めるものがない）ため除外。
 *                  国際版ミラーのnewpage=未翻訳（英語版は読める）ため含める。
 *
 * 注意（調査済みの制約）:
 *  - wikidotサイトの多くはHTTPS不可（httpへ301リダイレクトされループする）。baseUrlのスキームを変えないこと。
 *  - RU支部(scpfoundation.net)はアンチボット保護(Anubis, JS必須)のためクロール不可 → 未対応。
 *  - INTは全体シリーズ一覧が無いため、INT独自記事(int-hub)のみ対応。
 *  - UAは国際版ミラーが通常のul li構造でない（curated list）ため、支部独自リストのみ対応。
 *  - ITのジョーク一覧には番号なしslug記事（scp-sexooo-it-j等）があり、番号抽出できないため対象外。
 */

const DEFAULT_ENTRY_PATTERN = '^\\/scp-(\\d+)(?:-.*)?$';

/** 国際版シリーズミラー（series 1-10 + joke + ex）を生成 */
function internationalPages(maxSeries = 10) {
  const pages = [{ path: 'scp-series', pageType: 'scp-series' }];
  for (let i = 2; i <= maxSeries; i++) {
    pages.push({ path: `scp-series-${i}`, pageType: 'scp-series' });
  }
  pages.push({ path: 'joke-scps', pageType: 'joke-scps' });
  pages.push({ path: 'scp-ex', pageType: 'scp-ex' });
  return pages;
}

/** プレフィックス型支部（/scp-<code>-001）の番号抽出パターン */
function prefixPattern(code) {
  return `^\\/scp-${code}-(\\d+)(?:-.*)?$`;
}

const LANGUAGES = {
  jp: {
    baseUrl: 'http://scp-jp.wikidot.com',
    enBaseUrl: 'http://scp-wiki.wikidot.com',
    pages: [
      ...internationalPages(10),
      { path: 'scp-series-jp', pageType: 'scp-series-jp', skipUnwritten: true },
      { path: 'scp-series-jp-2', pageType: 'scp-series-jp', skipUnwritten: true },
      { path: 'scp-series-jp-3', pageType: 'scp-series-jp', skipUnwritten: true },
      { path: 'scp-series-jp-4', pageType: 'scp-series-jp', skipUnwritten: true },
      { path: 'scp-series-jp-5', pageType: 'scp-series-jp', skipUnwritten: true },
      { path: 'joke-scps-jp', pageType: 'joke-scps-jp', skipUnwritten: true },
      { path: 'scp-jp-ex', pageType: 'scp-jp-ex', skipUnwritten: true },
    ],
  },

  en: {
    baseUrl: 'https://scp-wiki.wikidot.com',
    enBaseUrl: 'https://scp-wiki.wikidot.com',
    // 本家なのでnewpage=記事が存在しない枠 → 全ページで除外
    pages: internationalPages(10).map(page => ({ ...page, skipUnwritten: true })),
  },

  cn: {
    baseUrl: 'https://scp-wiki-cn.wikidot.com',
    enBaseUrl: 'https://scp-wiki.wikidot.com',
    pages: [
      ...internationalPages(10),
      { path: 'scp-series-cn', pageType: 'scp-series-cn', entryPattern: prefixPattern('cn'), skipUnwritten: true },
      { path: 'scp-series-cn-2', pageType: 'scp-series-cn', entryPattern: prefixPattern('cn'), skipUnwritten: true },
      { path: 'scp-series-cn-3', pageType: 'scp-series-cn', entryPattern: prefixPattern('cn'), skipUnwritten: true },
      { path: 'scp-series-cn-4', pageType: 'scp-series-cn', entryPattern: prefixPattern('cn'), skipUnwritten: true },
      { path: 'scp-series-cn-5', pageType: 'scp-series-cn', entryPattern: prefixPattern('cn'), skipUnwritten: true },
      { path: 'joke-scps-cn', pageType: 'joke-scps-cn', entryPattern: prefixPattern('cn'), skipUnwritten: true },
      { path: 'scp-ex-cn', pageType: 'scp-cn-ex', entryPattern: prefixPattern('cn'), skipUnwritten: true },
    ],
  },

  cs: {
    baseUrl: 'http://scp-cs.wikidot.com',
    enBaseUrl: 'http://scp-wiki.wikidot.com',
    pages: [
      ...internationalPages(10),
      { path: 'scp-series-cs', pageType: 'scp-series-cs', skipUnwritten: true },
      // チェコ支部サイトはスロバキア語リストも併設している
      { path: 'scp-series-sk', pageType: 'scp-series-sk', skipUnwritten: true },
    ],
  },

  de: {
    baseUrl: 'http://scp-wiki-de.wikidot.com',
    enBaseUrl: 'http://scp-wiki.wikidot.com',
    pages: [
      ...internationalPages(10),
      { path: 'scp-serie-de', pageType: 'scp-series-de', skipUnwritten: true },
    ],
  },

  es: {
    baseUrl: 'http://lafundacionscp.wikidot.com',
    enBaseUrl: 'http://scp-wiki.wikidot.com',
    pages: [
      ...internationalPages(10),
      { path: 'serie-scp-es', pageType: 'scp-series-es', entryPattern: prefixPattern('es'), skipUnwritten: true },
      { path: 'serie-scp-es-2', pageType: 'scp-series-es', entryPattern: prefixPattern('es'), skipUnwritten: true },
      { path: 'serie-scp-es-3', pageType: 'scp-series-es', entryPattern: prefixPattern('es'), skipUnwritten: true },
      { path: 'serie-scp-es-4', pageType: 'scp-series-es', entryPattern: prefixPattern('es'), skipUnwritten: true },
    ],
  },

  fr: {
    baseUrl: 'http://fondationscp.wikidot.com',
    enBaseUrl: 'http://scp-wiki.wikidot.com',
    pages: [
      ...internationalPages(10),
      // liste-frはクローラー系UAを503でブロックすることがあるためブラウザUAで取得する
      { path: 'liste-fr', pageType: 'scp-series-fr', skipUnwritten: true, browserUserAgent: true },
    ],
  },

  int: {
    baseUrl: 'http://scp-int.wikidot.com',
    enBaseUrl: 'http://scp-int.wikidot.com',
    // INTには全体シリーズ一覧が無いため、INT独自記事のみ
    pages: [
      { path: 'int-hub', pageType: 'scp-series-int', skipUnwritten: true },
    ],
  },

  it: {
    baseUrl: 'http://fondazionescp.wikidot.com',
    enBaseUrl: 'http://scp-wiki.wikidot.com',
    pages: [
      ...internationalPages(9),
      { path: 'scp-it-serie-i', pageType: 'scp-series-it', skipUnwritten: true },
      { path: 'scp-it-scherzo', pageType: 'joke-scps-it', skipUnwritten: true },
    ],
  },

  ko: {
    baseUrl: 'https://scpko.wikidot.com',
    enBaseUrl: 'https://scp-wiki.wikidot.com',
    pages: [
      ...internationalPages(10),
      { path: 'scp-series-ko', pageType: 'scp-series-ko', skipUnwritten: true },
      { path: 'scp-series-ko-2', pageType: 'scp-series-ko', skipUnwritten: true },
      { path: 'joke-scps-ko', pageType: 'joke-scps-ko', skipUnwritten: true },
      { path: 'scp-ko-ex', pageType: 'scp-ko-ex', skipUnwritten: true },
    ],
  },

  pl: {
    baseUrl: 'http://scp-pl.wikidot.com',
    enBaseUrl: 'http://scp-wiki.wikidot.com',
    pages: [
      ...internationalPages(10),
      // lista-plはクローラー系UAを503でブロックするためブラウザUAで取得する
      { path: 'lista-pl', pageType: 'scp-series-pl', entryPattern: prefixPattern('pl'), skipUnwritten: true, browserUserAgent: true },
      { path: 'joke-scps-pl', pageType: 'joke-scps-pl', entryPattern: prefixPattern('pl'), skipUnwritten: true },
      { path: 'scp-ex-pl', pageType: 'scp-pl-ex', entryPattern: prefixPattern('pl'), skipUnwritten: true },
    ],
  },

  pt: {
    baseUrl: 'http://scp-pt-br.wikidot.com',
    enBaseUrl: 'http://scp-wiki.wikidot.com',
    pages: [
      ...internationalPages(9),
      { path: 'series-1-pt', pageType: 'scp-series-pt', skipUnwritten: true },
      { path: 'series-2-pt', pageType: 'scp-series-pt', skipUnwritten: true },
    ],
  },

  th: {
    baseUrl: 'http://scp-th.wikidot.com',
    enBaseUrl: 'http://scp-wiki.wikidot.com',
    pages: [
      ...internationalPages(10),
      { path: 'scp-series-th', pageType: 'scp-series-th', skipUnwritten: true },
      { path: 'joke-scps-th', pageType: 'joke-scps-th', skipUnwritten: true },
      { path: 'scp-th-ex', pageType: 'scp-th-ex', skipUnwritten: true },
    ],
  },

  ua: {
    baseUrl: 'http://scp-ukrainian.wikidot.com',
    enBaseUrl: 'http://scp-wiki.wikidot.com',
    // UAサイトは全ページがdiv+brベースの特殊構造のためanyLinkモードで抽出する。
    // 国際版ミラーは「翻訳済み記事のみ掲載」のキュレーション型で、
    // ページ上部の注目記事ブロック（他シリーズの記事が混在）はnumberRangeで除外する。
    // joke-scps等は404のためシリーズのみ対象。
    pages: [
      ...internationalPages(10)
        .filter(page => page.pageType === 'scp-series')
        .map((page, index) => ({
          ...page,
          extractMode: 'anyLink',
          skipUnwritten: true,
          numberRange: [index === 0 ? 1 : index * 1000, index * 1000 + 999],
        })),
      { path: 'scp-series-ua', pageType: 'scp-series-ua', skipUnwritten: true, extractMode: 'anyLink' },
    ],
  },

  vn: {
    baseUrl: 'https://scp-vn.wikidot.com',
    enBaseUrl: 'https://scp-wiki.wikidot.com',
    pages: [
      ...internationalPages(10),
      { path: 'scp-series-vn', pageType: 'scp-series-vn', skipUnwritten: true },
      { path: 'joke-scps-vn', pageType: 'joke-scps-vn', skipUnwritten: true },
      { path: 'scp-ex-vn', pageType: 'scp-vn-ex', skipUnwritten: true },
    ],
  },

  // 繁體中文支部: サイト名はzh-trだが記事slugはscp-zh-XXX
  'zh-tr': {
    baseUrl: 'http://scp-zh-tr.wikidot.com',
    enBaseUrl: 'http://scp-wiki.wikidot.com',
    pages: [
      ...internationalPages(10),
      { path: 'scp-series-zh', pageType: 'scp-series-zh', entryPattern: prefixPattern('zh'), skipUnwritten: true },
    ],
  },
};

module.exports = { LANGUAGES, DEFAULT_ENTRY_PATTERN };
