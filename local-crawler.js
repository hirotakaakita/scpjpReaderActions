const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const axios = require('axios');
const { LANGUAGES, DEFAULT_ENTRY_PATTERN } = require('./languages');

const CRAWLER_USER_AGENT = 'Mozilla/5.0 (compatible; SCPCrawler/2.0; Multi-Language)';
// 一部ページ（PLのlista-pl等）はクローラー系UAを503でブロックするため、
// pageConfig.browserUserAgent: true のページのみブラウザ相当のUAを使う
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

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
   * シリーズ一覧ページからデータを抽出
   */
  extractFromScpSeries(document, pageConfig) {
    if (pageConfig.extractMode === 'anyLink') {
      return this.extractFromAnyLinks(document, pageConfig);
    }

    const entries = [];
    const entryPattern = new RegExp(pageConfig.entryPattern || DEFAULT_ENTRY_PATTERN);
    const listItems = document.querySelectorAll('ul li');

    listItems.forEach(entry => {
      // ES支部などはli > strong > aのネスト構造のため、descendantセレクタで取得する
      const link = entry.querySelector('a[href^="/scp-"]');
      if (!link) return;

      const href = link.getAttribute('href');
      const scpNumberMatch = href ? href.match(entryPattern) : null;
      if (!scpNumberMatch) return;

      const isUnwritten = link.classList.contains('newpage');
      // 支部独自リストのnewpage=記事が存在しない枠のため除外する
      if (isUnwritten && pageConfig.skipUnwritten) return;

      const scpNumber = scpNumberMatch[1];
      const entryText = entry.textContent.trim();
      const linkText = link.textContent.trim();

      // タイトル抽出（"SCP-XXX - タイトル" 形式。区切りはサイトによって - / – / — が使われる）
      let scpTitle = '';
      const titleMatch = entryText.match(new RegExp(linkText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[-–—]\\s*(.+)'));
      if (titleMatch) {
        scpTitle = titleMatch[1].trim();
      }

      entries.push({
        itemId: `${pageConfig.pageType}-${scpNumber}`,
        numericItemId: parseInt(scpNumber, 10),
        title: scpTitle,
        url: href,
        isUntranslated: isUnwritten,
        type: 'scp'
      });
    });

    return entries;
  }

  /**
   * ul liに依存せず、本文内のパターン一致リンクを総当たりで抽出する。
   * UA支部のようにリスト構造が特殊なページ用（extractMode: 'anyLink'）。
   * タイトルはリンク直後のテキストノード（" - タイトル"形式）から取得する。
   */
  extractFromAnyLinks(document, pageConfig) {
    // 同一記事がページ内に複数回登場する場合（上部の注目記事ブロック等）に備え、
    // itemIdごとに1件とし、タイトルが取得できた出現を優先する
    const entriesById = new Map();
    const entryPattern = new RegExp(pageConfig.entryPattern || DEFAULT_ENTRY_PATTERN);
    const contentArea = document.querySelector('#page-content') || document;
    const links = contentArea.querySelectorAll('a[href^="/scp-"]');

    links.forEach(link => {
      const href = link.getAttribute('href');
      const scpNumberMatch = href ? href.match(entryPattern) : null;
      if (!scpNumberMatch) return;

      const isUnwritten = link.classList.contains('newpage');
      if (isUnwritten && pageConfig.skipUnwritten) return;

      const scpNumber = scpNumberMatch[1];
      const itemId = `${pageConfig.pageType}-${scpNumber}`;
      const existing = entriesById.get(itemId);
      if (existing && existing.title) return;

      // リンク直後のテキスト（" - タイトル" または " - タイトル, рейтинг NN"等）からタイトルを抽出
      let scpTitle = '';
      const nextText = link.nextSibling ? String(link.nextSibling.textContent || '') : '';
      const titleMatch = nextText.match(/^\s*[-–—]\s*(.+)/);
      if (titleMatch) {
        scpTitle = titleMatch[1].trim();
      } else {
        // li内にあるエントリはli全体のテキスト（"SCP-XXX - タイトル"形式）から抽出
        const li = link.closest('li');
        if (li) {
          const linkText = link.textContent.trim();
          const liTitleMatch = li.textContent.trim().match(new RegExp(linkText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[-–—]\\s*(.+)'));
          if (liTitleMatch) {
            scpTitle = liTitleMatch[1].trim();
          }
        }
      }

      if (existing && !scpTitle) return;
      entriesById.set(itemId, {
        itemId: itemId,
        numericItemId: parseInt(scpNumber, 10),
        title: scpTitle,
        url: href,
        isUntranslated: isUnwritten,
        type: 'scp'
      });
    });

    return [...entriesById.values()];
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

        const dom = new JSDOM(response.data, {
          resources: "usable",
          runScripts: "outside-only",
          pretendToBeVisual: false,
          storageQuota: 10000000,
          // CSSパースを無効にしてエラーを回避
          features: {
            FetchExternalResources: false,
            ProcessExternalResources: false,
            SkipExternalResources: true
          }
        });
        const document = dom.window.document;

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
        const dom = new JSDOM(response.data, {
          resources: "usable",
          runScripts: "outside-only",
          pretendToBeVisual: false,
          storageQuota: 10000000,
          // CSSパースを無効にしてエラーを回避
          features: {
            FetchExternalResources: false,
            ProcessExternalResources: false,
            SkipExternalResources: true
          }
        });
        const document = dom.window.document;

        const rawEntries = this.extractFromScpSeries(document, pageConfig);
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
          const skipImageFetch = process.env.SKIP_IMAGE_FETCH === '1';
          const urlForImageExtraction = skipImageFetch ? null : (urlLocal || urlEn);
          if (urlForImageExtraction && (!existingItem || !existingItem.imageUrl) && entry.type === 'scp') {
            console.log(`  画像URL取得中: ${entry.itemId}`);
            imageUrl = await this.extractImageUrlFromScpPage(urlForImageExtraction);
            if (imageUrl) {
              console.log(`  ✓ 画像URL取得成功: ${imageUrl}`);
            } else {
              console.log(`  - 画像なし`);
            }
          }

          scpEntries.push({
            itemId: entry.itemId,
            numericItemId: entry.numericItemId || null,
            titleJP: entry.title,
            urlEN: urlEn,
            urlJP: urlLocal,
            imageUrl: imageUrl,
            isTranslatedJP: !entry.isUntranslated,
            extractedFrom: path.basename(url),
            pageType: pageConfig.pageType,
            contentType: entry.type,
            lastUpdated: currentTime,
            createdAt: isNewItem ? currentTime : (existingItem.createdAt || existingItem.lastUpdated)
          });

          // 各エントリ処理後に待機（レート制限対策）
          if (urlForImageExtraction && entry.type === 'scp') {
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

module.exports = { LocalSCPCrawler, stringifyAsciiSafe };
