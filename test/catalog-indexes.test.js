'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),os=require('os');
const zlib=require('zlib');
const {parseIndex,crawl,readState,writeState}=require('../catalog-indexes');
const {buildIndexedCatalog,merge,scpIdentity}=require('../merge-catalog-indexes');
const {generateMobileCatalogs}=require('../mobile-catalog');
const date='2026-11-06T00:00:00Z',base='https://scp-jp.wikidot.com/';
const html=s=>'<div id="page-title">Index</div><div id="page-content">'+s+'</div>';
const source={url:base+'foundation-tales-jp',kind:'tale'};
const rec=(url,tags=['jp'])=>({url,title:'Work',tags,checkedAt:date,contentSha256:'a'.repeat(64),descriptionExcerpt:'Real article',availabilityVersion:1});

test('transient article failures retry after cooldown without refetching successful metadata',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'scp-index-retry-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const url=base+'retry-story';let attempts=0,indexRequests=0;
  const options={root,sources:[{...source,language:'jp'}],now:date,intervalMs:0,maxRequests:1,
    request:async()=>{indexRequests++;return html('<ul><li><a href="/retry-story">Story</a></li></ul>')},
    articleRequest:async()=>{attempts++;throw Error('socket hang up')}};
  await crawl('jp',options);
  await crawl('jp',{...options,now:'2026-11-06T00:05:00Z'});assert.equal(attempts,1);
  const later='2026-11-06T00:20:00Z';
  const state=await crawl('jp',{...options,now:later,articleRequest:async()=>{attempts++;return {...rec(url),checkedAt:later}}});
  assert.equal(attempts,2);assert.equal(indexRequests,1);assert.equal(state.attempts[url].status,'success');
});

test('embedded index redirects allow only the matching Wikidot asset',async t=>{
  const axios=require('axios'),original=axios.get;t.after(()=>{axios.get=original});
  const url=base+'hub/html/abc-123',target='https://scp-jp.wdfiles.com/local--html/hub/abc-123/scp-jp.wikidot.com/';
  axios.get=async u=>u===url?{status:302,headers:{location:target}}:{status:200,data:'embedded content'};
  assert.equal(await require('../catalog-indexes').requestHtml(url),'embedded content');
  axios.get=async()=>({status:302,headers:{location:target.replace('abc-123','wrong-asset')}});
  await assert.rejects(require('../catalog-indexes').requestHtml(url),/Unsafe index redirect/);
});
test('index lists, tables, flat SCP layouts, tabs and missing links',()=>{
  const r=parseIndex(html('<nav><a href="/nav">nav</a></nav><ul><li><a href="/work-a">A</a></li></ul><table><tr><td><a href="/work-b">B</a></td></tr></table><ul><li><a class="newpage" href="/missing">missing</a></li><li><a href="/guide-hub">guide</a></li><li><a href="https://example.com/no">external</a></li></ul>'),source,new Set());
  assert.deepEqual(r.members.map(m=>m.url),[base+'work-a',base+'work-b']);
  assert.deepEqual(r.missing,[base+'missing']);assert(r.members.every(m=>m.origin==='jp'));
  const scp=parseIndex(html('<div><a href="/scp-004-jp">SCP</a><br><a href="/guide">Guide</a></div>'),{url:base+'scp-series-jp',kind:'scp'},new Set());
  assert.deepEqual(scp.members.map(m=>m.url),[base+'scp-004-jp']);
  const mixed=parseIndex(html('<h2>SCP-EN</h2><ul><li><a href="/en-work">EN</a></li></ul><h2>SCP-ID</h2><ul><li><a href="/id-work">ID</a></li></ul><h2>SCP-KO</h2><ul><li><a href="/ko-work">KO</a></li></ul>'),{url:base+'scp-international',kind:'international-hub'},new Set());
  assert.deepEqual(mixed.members.map(m=>m.origin),['en','ko']);
});
test('pagination follows siblings relative to the root and ignores sort/filter combinations',()=>{
  const r=parseIndex(html('<a href="/foundation-tales-jp/p/3">next</a><a href="/foundation-tales-jp/order/rating">sort</a><iframe src="/foundation-tales-jp/html/123"></iframe>'),{...source,url:source.url+'/p/2',root:source.url},new Set());
  assert.deepEqual(r.pages,[source.url+'/p/3']);assert.deepEqual(r.embeds,[source.url+'/html/123']);
});
test('new tale cards and official author/title/date indexes are supported without author profiles',()=>{
  const r=parseIndex(html('<div class="tale-list"><div class="tale-block tale"><div class="title"><a href="/card-story">Story</a></div></div></div><p><a href="/tales-cn-by-create-time#2026">Dates</a><a href="/tales-by-author">Authors index</a></p>'),source,new Set());
  assert.deepEqual(r.members.map(m=>m.url),[base+'card-story']);
  assert.deepEqual(r.childIndexes,[base+'tales-cn-by-create-time',base+'tales-by-author']);
});
test('bounded crawls persist metadata and keep valid data through temporary failures',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'scp-index-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const url=base+'work-a';
  const options={root,sources:[{...source,language:'jp'}],now:date,intervalMs:0,maxRequests:1,
    request:async()=>html('<ul><li><a href="/work-a">A</a></li></ul>'),articleRequest:async()=>rec(url)};
  let s=await crawl('jp',options);assert.equal(s.statistics.available,1);
  s=await crawl('jp',{...options,now:'2026-11-14T00:00:00Z',request:async()=>{throw Error('offline')},articleRequest:async()=>{throw Error('TLS')}});
  assert.equal(s.statistics.available,1);assert.equal(s.attempts[url].status,'failed');
  assert.equal(readState(path.join(root,'partial-data/catalog-indexes/jp.json.gz')).records[url].title,'Work');
  s=await crawl('jp',{...options,now:'2026-11-22T00:00:00Z',articleRequest:async()=>{const e=Error('missing');e.response={status:404};throw e;}});
  assert.equal(s.statistics.available,0);assert.equal(s.attempts[url].status,'unavailable');
});
test('flushed checkpoints recover the last valid backup after a corrupted write',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'scp-index-recovery-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file=path.join(root,'state.json.gz');
  const state={schemaVersion:1,indexes:{},records:{},attempts:{},language:'jp'};
  writeState(file,state);writeState(file,{...state,updatedAt:date});
  fs.writeFileSync(file,Buffer.alloc(300));assert.deepEqual(readState(file),state);
  writeState(file,{...state,updatedAt:date});assert.equal(readState(file).updatedAt,date);
});
test('indexed catalogs preserve document IDs, canonical SCP work IDs and pending evidence',()=>{
  const scp=base+'scp-004-jp',work=base+'work-a',missing=base+'pending';
  const state={indexes:{[source.url]:{members:[{url:scp,kind:'scp',origin:'jp',source:source.url},{url:work,kind:'tale',origin:'jp',source:source.url},{url:missing,kind:'tale',source:source.url}],missing:[]}},records:{[scp]:rec(scp,['scp','jp']),[work]:rec(work)},attempts:{}};
  const catalog=[{itemId:'scp-series-jp-004',pageType:'scp-series-jp',urlJP:scp,isTranslatedJP:true}];
  const result=buildIndexedCatalog(catalog,{jp:state},{data:[{url:work,itemId:'document-jp--old-identity',language:'jp'}]},date);
  assert.equal(result.data.find(r=>r.url===scp).itemId,'scp-series-jp-004');
  assert.equal(result.data.find(r=>r.url===work).itemId,'document-jp--old-identity');
  assert.equal(result.data.find(r=>r.url===work).pageType,'related-document-jp');
  assert.equal(result.pending.length,1);assert.equal(result.pending[0].sourceIndexUrls[0],source.url);
});
test('guides and artwork are rejected even when a mixed official index links them',()=>{
  const url=base+'looks-like-a-story';
  const state={indexes:{x:{members:[{url,kind:'tale',source:source.url}]}},records:{[url]:rec(url,['artwork'])},attempts:{}};
  assert.equal(buildIndexedCatalog([],{jp:state},{data:[]},date).totalCount,0);
});

