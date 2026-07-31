const { LANGUAGES } = require('./languages');

/**
 * GitHub Actionsのmatrix定義（全言語×全ページ）をJSONで出力する。
 * ワークフローのsetupジョブから呼び出し、fromJSONでcrawlジョブのmatrixに渡す。
 *
 * 使い方: node print-matrix.js
 * 出力例: {"include":[{"lang":"jp","page":"scp-series"}, ...]}
 */
const include = [];
for (const [lang, config] of Object.entries(LANGUAGES)) {
  for (const page of config.pages) {
    include.push({ lang: lang, page: page.path });
  }
}

if (include.length > 256) {
  // GitHub Actionsのmatrix上限
  console.error(`matrixエントリ数が上限(256)を超えています: ${include.length}`);
  process.exit(1);
}

console.log(JSON.stringify({ include: include }));
