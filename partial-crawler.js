const fs = require('fs');
const path = require('path');
const { LocalSCPCrawler } = require('./local-crawler');
const { LANGUAGES } = require('./languages');

/**
 * 分割実行用SCP Crawler（多言語対応）
 * 指定言語の一覧ページ1枚だけをクロールし、結果を partial-data/<lang>--<page>.json に出力する。
 * GitHub Actionsのmatrixジョブから1ページずつ呼び出し、merge-data.jsで結合する。
 *
 * 使い方: node partial-crawler.js <lang> <page>
 *   例: node partial-crawler.js jp scp-series-3
 *       node partial-crawler.js cn scp-series-cn-2
 * 後方互換: 引数1つの場合はjpのページ名として扱う。
 */
async function main() {
  let lang = process.argv[2];
  let page = process.argv[3];
  if (lang && !page && !LANGUAGES[lang]) {
    // 旧形式 (node partial-crawler.js <page>) の後方互換
    page = lang;
    lang = 'jp';
  }
  if (!lang || !page) {
    console.error('使い方: node partial-crawler.js <lang> <page>  (例: node partial-crawler.js jp scp-series-3)');
    process.exit(1);
  }

  const crawler = new LocalSCPCrawler(lang);
  const validPages = crawler.config.pages.map(p => p.path);
  if (!validPages.includes(page)) {
    console.error(`不明なページ: ${page} (言語: ${lang})`);
    console.error(`有効なページ: ${validPages.join(', ')}`);
    process.exit(1);
  }

  const url = `${crawler.baseUrl}/${page}`;
  const outputDir = path.join(__dirname, 'partial-data');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`=== 分割クロール開始: ${lang}/${page} ===`);
  crawler.startTime = new Date();
  crawler.totalUrls = 1;

  // 既存のlocal-dataを読み込み、createdAt・取得済み画像URLを引き継ぐ
  const existingData = crawler.loadExistingData();
  console.log(`既存データ件数: ${existingData.size}`);

  const entries = await crawler.extractScpDataFromUrl(url, existingData);
  if (entries.length === 0) {
    console.error(`${page} から1件も抽出できませんでした。ページ構造の変化かネットワークエラーの可能性があります。`);
    process.exit(1);
  }

  const endTime = new Date();
  const duration = Math.round((endTime - crawler.startTime) / 1000);

  // 言語間でファイル名が衝突しないよう <lang>--<page>.json 形式で出力
  const partialFilePath = path.join(outputDir, `${lang}--${page}.json`);
  fs.writeFileSync(partialFilePath, JSON.stringify({
    lang: lang,
    page: page,
    url: url,
    timestamp: crawler.startTime.toISOString(),
    duration: duration,
    totalCount: entries.length,
    data: entries,
  }, null, 2), 'utf8');

  console.log(`\n=== 分割クロール完了: ${lang}/${page} ===`);
  console.log(`件数: ${entries.length} / 実行時間: ${Math.floor(duration / 60)}分${duration % 60}秒`);
  console.log(`出力: ${partialFilePath}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error('分割クローラー実行エラー:', error);
    process.exit(1);
  });
}