test('reclassifying a published document as SCP preserves its reading identity',()=>{
  const url=base+'scp-2412';
  const state={indexes:{x:{members:[{url,kind:'scp',source:source.url}]}},records:{[url]:rec(url,['scp'])},attempts:{}};
  const previous={data:[{url,itemId:'document-jp--scp-2412',language:'jp',pageType:'related-document-en'}]};
  const row=buildIndexedCatalog([],{jp:state},previous,date).data[0];
  assert.equal(row.itemId,'document-jp--scp-2412');
  assert.equal(row.pageType,'scp-series');
  assert.equal(row.contentType,'scp');
});

test('classified Joke documents use the native canonical ID rather than the old placeholder',()=>{
 const url='https://scp-pt-br.wikidot.com/scp-pl-2021-j';
 const state={indexes:{x:{members:[{url,kind:'scp',source:'https://scp-pt-br.wikidot.com/scp-international'}]}},records:{[url]:rec(url,['scp','piada'])},attempts:{}};
 const native={language:'pl',itemId:'joke-scps-pl-2021',pageType:'joke-scps-pl',urlJP:'https://scp-pl.wikidot.com/scp-pl-2021-j',isTranslatedJP:true};
 const previous={data:[{url,itemId:'document-pt--scp-pl-2021-j',language:'pt',pageType:'joke-scps-pl'}]};
 const first=buildIndexedCatalog([native],{pt:state},previous,date);
 const row=first.data.find(r=>r.url===url);
 assert.equal(row.itemId,'joke-scps-pl-2021');assert.equal(row.pageType,'joke-scps-pl');
 assert.equal(row.numericItemId,2021);assert.equal(row.url,url);
 assert.equal(buildIndexedCatalog([native],{pt:state},first,date).data[0].itemId,row.itemId);
 // Archives and Tales retain their own categories, even when the URL ends -J.
 state.records[url]=rec(url,['scp','archived']);
 const archive=buildIndexedCatalog([native],{pt:state},previous,date).data[0];
 assert.equal(archive.contentType,'archive');assert.equal(archive.itemId,previous.data[0].itemId);
});
test('old one-hop-only rows are not retained after a successful scope migration',()=>{
  const linked=base+'only-linked-from-an-article',listed=base+'listed-in-index';
  const state={indexes:{x:{members:[{url:listed,kind:'tale',source:source.url}]}},records:{},attempts:{},failures:{'unrelated-index':{reason:'timeout'}}};
  const previous={data:[{url:linked,itemId:'document-old',language:'jp'},{url:listed,itemId:'document-listed',language:'jp'}]};
  const r=buildIndexedCatalog([],{jp:state},previous,date);
  assert.deepEqual(r.data.map(x=>x.itemId),['document-listed']);assert.equal(r.data[0].fetchStatus,'stale');
});
test('a plain SCP number remains EN inside a JP story index; new proposal IDs stay distinct',()=>{
  const urls=[base+'scp-1537',base+'scp-001-jp-proposal-a',base+'scp-001-jp-proposal-b'];
  const state={indexes:{x:{members:urls.map(url=>({url,kind:'tale',origin:'jp',source:source.url}))}},records:Object.fromEntries(urls.map(u=>[u,rec(u,['scp'])])),attempts:{}};
  const result=buildIndexedCatalog([],{jp:state},{data:[]},date);
  assert.equal(result.data.find(r=>r.url.endsWith('scp-1537')).pageType,'scp-series');
  assert.equal(new Set(result.data.map(r=>r.itemId)).size,3);
});
test('canonical branch IDs take priority when another catalog carries an old inconsistent ID',()=>{
  const known=new Map([['scp-series-ko:071',new Set(['scp-series-071-ko','scp-series-ko-071'])]]);
  const page={slug:'scp-071-ko'};
  assert.equal(scpIdentity(page,{tags:['scp']},'ko',known).itemId,'scp-series-ko-071');
  known.get('scp-series-ko:071').delete('scp-series-ko-071');
  assert.equal(scpIdentity(page,{tags:['scp']},'ko',known).itemId,'scp-series-071-ko');
});
test('merge prunes missing and untranslated placeholders in legacy/v1 and adds indexed works to v2',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'scp-index-delivery-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const baseDir=path.join(root,'local-data'),jp=path.join(baseDir,'jp');fs.mkdirSync(jp,{recursive:true});
  const original={itemId:'scp-series-jp-001',numericItemId:1,titleJP:'Existing',urlJP:base+'scp-001-jp',isTranslatedJP:true,pageType:'scp-series-jp',contentType:'scp',extractedFrom:'scp-series-jp',lastUpdated:date,createdAt:date,tags:[]};
  const missing={...original,itemId:'scp-series-jp-004',urlJP:base+'scp-004-jp'};
  const fallback={...original,itemId:'scp-series-005',urlJP:null,urlEN:'https://scp-wiki.wikidot.com/scp-005',isTranslatedJP:false};
  fs.writeFileSync(path.join(jp,'scp-data.json'),JSON.stringify({language:'jp',timestamp:date,totalCount:3,data:[original,missing,fallback]}));
  fs.writeFileSync(path.join(jp,'meta.json'),JSON.stringify({lastUpdated:date,totalCount:3}));
  const story=base+'work-a',scp=base+'scp-006-ru';
  const state={schemaVersion:1,language:'jp',updatedAt:date,statistics:{pendingIndexes:0},attempts:{},records:{[story]:rec(story),[scp]:rec(scp,['scp','ru'])},indexes:{[source.url]:{at:date,members:[{url:story,kind:'tale',origin:'jp',source:source.url},{url:scp,kind:'scp',origin:'ru',source:source.url}],missing:[missing.urlJP]}}};
  const partial=path.join(root,'partial-data/catalog-indexes');fs.mkdirSync(partial,{recursive:true});
  fs.writeFileSync(path.join(partial,'jp.json.gz'),zlib.gzipSync(JSON.stringify(state)));
  const indexed=merge(root,date);assert.equal(indexed.totalCount,2);
  const raw=JSON.parse(fs.readFileSync(path.join(jp,'scp-data.json')));assert.equal(raw.totalCount,1);assert.equal(raw.data[0].itemId,original.itemId);
  generateMobileCatalogs(baseDir);
  function delivery(channel){const dir=path.join(baseDir,channel,'jp'),m=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir,m.fileName))))}
  assert.equal(delivery('mobile-v1').totalCount,1);
  const v2=delivery('mobile-v3');assert.equal(v2.totalCount,3);
  assert.equal(v2.data.find(r=>r.urlJP===scp).itemId,'scp-series-ru-006');
  assert.equal(v2.data.find(r=>r.urlJP===story).itemId,'document-jp--work-a');
});
