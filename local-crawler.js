const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const axios = require('axios');

/**
 * ローカル実行用SCP Crawler（全URL対応版）
 * メイン版から派生し、ローカル環境ですべてのURLを処理
 */
class LocalSCPCrawler {
  constructor() {
    this.baseUrl = 'http://scp-jp.wikidot.com';
    this.results = [];
    this.outputDir = path.join(__dirname, 'local-data');
    this.processedCount = 0;
    this.totalUrls = 0;
    this.startTime = null;
    
    // local-dataディレクトリを作成
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * 対象URLリスト（全URL）
   */
  getUrls() {
    return [
      'http://scp-jp.wikidot.com/scp-series',
      'http://scp-jp.wikidot.com/scp-series-2',
      'http://scp-jp.wikidot.com/scp-series-3',
      'http://scp-jp.wikidot.com/scp-series-4',
      'http://scp-jp.wikidot.com/scp-series-5',
      'http://scp-jp.wikidot.com/scp-series-6',
      'http://scp-jp.wikidot.com/scp-series-7',
      'http://scp-jp.wikidot.com/scp-series-8',
      'http://scp-jp.wikidot.com/scp-series-9',
      'http://scp-jp.wikidot.com/joke-scps',
      'http://scp-jp.wikidot.com/scp-ex',
      'http://scp-jp.wikidot.com/scp-series-jp',
      'http://scp-jp.wikidot.com/scp-series-jp-2',
      'http://scp-jp.wikidot.com/scp-series-jp-3',
      'http://scp-jp.wikidot.com/scp-series-jp-4',
      'http://scp-jp.wikidot.com/joke-scps-jp',
      'http://scp-jp.wikidot.com/scp-jp-ex',
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
   * SCPシリーズページからデータを抽出
   */
  extractFromScpSeries(document, pageType) {
    const entries = [];
    const listItems = document.querySelectorAll('ul li');
    
    listItems.forEach(entry => {
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
        }
      }
    });
    
    return entries;
  }

  /**
   * その他のページからデータを抽出
   */
  extractFromDefault(document) {
    const entries = [];
    const links = document.querySelectorAll('a[href^="/"]');
    
    links.forEach(link => {
      const href = link.getAttribute('href');
      if (href && !href.includes('#') && !href.includes('edit') && !href.includes('discussion')) {
        const title = link.textContent.trim();
        if (title.length > 0) {
          entries.push({
            itemId: title,
            title: title,
            url: href,
            isUntranslated: link.classList.contains('newpage'),
            type: 'other'
          });
        }
      }
    });
    
    return entries;
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
            'User-Agent': 'Mozilla/5.0 (compatible; SCPCrawler/1.0; Local Full)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
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
              if (src.startsWith('/')) {
                src = `${this.baseUrl}${src}`;
              } else if (src.startsWith('//')) {
                src = `http:${src}`;
              } else if (!src.startsWith('http')) {
                src = `${this.baseUrl}/${src}`;
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
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.displayProgress(this.processedCount, this.totalUrls, `${url}を処理中...`);
        
        const response = await axios.get(url, {
          timeout: 60000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; SCPCrawler/1.0; Local Full)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
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
        
        const pageType = this.getPageType(url);
        let rawEntries = [];
        
        // ページタイプに応じた抽出方法を選択
        switch (pageType) {
          case 'scp-series':
          case 'scp-series-jp':
          case 'joke-scps':
          case 'joke-scps-jp':
          case 'scp-ex':
          case 'scp-jp-ex':
            rawEntries = this.extractFromScpSeries(document, pageType);
            break;
          default:
            rawEntries = this.extractFromDefault(document);
            break;
        }
        
        console.log(`${rawEntries.length}件のエントリを抽出`);
        
        // 統一フォーマットに変換
        const currentTime = new Date().toISOString();
        const scpEntries = [];
        
        for (const entry of rawEntries) {
          const existingItem = existingData.get(entry.itemId);
          const isNewItem = !existingItem;
          const fullUrl = entry.url ? `${this.baseUrl}${entry.url}` : null;
          
          // URLを英語版と日本語版に分ける
          let urlEn = '';  // 英語版URL
          let urlJp = null;  // 日本語版URL（存在しない場合はnull）
          
          if (fullUrl && entry.isUntranslated) {
            // 未翻訳の場合：英語版のみ存在
            urlEn = fullUrl.replace('http://scp-jp.wikidot.com', 'http://scp-wiki.wikidot.com');
            urlJp = null;  // 日本語版はnull
          } else if (fullUrl) {
            // 翻訳済みの場合：日本語版が存在し、英語版も推測できる
            urlJp = fullUrl;  // 日本語版
            urlEn = fullUrl.replace('http://scp-jp.wikidot.com', 'http://scp-wiki.wikidot.com');  // 英語版
          }
          
          // 画像URLを取得（新しいアイテムまたは既存の画像URLがない場合のみ）
          // 日本語版があればそれを、なければ英語版を使用
          let imageUrl = existingItem?.imageUrl || null;
          const urlForImageExtraction = urlJp || urlEn;
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
            urlJP: urlJp,
            imageUrl: imageUrl,
            isTranslatedJP: !entry.isUntranslated,
            extractedFrom: path.basename(url),
            pageType: pageType,
            contentType: entry.type,
            lastUpdated: currentTime,
            createdAt: isNewItem ? currentTime : (existingItem.createdAt || existingItem.lastUpdated)
          });
          
          // 各エントリ処理後に500ms待機（レート制限対策）
          if (urlForImageExtraction && entry.type === 'scp') {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
        
        console.log(`${url}から${scpEntries.length}件のデータを抽出完了\n`);
        this.processedCount++;
        return scpEntries;
        
      } catch (error) {
        console.error(`URL ${url}の処理エラー (試行 ${attempt}/${maxRetries}):`, error.message);
        
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
   * 既存データを読み込み
   */
  loadExistingData() {
    const dataFilePath = path.join(this.outputDir, 'scp-data.json');
    if (fs.existsSync(dataFilePath)) {
      try {
        const existingContent = fs.readFileSync(dataFilePath, 'utf8');
        const existingData = JSON.parse(existingContent);
        if (existingData.data && Array.isArray(existingData.data)) {
          const existingMap = new Map();
          existingData.data.forEach(item => {
            existingMap.set(item.itemId, item);
          });
          return existingMap;
        }
      } catch (error) {
        console.warn('既存データの読み込みに失敗:', error.message);
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
    console.log('=== ローカル全URL処理開始 ===');
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
    fs.writeFileSync(dataFilePath, JSON.stringify(crawlResult, null, 2), 'utf8');
    console.log(`\nデータを保存: ${dataFilePath}`);
    
    // メタデータファイル
    const metaFilePath = path.join(this.outputDir, 'meta.json');
    const meta = {
      lastUpdated: crawlResult.timestamp,
      totalCount: crawlResult.totalCount,
      status: crawlResult.status,
      duration: crawlResult.duration,
      statistics: crawlResult.statistics,
      dataFile: 'scp-data.json'
    };
    fs.writeFileSync(metaFilePath, JSON.stringify(meta, null, 2), 'utf8');
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

// メイン実行
if (require.main === module) {
  const crawler = new LocalSCPCrawler();
  crawler.saveResults().catch(error => {
    console.error('ローカルクローラー実行エラー:', error);
    process.exit(1);
  });
}

module.exports = { LocalSCPCrawler };