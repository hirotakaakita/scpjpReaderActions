'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const {advanceClassificationTimestamp}=require('../catalog-classification-version');

test('classification-only changes advance the reader version, then stay stable on rerun',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'scp-classification-version-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 function publish(catalog){
  const bytes=zlib.gzipSync(JSON.stringify(catalog)),sha256=crypto.createHash('sha256').update(bytes).digest('hex'),fileName='catalog-'+sha256+'.json.gz';
  fs.writeFileSync(path.join(root,fileName),bytes);
  fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({timestamp:catalog.timestamp,fileName,sha256}));
 }
 const row={urlJP:'https://scp-wiki.wikidot.com/scp-2615-j',itemId:'scp-series-2615-j',pageType:'scp-series',contentType:'scp',extractedFrom:'scp-series',numericItemId:2615};
 const timestamp='2026-01-01T00:00:00Z';publish({timestamp,data:[row]});
 const fixed={timestamp,data:[{...row,itemId:'joke-scps-2615',pageType:'joke-scps',extractedFrom:'joke-scps'}]};
 advanceClassificationTimestamp(fixed,root);assert(Date.parse(fixed.timestamp)>Date.parse(timestamp));
 publish(fixed);
 const again={...fixed,timestamp};advanceClassificationTimestamp(again,root);assert.equal(again.timestamp,fixed.timestamp);
});

test('multiple published reader keys for one URL do not trigger a new version on every rebuild',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'scp-alias-version-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const timestamp='2026-01-01T00:00:00Z',urlJP='https://scp-wiki.wikidot.com/scp-2615-j';
 const data=[{urlJP,itemId:'original-key',pageType:'joke-scps'},{urlJP,itemId:'legacy-key',pageType:'related-document-en'}];
 const bytes=zlib.gzipSync(JSON.stringify({timestamp,data})),sha256=crypto.createHash('sha256').update(bytes).digest('hex'),fileName='catalog-'+sha256+'.json.gz';
 fs.writeFileSync(path.join(root,fileName),bytes);fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({timestamp,fileName,sha256}));
 const same={timestamp,data:structuredClone(data)};advanceClassificationTimestamp(same,root);assert.equal(same.timestamp,timestamp);
 same.data[0].pageType='scp-series';advanceClassificationTimestamp(same,root);assert(Date.parse(same.timestamp)>Date.parse(timestamp));
});
