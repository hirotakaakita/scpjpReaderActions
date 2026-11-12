'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),z=require('node:zlib');
const {repair}=require('../tool/repair-catalog-excerpts');
const {apply}=require('../tool/apply-excerpt-repairs');
const {writeState,readState}=require('../catalog-indexes');
const {saveCache,loadCache}=require('../related-documents');
test('bulk repair strips widgets without requests, refetches missing prose, and repairs all matching stores',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'excerpt-repair-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const date='2026-11-01T00:00:00Z',url='https://scp-jp.wikidot.com/scp-173',story='https://scp-jp.wikidot.com/story';
 const row={itemId:'scp-series-173',urlJP:url,descriptionExcerpt:'アイテム番号: SCP-173 オブジェクトクラス: Euclid',imageUrl:'same.png',tags:['scp'],lastUpdated:date};
 const dir=path.join(root,'local-data/jp');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'scp-data.json'),JSON.stringify({language:'jp',timestamp:date,totalCount:1,data:[row]}));
 fs.writeFileSync(path.join(dir,'meta.json'),JSON.stringify({lastUpdated:date,totalCount:1}));
 const records={[url]:{url,language:'jp',descriptionExcerpt:row.descriptionExcerpt},[story]:{url:story,language:'jp',descriptionExcerpt:'評価: +12+–x The actual story.'}};
 const index=path.join(root,'local-data/catalog-indexes/jp.json.gz');writeState(index,{schemaVersion:1,records,indexes:{},attempts:{}});
 const cache=path.join(root,'local-data/related-document-cache');saveCache(cache,new Map(Object.entries(records)),new Map());
 let requests=0;const report=await repair({root,language:'jp',intervalMs:0,request:async requested=>{requests++;assert.equal(requested,url);return {url,descriptionExcerpt:'SCP-173 is a statue.',contentSha256:'a'.repeat(64)};}});
 assert.equal(requests,1);assert.equal(report.failed.length,0);assert.equal(report.pending.length,0);
 const resumed=await repair({root,language:'jp',intervalMs:0,previousFile:path.join(root,'partial-data/excerpt-repairs/jp.json.gz'),request:async()=>{throw Error('Completed repairs should not be fetched again');}});
 assert.equal(resumed.requests,0);assert.equal(resumed.edits.length,report.edits.length);
 const applied=apply({root});assert.equal(applied.counts.primary,1);assert.equal(applied.counts.index,2);assert.equal(applied.counts.cache,2);
 const next=JSON.parse(fs.readFileSync(path.join(dir,'scp-data.json'))).data[0];
 assert.equal(next.descriptionExcerpt,'SCP-173 is a statue.');for(const k of ['itemId','urlJP','imageUrl','tags','lastUpdated'])assert.deepEqual(next[k],row[k]);
 assert.equal(readState(index).records[story].descriptionExcerpt,'The actual story.');assert.equal(loadCache(cache).records.get(story).descriptionExcerpt,'The actual story.');
 assert.equal(apply({root}).counts.primary,0);
 // A later successful fetch wins over repairs prepared from an older excerpt.
 const current=JSON.parse(fs.readFileSync(path.join(dir,'scp-data.json')));current.data[0].descriptionExcerpt='A newer observation.';fs.writeFileSync(path.join(dir,'scp-data.json'),JSON.stringify(current));apply({root});
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'scp-data.json'))).data[0].descriptionExcerpt,'A newer observation.');
});
