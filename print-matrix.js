const { LANGUAGES } = require('./languages');

/**
 * GitHub Actionsのmatrix定義（言語サイト単位）をJSONで出力する。
 * ワークフローのsetupジョブから呼び出し、fromJSONでcrawlジョブのmatrixに渡す。
 *
 * 使い方: node print-matrix.js
 * 出力例: {"include":[{"lang":"jp"}, {"lang":"en"}, ...]}
 */
const selected = process.env.ADDITIONAL_SITES_ONLY === '1'
  ? Object.keys(require('./additional-sites.json'))
  : Object.keys(LANGUAGES);
const include = selected.map(lang => ({ lang, host: new URL(LANGUAGES[lang].baseUrl).hostname }));
if(process.env.REPAIR_EXCERPTS_ONLY==='1'){
  const fs=require('node:fs'),path=require('node:path'),z=require('node:zlib'),quality=require('./article-excerpts');
  const weight=lang=>{try{const dir=path.join(__dirname,'local-data/mobile-v3',lang),m=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),rows=JSON.parse(z.gunzipSync(fs.readFileSync(path.join(dir,m.fileName)))).data;return rows.filter(r=>!r.descriptionExcerpt||quality.titleNeedsRepair(r.titleJP)||quality.repairStoredExcerpt(r.descriptionExcerpt).needsFetch||quality.datePrefix(r.descriptionExcerpt)).length;}catch{return 0;}};
  const counts=new Map(selected.map(lang=>[lang,weight(lang)]));include.sort((a,b)=>counts.get(b.lang)-counts.get(a.lang));
}

if (include.length > 256) {
  // GitHub Actionsのmatrix上限
  console.error(`matrixエントリ数が上限(256)を超えています: ${include.length}`);
  process.exit(1);
}

console.log(JSON.stringify({ include: include }));
