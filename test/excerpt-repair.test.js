'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),z=require('node:zlib');
const {repair}=require('../tool/repair-catalog-excerpts');
const {apply}=require('../tool/apply-excerpt-repairs');
const {writeState,readState}=require('../catalog-indexes');
const {saveCache,loadCache}=require('../related-documents');

test('null excerpts and blank titles are refetched and repaired without changing correct titles',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'excerpt-null-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'local-data/jp');fs.mkdirSync(dir,{recursive:true});
 const data=[{urlJP:'https://scp-jp.wikidot.com/scp-002',titleJP:'',descriptionExcerpt:null},{urlJP:'https://scp-jp.wikidot.com/scp-003',titleJP:'Known title',descriptionExcerpt:null}];
 fs.writeFileSync(path.join(dir,'scp-data.json'),JSON.stringify({data}));fs.writeFileSync(path.join(dir,'meta.json'),'{}');
 const report=await repair({root,language:'jp',intervalMs:0,request:async url=>({url,title:'Source title',descriptionExcerpt:'The actual article body.'})});
 assert.equal(report.requests,2);apply({root});const after=JSON.parse(fs.readFileSync(path.join(dir,'scp-data.json'))).data;
 assert.equal(after[0].titleJP,'Source title');assert.equal(after[1].titleJP,'Known title');assert(after.every(r=>r.descriptionExcerpt==='The actual article body.'));
});
test('bulk repair strips widgets without requests, refetches missing prose, and repairs all matching stores',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'excerpt-repair-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const date='2026-11-01T00:00:00Z',url='https://scp-jp.wikidot.com/scp-173',story='https://scp-jp.wikidot.com/story';
 const row={itemId:'scp-series-173',titleJP:'日本語のタイトル',urlJP:url,descriptionExcerpt:'アイテム番号: SCP-173 オブジェクトクラス: Euclid',imageUrl:'same.png',tags:['scp'],lastUpdated:date};
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
 assert.equal(next.titleJP,row.titleJP);assert(/^[\x00-\x7f]*$/.test(fs.readFileSync(path.join(dir,'scp-data.json'),'utf8')));
 assert.equal(next.descriptionExcerpt,'SCP-173 is a statue.');for(const k of ['itemId','urlJP','imageUrl','tags','lastUpdated'])assert.deepEqual(next[k],row[k]);
 assert.equal(readState(index).records[story].descriptionExcerpt,'The actual story.');assert.equal(loadCache(cache).records.get(story).descriptionExcerpt,'The actual story.');
 assert.equal(apply({root}).counts.primary,0);
 // A later successful fetch wins over repairs prepared from an older excerpt.
 const current=JSON.parse(fs.readFileSync(path.join(dir,'scp-data.json')));current.data[0].descriptionExcerpt='A newer observation.';fs.writeFileSync(path.join(dir,'scp-data.json'),JSON.stringify(current));apply({root});
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'scp-data.json'))).data[0].descriptionExcerpt,'A newer observation.');
});

test('unpublished removed cache records do not trigger refetches; confirmed missing published pages are retired',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'excerpt-retired-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const live='https://scp-jp.wikidot.com/removed-story',old='https://scp-jp.wikidot.com/old-removed-story';
 const record=url=>({url,language:'jp',descriptionExcerpt:'アイテム番号: SCP-173',checkedAt:'2026-11-01T00:00:00Z'});
 const index=path.join(root,'local-data/catalog-indexes/jp.json.gz');
 writeState(index,{schemaVersion:1,records:{[live]:record(live),[old]:record(old)},attempts:{},indexes:{x:{at:'2026-11-12T00:00:00Z',members:[{url:live}],missing:[old]}}});
 let requests=0;const report=await repair({root,language:'jp',intervalMs:0,request:async url=>{requests++;assert.equal(url,live);const e=Error('missing');e.response={status:404};throw e;}});
 assert.equal(requests,1);assert.equal(report.failed.length,0);assert.deepEqual(report.unavailable,[live]);
 const result=apply({root});assert.deepEqual(result.retiredUrls,[live]);assert.equal(readState(index).records[live],undefined);assert.equal(readState(index).attempts[live].status,'unavailable');assert(readState(index).records[old]);
});

test('a CSS/image article with no extractable prose keeps its identity and clears only the polluted excerpt',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'excerpt-no-prose-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const url='https://scp-jp.wikidot.com/image-story',file=path.join(root,'local-data/catalog-indexes/jp.json.gz');
 writeState(file,{schemaVersion:1,records:{[url]:{url,language:'jp',descriptionExcerpt:'評価: +12+–x'}},attempts:{},indexes:{x:{members:[{url}]}}});
 const report=await repair({root,language:'jp',intervalMs:0,request:async()=>{throw Object.assign(Error('Unavailable article: empty_body'),{articleUnavailable:true});}});
 assert.equal(report.failed.length,0);assert.equal(report.edits[0].method,'no_prose');
 assert.deepEqual(apply({root}).retiredUrls,[]);assert.equal(readState(file).records[url].descriptionExcerpt,'');
 assert.notEqual(readState(file).attempts[url]?.status,'unavailable');
});

test('an already clean excerpt repairs only the exact same URL without borrowing from a same-numbered variant',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'excerpt-exact-url-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const url='https://scp-jp.wikidot.com/scp-173',variant=url+'-j',dir=path.join(root,'local-data/jp');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'scp-data.json'),JSON.stringify({data:[{urlJP:url,descriptionExcerpt:'The correct description of the original article.'}]}));
 const file=path.join(root,'local-data/catalog-indexes/jp.json.gz');
 writeState(file,{schemaVersion:1,records:Object.fromEntries([url,variant].map(u=>[u,{url:u,descriptionExcerpt:'Item #: SCP-173 Object Class: Safe'}])),attempts:{},indexes:{x:{members:[{url},{url:variant}]}}});
 let requests=0;const report=await repair({root,language:'jp',intervalMs:0,request:async requested=>{requests++;assert.equal(requested,variant);return{url:requested,descriptionExcerpt:'The separate Joke article.'};}});
 assert.equal(requests,1);assert.equal(report.edits.find(e=>e.url===url).method,'matching_article');assert.equal(report.edits.find(e=>e.url===url).text,'The correct description of the original article.');
 assert.equal(report.edits.find(e=>e.url===variant).text,'The separate Joke article.');
});
