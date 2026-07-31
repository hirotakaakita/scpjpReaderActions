const fs = require('fs');
const path = require('path');
const { stringifyAsciiSafe } = require('./local-crawler');
const { LANGUAGES } = require('./languages');

/**
 * 分割クロール結果の結合スクリプト（多言語対応）
 * partial-data/<lang>--<page>.json (partial-crawler.jsの出力) を言語ごとに結合し、
 * local-data/<lang>/scp-data.json と meta.json を生成する。
 * JPは旧バージョンのアプリが参照する local-data/ 直下にも同じ内容を出力する。
 *
 * 言語単位の全ページが揃っていない言語はスキップし、前回のlocal-dataを維持する
 * （欠けたままマージすると、アプリ配信データから記事が消えてしまうため）。
 * 1言語も結合できなかった場合はエラー終了する。
 *
 * 使い方: node merge-data.js [lang]  (省略時: 全言語)
 */
function mergeLanguage(lang, partialDir, baseOutputDir) {
  const config = LANGUAGES[lang];
  const pages = config.pages.map(page => page.path);

  // 全ページ分の部分ファイルが揃っているか検証
  const missing = pages.filter(page => !fs.existsSync(path.join(partialDir, `${lang}--${page}.json`)));
  if (missing.length > 0) {
    console.warn(`[${lang}] 部分ファイルが不足 (${missing.length}件): ${missing.join(', ')}`);
    console.warn(`[${lang}] 欠損したままマージすると配信データから記事が消えるためスキップします（前回データを維持）。`);
    return false;
  }

  // クロール対象URLと同じ順序で結合
  const results = [];
  const timestamps = [];
  let totalDuration = 0;

  for (const page of pages) {
    const partial = JSON.parse(fs.readFileSync(path.join(partialDir, `${lang}--${page}.json`), 'utf8'));
    if (!Array.isArray(partial.data) || partial.data.length === 0) {
      console.warn(`[${lang}] ${page}.json のdataが空のためスキップします。`);
      return false;
    }
    results.push(...partial.data);
    timestamps.push(partial.timestamp);
    totalDuration += partial.duration || 0;
    console.log(`[${lang}] ${page}: ${partial.data.length}件`);
  }

  // itemIdの重複チェック（重複はデータ不整合のサイン）
  const seen = new Set();
  const duplicates = new Set();
  for (const item of results) {
    if (seen.has(item.itemId)) duplicates.add(item.itemId);
    seen.add(item.itemId);
  }
  if (duplicates.size > 0) {
    console.warn(`[${lang}] 警告: itemIdの重複が${duplicates.size}件あります: ${[...duplicates].slice(0, 10).join(', ')}`);
  }

  const withImage = results.filter(item => item.imageUrl).length;
  const translated = results.filter(item => item.isTranslatedJP).length;
  const untranslated = results.length - translated;
  const timestamp = timestamps.sort()[0]; // 最初に開始したジョブの時刻

  const crawlResult = {
    totalCount: results.length,
    language: lang,
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

  const meta = {
    lastUpdated: timestamp,
    language: lang,
    totalCount: results.length,
    status: crawlResult.status,
    duration: totalDuration,
    statistics: crawlResult.statistics,
    dataFile: 'scp-data.json',
  };

  // 出力先: local-data/<lang>/。JPは互換のためlocal-data/直下にも出力する。
  const outputDirs = [path.join(baseOutputDir, lang)];
  if (lang === 'jp') {
    outputDirs.push(baseOutputDir);
  }

  for (const outputDir of outputDirs) {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    // 非ASCIIをエスケープして配信（charset未指定配信でも文字化けしないように）
    fs.writeFileSync(path.join(outputDir, 'scp-data.json'), stringifyAsciiSafe(crawlResult), 'utf8');
    fs.writeFileSync(path.join(outputDir, 'meta.json'), stringifyAsciiSafe(meta), 'utf8');
  }

  console.log(`[${lang}] 結合完了: ${results.length}件（翻訳済み ${translated} / 未翻訳 ${untranslated} / 画像付き ${withImage}）`);
  return true;
}

function main() {
  const langArg = process.argv[2];
  const partialDir = path.resolve(path.join(__dirname, 'partial-data'));
  const baseOutputDir = path.join(__dirname, 'local-data');

  const langs = langArg ? [langArg] : Object.keys(LANGUAGES);
  if (langArg && !LANGUAGES[langArg]) {
    console.error(`未対応の言語コード: ${langArg}`);
    process.exit(1);
  }

  const merged = [];
  const skipped = [];
  for (const lang of langs) {
    if (mergeLanguage(lang, partialDir, baseOutputDir)) {
      merged.push(lang);
    } else {
      skipped.push(lang);
    }
  }

  console.log(`\n=== 結合結果 ===`);
  console.log(`成功: ${merged.length}言語 (${merged.join(', ') || 'なし'})`);
  if (skipped.length > 0) {
    console.log(`スキップ: ${skipped.length}言語 (${skipped.join(', ')})`);
  }

  if (merged.length === 0) {
    console.error('1言語も結合できませんでした。');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { mergeLanguage };
