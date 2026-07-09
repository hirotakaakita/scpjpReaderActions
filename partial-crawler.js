const fs = require('fs');
const path = require('path');
const { LocalSCPCrawler } = require('./local-crawler');

/**
 * 分割実行用SCP Crawler
 * 一覧ページ1枚だけをクロールし、結果を partial-data/<page>.json に出力する。
 * GitHub Actionsのmatrixジョブから1ページずつ呼び出し、merge-data.jsで結合する。
 *
 * 使い方: node partial-crawler.js <page>
 *   例: node partial-crawler.js scp-series-3
 */
async function main() {
  const page = process.argv[2];
  if (!page) {
    console.error('使い方: node partial-crawler.js <page>  (例: scp-series-3)');
    process.exit(1);
  }

  const crawler = new LocalSCPCrawler();
  const validPages = crawler.getUrls().map(url => path.basename(url));
  if (!validPages.includes(page)) {
    console.error(`不明なページ: ${page}`);
    console.error(`有効なページ: ${validPages.join(', ')}`);
    process.exit(1);
  }

  const url = `${crawler.baseUrl}/${page}`;
  const outputDir = path.join(__dirname, 'partial-data');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`=== 分割クロール開始: ${page} ===`);
  crawler.startTime = new Date();
  crawler.totalUrls = 1;

  // 既存のlocal-data/scp-data.jsonを読み込み、createdAt・取得済み画像URLを引き継ぐ
  const existingData = crawler.loadExistingData();
  console.log(`既存データ件数: ${existingData.size}`);

  const entries = await crawler.extractScpDataFromUrl(url, existingData);
  if (entries.length === 0) {
    console.error(`${page} から1件も抽出できませんでした。ページ構造の変化かネットワークエラーの可能性があります。`);
    process.exit(1);
  }

  const endTime = new Date();
  const duration = Math.round((endTime - crawler.startTime) / 1000);

  const partialFilePath = path.join(outputDir, `${page}.json`);
  fs.writeFileSync(partialFilePath, JSON.stringify({
    page: page,
    url: url,
    timestamp: crawler.startTime.toISOString(),
    duration: duration,
    totalCount: entries.length,
    data: entries,
  }, null, 2), 'utf8');

  console.log(`\n=== 分割クロール完了: ${page} ===`);
  console.log(`件数: ${entries.length} / 実行時間: ${Math.floor(duration / 60)}分${duration % 60}秒`);
  console.log(`出力: ${partialFilePath}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error('分割クローラー実行エラー:', error);
    process.exit(1);
  });
}
