const fs = require('fs');
const path = require('path');
const { stringifyAsciiSafe } = require('./local-crawler');
const { LANGUAGES } = require('./languages');
const { publicTags } = require('./public-tags');
const { readDictionary, indexDictionary, localizeTags } = require('./tag-dictionary');

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
    results.push(...partial.data.map(item => ({ ...item, tags: publicTags(item.tags) })));
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

/**
 * 全言語の同一itemIdを突き合わせ、翻訳済み言語コードを各カタログへ付与する。
 * 既存のisTranslatedJPは後方互換のため残し、新しいtranslatedLanguagesを追加する。
 */
function addTranslatedLanguages(baseOutputDir, languages) {
  const translatedByItem = new Map();
  const catalogs = new Map();
  // 部分クロール失敗時も、既存カタログの翻訳状況を失わないようにする。
  const orderedLanguages = Object.keys(LANGUAGES).filter(lang =>
    fs.existsSync(path.join(baseOutputDir, lang, 'scp-data.json'))
  );

  for (const lang of orderedLanguages) {
    const filePath = path.join(baseOutputDir, lang, 'scp-data.json');
    if (!fs.existsSync(filePath)) continue;
    const catalog = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    catalogs.set(lang, { filePath, catalog });
    for (const item of catalog.data || []) {
      if (!item.isTranslatedJP) continue;
      if (!translatedByItem.has(item.itemId)) translatedByItem.set(item.itemId, new Set());
      translatedByItem.get(item.itemId).add(lang);
    }
  }

  for (const [lang, { filePath, catalog }] of catalogs) {
    catalog.data = (catalog.data || []).map(item => ({
      ...item,
      tags: publicTags(item.tags),
      translatedLanguages: [...(translatedByItem.get(item.itemId) || [])],
    }));
    fs.writeFileSync(filePath, stringifyAsciiSafe(catalog), 'utf8');
    if (lang === 'jp') {
      fs.writeFileSync(path.join(baseOutputDir, 'scp-data.json'), stringifyAsciiSafe(catalog), 'utf8');
    }
  }
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
  addTranslatedLanguages(baseOutputDir, merged);
  applyTagDictionary(baseOutputDir, readDictionary(path.join(__dirname, 'tag-dictionary.json')));
}

function applyTagDictionary(baseOutputDir, dictionary) {
  const index = indexDictionary(dictionary);
  const generatedAt = new Date().toISOString();
  for (const lang of Object.keys(LANGUAGES)) {
    const file = path.join(baseOutputDir, lang, 'scp-data.json');
    if (!fs.existsSync(file)) continue;
    const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
    catalog.tagSchemaVersion = 2;
    // Retained languages also need a new cache timestamp when labels are rebuilt.
    catalog.timestamp = generatedAt;
    for (const item of catalog.data || []) {
      item.tags = localizeTags(item.tags, lang, dictionary, index);
    }
    const json = stringifyAsciiSafe(catalog);
    fs.writeFileSync(file, json, 'utf8');
    if (lang === 'jp') fs.writeFileSync(path.join(baseOutputDir, 'scp-data.json'), json, 'utf8');
    const metaFile = path.join(baseOutputDir, lang, 'meta.json');
    if (fs.existsSync(metaFile)) {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      meta.lastUpdated = generatedAt;
      meta.tagSchemaVersion = 2;
      const metaJson = stringifyAsciiSafe(meta);
      fs.writeFileSync(metaFile, metaJson, 'utf8');
      if (lang === 'jp') fs.writeFileSync(path.join(baseOutputDir, 'meta.json'), metaJson, 'utf8');
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = { mergeLanguage, addTranslatedLanguages, applyTagDictionary };
