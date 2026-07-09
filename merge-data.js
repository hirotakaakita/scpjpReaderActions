const fs = require('fs');
const path = require('path');
const { LocalSCPCrawler } = require('./local-crawler');

/**
 * 分割クロール結果の結合スクリプト
 * partial-data/<page>.json (partial-crawler.jsの出力) を全ページ分読み込み、
 * local-crawler.jsと同じ形式で local-data/scp-data.json と meta.json を生成する。
 *
 * 全ページ分のファイルが揃っていない場合はエラー終了する
 * （欠けたままマージすると、アプリ配信データから記事が消えてしまうため）。
 *
 * 使い方: node merge-data.js [partialDir]  (省略時: ./partial-data)
 */
function main() {
  const partialDir = path.resolve(process.argv[2] || path.join(__dirname, 'partial-data'));
  const outputDir = path.join(__dirname, 'local-data');

  const crawler = new LocalSCPCrawler();
  const pages = crawler.getUrls().map(url => path.basename(url));

  // 全ページ分の部分ファイルが揃っているか検証
  const missing = pages.filter(page => !fs.existsSync(path.join(partialDir, `${page}.json`)));
  if (missing.length > 0) {
    console.error(`部分ファイルが不足しています (${missing.length}件): ${missing.join(', ')}`);
    console.error('欠損したままマージすると配信データから記事が消えるため中断します。');
    process.exit(1);
  }

  // クロール対象URLと同じ順序で結合（従来のlocal-crawler.jsの出力順と一致させる）
  const results = [];
  const timestamps = [];
  let totalDuration = 0;

  for (const page of pages) {
    const partial = JSON.parse(fs.readFileSync(path.join(partialDir, `${page}.json`), 'utf8'));
    if (!Array.isArray(partial.data) || partial.data.length === 0) {
      console.error(`${page}.json のdataが空です。中断します。`);
      process.exit(1);
    }
    results.push(...partial.data);
    timestamps.push(partial.timestamp);
    totalDuration += partial.duration || 0;
    console.log(`${page}: ${partial.data.length}件`);
  }

  // itemIdの重複チェック（同一ページ間の重複はデータ不整合のサイン）
  const seen = new Set();
  const duplicates = new Set();
  for (const item of results) {
    if (seen.has(item.itemId)) duplicates.add(item.itemId);
    seen.add(item.itemId);
  }
  if (duplicates.size > 0) {
    console.warn(`警告: itemIdの重複が${duplicates.size}件あります: ${[...duplicates].slice(0, 10).join(', ')}`);
  }

  const withImage = results.filter(item => item.imageUrl).length;
  const translated = results.filter(item => item.isTranslatedJP).length;
  const untranslated = results.length - translated;
  const timestamp = timestamps.sort()[0]; // 最初に開始したジョブの時刻

  const crawlResult = {
    totalCount: results.length,
    timestamp: timestamp,
    duration: totalDuration,
    status: 'completed',
    statistics: {
      translated: translated,
      untranslated: untranslated,
      withImage: withImage,
    },
    data: results,
  };

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(path.join(outputDir, 'scp-data.json'), JSON.stringify(crawlResult, null, 2), 'utf8');
  fs.writeFileSync(path.join(outputDir, 'meta.json'), JSON.stringify({
    lastUpdated: timestamp,
    totalCount: results.length,
    status: crawlResult.status,
    duration: totalDuration,
    statistics: crawlResult.statistics,
    dataFile: 'scp-data.json',
  }, null, 2), 'utf8');

  console.log(`\n=== 結合完了 ===`);
  console.log(`総件数: ${results.length}件（翻訳済み ${translated} / 未翻訳 ${untranslated} / 画像付き ${withImage}）`);
  console.log(`出力: ${path.join(outputDir, 'scp-data.json')}`);
}

if (require.main === module) {
  main();
}
