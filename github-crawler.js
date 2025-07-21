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
      'http://scp-jp.wikidot.com/archived-scps',
      'http://scp-jp.wikidot.com/scp-ex',
      'http://scp-jp.wikidot.com/log-of-anomalous-items',
      'http://scp-jp.wikidot.com/log-of-extranormal-events',
      'http://scp-jp.wikidot.com/log-of-unexplained-locations',
      'http://scp-jp.wikidot.com/foundation-tales',
      'http://scp-jp.wikidot.com/canon-hub',
      'http://scp-jp.wikidot.com/goi-formats',
      'http://scp-jp.wikidot.com/incident-reports-eye-witness-interviews-and-personal-logs',
      'http://scp-jp.wikidot.com/audio-adaptations',
      'http://scp-jp.wikidot.com/creepy-pasta',
      'http://scp-jp.wikidot.com/contest-archive',
      'http://scp-jp.wikidot.com/scp-series-jp',
      'http://scp-jp.wikidot.com/scp-series-jp-2',
      'http://scp-jp.wikidot.com/scp-series-jp-3',
      'http://scp-jp.wikidot.com/scp-series-jp-4',
      'http://scp-jp.wikidot.com/heritage-collection-jp',
      'http://scp-jp.wikidot.com/joke-scps-jp',
      'http://scp-jp.wikidot.com/archived-scps-jp',
      'http://scp-jp.wikidot.com/scp-jp-ex',
      'http://scp-jp.wikidot.com/log-of-anomalous-items-jp',
      'http://scp-jp.wikidot.com/log-of-extranormal-events-jp',
      'http://scp-jp.wikidot.com/log-of-unexplained-locations-jp',
      'http://scp-jp.wikidot.com/foundation-tales-jp',
      'http://scp-jp.wikidot.com/canon-hub-jp',
      'http://scp-jp.wikidot.com/series-hub-jp',
      'http://scp-jp.wikidot.com/goi-formats-jp',
      'http://scp-jp.wikidot.com/collaboration-hub-jp',
      'http://scp-jp.wikidot.com/supplement-hub-jp',
      'http://scp-jp.wikidot.com/event-archive-jp',
      'http://scp-jp.wikidot.com/anthology-hub-jp'
    ];
  }

  /**
   * ページタイプを判定
   */
  getPageType(url) {
    const pageName = path.basename(url);
    
    if (pageName.match(/^scp-series/)) return 'scp-series';
    if (pageName.match(/^joke-scps/)) return 'joke-scps';
    if (pageName.match(/foundation-tales/)) return 'tales';
    if (pageName.match(/canon-hub/)) return 'canon';
    if (pageName.match(/log-of-/)) return 'logs';
    if (pageName.match(/goi-formats/)) return 'goi';
    if (pageName.match(/hub|archive|collection/)) return 'hub';
    
    return 'default';
  }

  /**
   * SCPシリーズページからデータを抽出
   */
  extractFromScpSeries(document) {
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
            itemId: scpNumber,
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
   * Taleページからデータを抽出
   */
  extractFromTales(document) {
    const entries = [];
    const tables = document.querySelectorAll('table.wiki-content-table');
    
    tables.forEach(table => {
      const rows = table.querySelectorAll('tr');
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 2) {
          const link = cells[0].querySelector('a');
          if (link && link.getAttribute('href')) {
            const href = link.getAttribute('href');
            const title = link.textContent.trim();
            const description = cells[1].textContent.trim();
            
            entries.push({
              itemId: title,
              title: description || title,
              url: href,
              isUntranslated: link.classList.contains('newpage'),
              type: 'tale'
            });
          }
        }
      });
    });
    
    return entries;
  }

  /**
   * Canon Hubページからデータを抽出
   */
  extractFromCanonHub(document) {
    const entries = [];
    const headers = document.querySelectorAll('h1, h2, h3');
    
    headers.forEach(header => {
      const link = header.querySelector('a');
      if (link && link.getAttribute('href')) {
        const href = link.getAttribute('href');
        const title = link.textContent.trim();
        
        // 次の段落から説明を取得
        let description = '';
        let nextElement = header.nextElementSibling;
        if (nextElement && nextElement.tagName === 'P') {
          description = nextElement.textContent.trim();
        }
        
        entries.push({
          itemId: title,
          title: description || title,
          url: href,
          isUntranslated: link.classList.contains('newpage'),
          type: 'canon'
        });
      }
    });
    
    return entries;
  }

  /**
   * ログページからデータを抽出（リンクがないため基本情報のみ）
   */
  extractFromLogs(document) {
    const entries = [];
    const paragraphs = document.querySelectorAll('p');
    let itemCount = 0;
    
    paragraphs.forEach(p => {
      const text = p.textContent.trim();
      if (text.includes('説明:') || text.includes('Description:')) {
        itemCount++;
        const descMatch = text.match(/説明:\s*(.+?)(\n|$)/);
        const description = descMatch ? descMatch[1].trim() : text.substring(0, 100);
        
        entries.push({
          itemId: itemCount.toString(),
          title: description,
          url: null, // ログアイテムは個別URLなし
          isUntranslated: false,
          type: 'log'
        });
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
          case 'joke-scps':
            rawEntries = this.extractFromScpSeries(document);
            break;
          case 'tales':
            rawEntries = this.extractFromTales(document);
            break;
          case 'canon':
            rawEntries = this.extractFromCanonHub(document);
            break;
          case 'logs':
            rawEntries = this.extractFromLogs(document);
            break;
          default:
            rawEntries = this.extractFromDefault(document);
            break;
        }
        
        // 統一フォーマットに変換
        const scpEntries = rawEntries.map(entry => ({
          itemId: entry.itemId,
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