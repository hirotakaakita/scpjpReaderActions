const fs = require('fs');
const path = require('path');
const { stringifyAsciiSafe } = require('./local-crawler');

const MANGA_DIR = path.join(__dirname, 'manga');
const LOCAL_DATA_DIR = path.join(__dirname, 'local-data');

const MANGA_DIR_NAME_PATTERN = /^scp-(\d+)$/;

/**
 * manga/scp-<N>/<lang>.png (base.png除く) の実在ファイルから
 * SCP番号(N) -> 利用可能言語コード配列 のマップを作る。
 * meta.jsonのlanguagesは生成予定言語であり実際に生成済みとは限らないため使わない。
 */
function buildMangaLanguageMap() {
  const map = {};
  if (!fs.existsSync(MANGA_DIR)) return map;

  for (const dirName of fs.readdirSync(MANGA_DIR)) {
    const itemDir = path.join(MANGA_DIR, dirName);
    if (!fs.statSync(itemDir).isDirectory()) continue;

    const match = dirName.match(MANGA_DIR_NAME_PATTERN);
    if (!match) {
      console.warn(`manga/${dirName}: "scp-<数字>"形式ではないためスキップします。`);
      continue;
    }

    const languages = fs.readdirSync(itemDir)
      .filter(name => name.endsWith('.png') && name !== 'base.png')
      .map(name => name.slice(0, -'.png'.length))
      .sort();

    if (languages.length > 0) {
      map[Number(match[1])] = languages;
    }
  }
  return map;
}

/** local-data/ 配下の scp-data.json を再帰的に探す（各言語ディレクトリ＋jp互換の直下コピー） */
function findScpDataFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findScpDataFiles(fullPath));
    } else if (entry.name === 'scp-data.json') {
      results.push(fullPath);
    }
  }
  return results;
}

/** 1ファイル分にmangaLanguagesを反映する。変更があった場合のみ書き戻してtrueを返す */
function applyToFile(filePath, mangaMap) {
  const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(json.data)) return false;

  let changed = false;
  for (const item of json.data) {
    // 国際版の正規記事のみが対象。支部オリジナル記事（scp-series-jp等）は
    // numericItemIdが衝突しても別記事なので除外する。
    const isCanonicalSeries = item.pageType === 'scp-series';
    const languages = isCanonicalSeries ? mangaMap[item.numericItemId] : undefined;
    if (languages) {
      if (JSON.stringify(item.mangaLanguages) !== JSON.stringify(languages)) {
        item.mangaLanguages = languages;
        changed = true;
      }
    } else if (item.mangaLanguages) {
      // 漫画が取り下げられた場合に古いフラグが残らないようにする
      delete item.mangaLanguages;
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, stringifyAsciiSafe(json), 'utf8');
  }
  return changed;
}

function main() {
  const mangaMap = buildMangaLanguageMap();
  console.log(`漫画データを検出: ${Object.keys(mangaMap).length}件`);

  if (!fs.existsSync(LOCAL_DATA_DIR)) {
    console.error('local-data ディレクトリが見つかりません。');
    process.exit(1);
  }

  const files = findScpDataFiles(LOCAL_DATA_DIR);
  let updatedFiles = 0;
  for (const file of files) {
    if (applyToFile(file, mangaMap)) {
      updatedFiles++;
      console.log(`更新: ${path.relative(__dirname, file)}`);
    }
  }
  console.log(`完了: ${files.length}ファイル中${updatedFiles}件を更新しました。`);
}

if (require.main === module) {
  main();
}

module.exports = { buildMangaLanguageMap, applyToFile };
