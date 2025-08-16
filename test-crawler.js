const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const axios = require('axios');

/**
 * ローカルテスト用SCP Crawler
 * 画像URL取得機能のテスト版
 */
class LocalTestSCPCrawler {
  constructor() {
    this.baseUrl = 'http://scp-jp.wikidot.com';
    this.results = [];
    this.outputDir = path.join(__dirname, 'test-data');
    
    // test-dataディレクトリを作成
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * テスト用URL（少数のページのみ）
   */
  getTestUrls() {
    return [
      'http://scp-jp.wikidot.com/scp-series', // 最初のシリーズページのみ
    ];
  }

  /**
   * ページタイプを判定
   */
  getPageType(url) {
    const pageName = path.basename(url);
    
    if (pageName.match(/^scp-series-jp/)) return 'scp-series-jp';
    if (pageName.match(/^joke-scps-jp/)) return 'joke-scps-jp';
    if (pageName.match(/^scp-jp-ex/)) return 'scp-jp-ex';
    if (pageName.match(/^scp-series/)) return 'scp-series';
    if (pageName.match(/^joke-scps/)) return 'joke-scps';
    if (pageName.match(/^scp-ex/)) return 'scp-ex';
    
    return 'default';
  }

  /**
   * SCPシリーズページからデータを抽出（テスト用：最初の5件のみ）
   */
  extractFromScpSeriesTest(document, pageType) {
    const entries = [];
    const listItems = document.querySelectorAll('ul li');
    let count = 0;
    
    for (const entry of listItems) {
      if (count >= 5) break; // テスト用：最初の5件のみ
      
      const link = entry.querySelector('a[href^="/scp-"]');
      if (link) {
        const href = link.getAttribute('href');
        const scpNumberMatch = href.match(/\/scp-(\d+)(?:-.*)?$/);
        
        if (scpNumberMatch) {
          const scpNumber = scpNumberMatch[1];
          const entryText = entry.textContent.trim();
          const linkText = link.textContent.trim();
          
          // タイトル抽出
          let scpTitle = '';
          const titleMatch = entryText.match(new RegExp(linkText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*-\\s*(.+)'));
          if (titleMatch) {
            scpTitle = titleMatch[1].trim();
          }
          
          entries.push({
            itemId: `${pageType}-${scpNumber}`,
            numericItemId: parseInt(scpNumber, 10),
            title: scpTitle,
            url: href,
            isUntranslated: link.classList.contains('newpage'),
            type: 'scp'
          });
          
          count++;
        }
      }
    }
    
    return entries;
  }

  /**
   * SCPページから画像URLを取得（詳細ログ付き）
   */
  async extractImageUrlFromScpPage(scpUrl, maxRetries = 3) {
    console.log(`\n=== 画像URL取得開始: ${scpUrl} ===`);
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`試行 ${attempt}/${maxRetries}: HTTPリクエスト送信中...`);
        
        const response = await axios.get(scpUrl, {
          timeout: 30000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; SCPCrawler/1.0; Local Test)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
          }
        });
        
        console.log(`レスポンス受信: ステータス ${response.status}, サイズ ${response.data.length}文字`);
        
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
            console.log(`本文エリア特定: ${selector}`);
            break;
          }
        }
        
        if (!contentArea) {
          console.log('本文エリアが特定できませんでした');
          return null;
        }
        
        // 本文エリア内の画像要素を取得してログ出力
        const allImages = contentArea.querySelectorAll('img');
        console.log(`本文エリア内の画像要素数: ${allImages.length}`);
        
        allImages.forEach((img, index) => {
          const src = img.getAttribute('src');
          const alt = img.getAttribute('alt');
          const className = img.getAttribute('class');
          console.log(`  画像 ${index + 1}: src="${src}", alt="${alt}", class="${className}"`);
        });
        
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
        
        for (const selector of imageSelectors) {
          console.log(`セレクタ "${selector}" で本文エリア内を検索中...`);
          const images = contentArea.querySelectorAll(selector);
          
          for (const img of images) {
            let src = img.getAttribute('src');
            console.log(`候補画像: ${src}`);
            
            // 除外パターンをチェック
            const shouldExclude = excludePatterns.some(pattern => 
              src && src.toLowerCase().includes(pattern.toLowerCase())
            );
            
            if (shouldExclude) {
              console.log(`除外: ${src} (除外パターンにマッチ)`);
              continue;
            }
            
            if (src) {
              // 相対URLを絶対URLに変換
              const originalSrc = src;
              if (src.startsWith('/')) {
                src = `${this.baseUrl}${src}`;
              } else if (src.startsWith('//')) {
                src = `http:${src}`;
              } else if (!src.startsWith('http')) {
                src = `${this.baseUrl}/${src}`;
              }
              
              console.log(`URL変換: "${originalSrc}" → "${src}"`);
              console.log(`=== 本文内画像URL取得成功 ===\n`);
              return src;
            }
          }
        }
        
        console.log('該当する画像が見つかりませんでした');
        console.log(`=== 画像URL取得結果: なし ===\n`);
        return null;
        
      } catch (error) {
        console.error(`画像URL取得エラー (試行 ${attempt}/${maxRetries}):`, error.message);
        
        if (attempt === maxRetries) {
          console.log(`=== 画像URL取得失敗 ===\n`);
          return null;
        }
        
        console.log('2秒待機後にリトライします...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    return null;
  }

  /**
   * URLからSCPデータを抽出（テスト版）
   */
  async extractScpDataFromUrl(url, existingData = new Map(), maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`\n処理中: ${url} (試行 ${attempt}/${maxRetries})`);
        
        const response = await axios.get(url, {
          timeout: 60000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; SCPCrawler/1.0; Local Test)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
          }
        });
        
        console.log(`レスポンス受信: ${url} - ${response.status}`);
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
        
        const pageType = this.getPageType(url);
        let rawEntries = [];
        
        // テスト用のデータ抽出
        rawEntries = this.extractFromScpSeriesTest(document, pageType);
        
        // 統一フォーマットに変換
        const currentTime = new Date().toISOString();
        const scpEntries = [];
        
        console.log(`\n${rawEntries.length}件のSCPエントリを処理中...`);
        
        for (const entry of rawEntries) {
          const existingItem = existingData.get(entry.itemId);
          const isNewItem = !existingItem;
          const fullUrl = entry.url ? `${this.baseUrl}${entry.url}` : null;
          
          console.log(`\n--- ${entry.itemId}: ${entry.title} ---`);
          console.log(`ベースURL: ${fullUrl}`);
          
          // URLを英語版と日本語版に分ける
          let urlEn = '';  // 英語版URL
          let urlJp = null;  // 日本語版URL（存在しない場合はnull）
          
          if (fullUrl && entry.isUntranslated) {
            // 未翻訳の場合：英語版のみ存在
            urlEn = fullUrl.replace('http://scp-jp.wikidot.com', 'http://scp-wiki.wikidot.com');
            urlJp = null;  // 日本語版はnull
            console.log(`未翻訳記事: 英語版のみ設定 ${urlEn}`);
          } else if (fullUrl) {
            // 翻訳済みの場合：日本語版が存在し、英語版も推測できる
            urlJp = fullUrl;  // 日本語版
            urlEn = fullUrl.replace('http://scp-jp.wikidot.com', 'http://scp-wiki.wikidot.com');  // 英語版
            console.log(`翻訳済み記事: 日本語版=${urlJp}, 英語版=${urlEn}`);
          }
          
          // 画像URLを取得（日本語版があればそれを、なければ英語版を使用）
          let imageUrl = existingItem?.image_url || null;
          const urlForImageExtraction = urlJp || urlEn;
          if (urlForImageExtraction && entry.type === 'scp') {
            console.log(`画像URL取得開始 (${urlJp ? '日本語版' : '英語版'}から)...`);
            imageUrl = await this.extractImageUrlFromScpPage(urlForImageExtraction);
            if (imageUrl) {
              console.log(`✓ 画像URL取得成功: ${imageUrl}`);
            } else {
              console.log(`✗ 画像URL取得失敗`);
            }
          }

          scpEntries.push({
            itemId: entry.itemId,
            numericItemId: entry.numericItemId || null,
            title: entry.title,
            url_en: urlEn,
            url_jp: urlJp,
            image_url: imageUrl,
            isUntranslated: entry.isUntranslated,
            extractedFrom: path.basename(url),
            pageType: pageType,
            contentType: entry.type,
            lastUpdated: currentTime,
            createdAt: isNewItem ? currentTime : (existingItem?.createdAt || currentTime)
          });
          
          // 各エントリ処理後に1秒待機
          console.log('1秒待機...');
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        console.log(`\n${url}から${scpEntries.length}件のデータを抽出完了`);
        return scpEntries;
        
      } catch (error) {
        console.error(`URL ${url}の処理エラー (試行 ${attempt}/${maxRetries}):`, error.message);
        
        if (attempt === maxRetries) {
          console.error(`${url}の処理に${maxRetries}回失敗しました`);
          return [];
        }
        
        console.log('10秒待機後にリトライします...');
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
    
    return [];
  }

  /**
   * テスト実行
   */
  async runTest() {
    console.log('=== ローカルテスト開始 ===');
    const startTime = new Date();
    
    const urls = this.getTestUrls();
    console.log(`対象URL数: ${urls.length}`);
    
    this.results = [];
    
    for (const url of urls) {
      const entries = await this.extractScpDataFromUrl(url);
      this.results.push(...entries);
    }
    
    const endTime = new Date();
    const duration = Math.round((endTime - startTime) / 1000);
    
    console.log(`\n=== テスト完了 ===`);
    console.log(`総件数: ${this.results.length}`);
    console.log(`実行時間: ${duration}秒`);
    
    // 結果をファイルに保存
    const result = {
      totalCount: this.results.length,
      timestamp: startTime.toISOString(),
      duration: duration,
      status: 'test-completed',
      data: this.results
    };
    
    const outputPath = path.join(this.outputDir, 'test-result.json');
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');
    console.log(`テスト結果を保存: ${outputPath}`);
    
    // 画像URL取得結果のサマリー
    const withImage = this.results.filter(item => item.image_url).length;
    const withoutImage = this.results.filter(item => !item.image_url).length;
    
    console.log(`\n=== 画像URL取得結果 ===`);
    console.log(`画像あり: ${withImage}件`);
    console.log(`画像なし: ${withoutImage}件`);
    
    if (withImage > 0) {
      console.log(`\n=== 取得した画像URL ===`);
      this.results.forEach(item => {
        if (item.image_url) {
          console.log(`${item.itemId}: ${item.image_url}`);
        }
      });
    }
    
    return result;
  }
}

// メイン実行
if (require.main === module) {
  const crawler = new LocalTestSCPCrawler();
  crawler.runTest().catch(error => {
    console.error('テスト実行エラー:', error);
    process.exit(1);
  });
}

module.exports = { LocalTestSCPCrawler };