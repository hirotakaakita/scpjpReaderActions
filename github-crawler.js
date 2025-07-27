const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const axios = require('axios');

/**
 * GitHub Actions用SCP Crawler
 * クロール結果をJSONファイルとして保存
 */
class GitHubSCPCrawler {
  constructor() {
    this.baseUrl = 'http://scp-jp.wikidot.com';
    this.results = [];
    this.outputDir = path.join(__dirname, 'data');
    
    // dataディレクトリを作成
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * 対象URLリスト
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
            numericItemId: scpNumber,
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
   * URLからSCPデータを抽出
   */
  async extractScpDataFromUrl(url, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`処理中: ${url} (試行 ${attempt}/${maxRetries})`);
        
        const response = await axios.get(url, {
          timeout: 60000, // 60秒タイムアウト
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; SCPCrawler/1.0; GitHub Actions)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
          }
        });
        
        console.log(`レスポンス受信: ${url} - ${response.status}`);
        const dom = new JSDOM(response.data);
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
        
        // 統一フォーマットに変換
        const scpEntries = rawEntries.map(entry => ({
          itemId: entry.itemId,
          numericItemId: entry.numericItemId || null,
          title: entry.title,
          url: entry.url ? `${this.baseUrl}${entry.url}` : null,
          isUntranslated: entry.isUntranslated,
          extractedFrom: path.basename(url),
          pageType: pageType,
          contentType: entry.type,
          lastUpdated: new Date().toISOString()
        }));
        
        console.log(`${url}から${scpEntries.length}件のデータを抽出`);
        return scpEntries;
        
      } catch (error) {
        console.error(`URL ${url}の処理エラー (試行 ${attempt}/${maxRetries}):`, error.message);
        
        if (attempt === maxRetries) {
          console.error(`${url}の処理に${maxRetries}回失敗しました`);
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
   * すべてのURLからデータを収集
   */
  async crawlAllData() {
    console.log('=== GitHub Actions SCP Crawler 開始 ===');
    const startTime = new Date();
    
    const urls = this.getUrls();
    console.log(`対象URL数: ${urls.length}`);
    
    this.results = [];
    
    for (const url of urls) {
      const entries = await this.extractScpDataFromUrl(url);
      this.results.push(...entries);
      
      // 各URL処理後に1秒待機
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    const endTime = new Date();
    const duration = Math.round((endTime - startTime) / 1000);
    
    console.log(`=== 収集完了 ===`);
    console.log(`総件数: ${this.results.length}`);
    console.log(`実行時間: ${duration}秒`);
    
    return {
      totalCount: this.results.length,
      timestamp: startTime.toISOString(),
      duration: duration,
      status: 'completed',
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
    console.log(`データを保存: ${dataFilePath}`);
    
    // メタデータファイル（Firebase Functionsが参照用）
    const metaFilePath = path.join(this.outputDir, 'meta.json');
    const meta = {
      lastUpdated: crawlResult.timestamp,
      totalCount: crawlResult.totalCount,
      status: crawlResult.status,
      duration: crawlResult.duration,
      dataFile: 'scp-data.json'
    };
    fs.writeFileSync(metaFilePath, JSON.stringify(meta, null, 2), 'utf8');
    console.log(`メタデータを保存: ${metaFilePath}`);
    
    return crawlResult;
  }
}

// メイン実行
if (require.main === module) {
  const crawler = new GitHubSCPCrawler();
  crawler.saveResults().catch(error => {
    console.error('クローラー実行エラー:', error);
    process.exit(1);
  });
}

module.exports = { GitHubSCPCrawler };