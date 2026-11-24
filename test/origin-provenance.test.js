'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {extractHtml,classify}=require('../related-documents');
const {originalPage}=require('../origin-provenance');
const {VERSION}=require('../origin-provenance');
const url='https://scp-cs.wikidot.com/translated';
const html=body=>`<div id="page-title">Story</div><div id="page-content"><p>Real story text.</p>${body}</div>`;
test('extracts only explicit original-source labels in credits, not body references or other credit links',()=>{
 const r=extractHtml(url,html('<a href="https://scp-wiki.wikidot.com/referenced">Reference</a><div class="credit"><p>Title: Work<br>Originál: <a href="http://www.scp-wiki.net/original">Source</a><br>Other work: <a href="https://scp-jp.wikidot.com/other">Other</a></p></div>'));
 assert.deepEqual(r.originalSources.map(s=>s.url),['https://scp-wiki.wikidot.com/original']);
 const result=classify(url,new Map([[url,r]]),new Map());assert.equal(result.branch,'en');assert.equal(result.basis,'explicit_original_credit');
 assert.equal(r.originProvenanceVersion,VERSION);
});
test('rejects arbitrary hosts, query actions, user profiles, and same-page sources',()=>{
 for(const target of ['https://example.com/story','https://scp-wiki.wikidot.com/story?action=delete','https://scp-wiki.wikidot.com/user:info/person'])assert.equal(originalPage(target),null);
 const r=extractHtml(url,html(`<div class="credit">Originál: <a href="${url}">self</a></div>`));assert.deepEqual(r.originalSources,[]);
});
test('original credit resolves a known translated source by its origin, rather than its hosting site',()=>{
 const source='https://scp-wiki.wikidot.com/original';
 const r=extractHtml(url,html(`<div class="credit">Originál: <a href="${source}">Source</a></div>`));
 assert.equal(classify(url,new Map([[url,r],[source,{tags:['_jp','international']}]]),new Map()).branch,'jp');
});
test('conflicting credits and unresolved secondary translations stay unknown',()=>{
 const r=extractHtml(url,html('<div class="credit">Originál: <a href="https://scp-wiki.wikidot.com/a">a</a><br>Originál: <a href="https://scp-jp.wikidot.com/b">b</a></div>'));
 assert.equal(classify(url,new Map([[url,r]]),new Map()).basis,'conflicting_original_credits');
 r.tags=['二次翻译'];r.originalSources=r.originalSources.slice(0,1);
 assert.equal(classify(url,new Map([[url,r]]),new Map()).basis,'unresolved_original_credit');
});
test('verified smaller branches retain original-credit classification as crawl destinations',()=>{
 const r=extractHtml(url,html('<div class="credit">Originál: <a href="https://scp-la.wikidot.com/story">Latin source</a></div>'));
 assert.equal(classify(url,new Map([[url,r]]),new Map()).branch,'la');
 assert.equal(require('../related-documents').normalize(r.originalSources[0].url).language,'la');
 assert.equal(require('../research-board/classification').branchForPageType('related-document-la'),'la');
});
test('Portuguese translation policy supplies EN only if no origin or conflicting metadata exists',()=>{
 const infer=tags=>classify('https://scp-pt-br.wikidot.com/story',new Map([['https://scp-pt-br.wikidot.com/story',{tags}]]),new Map());
 assert.equal(infer(['traduzido']).branch,'en');assert.equal(infer(['traduzido','jp']).branch,'jp');assert.equal(infer([]).branch,null);
});
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),zlib=require('node:zlib');
const {readState,writeState,crawl}=require('../catalog-indexes');
const {refresh}=require('../tool/refresh-origin-provenance');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'scp-origin-refresh-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const url='https://scp-cs.wikidot.com/story',source='https://scp-cs.wikidot.com/foundation-tales',date='2026-11-08T00:00:00Z';
 const record={url,title:'Story',tags:[],translations:[],links:[],contentSha256:'a'.repeat(64),availabilityVersion:1,checkedAt:date};
 const state={schemaVersion:1,language:'cs',indexes:{[source]:{members:[{url,source,kind:'tale'}],parserVersion:5,at:date,root:source}},records:{[url]:record},attempts:{},statistics:{}};
 const file=path.join(root,'local-data/catalog-indexes/cs.json.gz');writeState(file,state);
 const catalog=path.join(root,'local-data/related-documents/catalog.json.gz');fs.mkdirSync(path.dirname(catalog),{recursive:true});fs.writeFileSync(catalog,zlib.gzipSync(JSON.stringify({data:[{url,language:'cs',pageType:'related-document-unclassified',itemId:'document-existing'}]})));
 return {root,url,source,date,record,state,file};
}
test('bounded provenance refresh keeps catalog membership and pending checkpoints intact',async t=>{
 const f=fixture(t),incoming=path.join(f.root,'partial-data/catalog-indexes/cs.json.gz');writeState(incoming,f.state);
 const report=await refresh({root:f.root,maxRequests:1,intervalMs:0,request:async url=>({...f.record,originProvenanceVersion:VERSION,originalSources:[{url:'https://scp-wiki.wikidot.com/original',method:'credit_original_label'}],links:['https://scp-wiki.wikidot.com/do-not-crawl']})});
 assert.equal(report.updated,1);assert.equal(report.withOriginalSource,1);
 for(const file of [f.file,incoming]){const state=readState(file);assert.deepEqual(Object.keys(state.records),[f.url]);assert.deepEqual(state.records[f.url].links,[]);assert.equal(state.records[f.url].originProvenanceVersion,VERSION);}
 let requests=0;await refresh({root:f.root,maxRequests:1,intervalMs:0,request:async()=>{requests++;}});assert.equal(requests,0);
});

test('explicit refresh targets include audited pages absent from the additional catalog and force a new observation',async t=>{
 const f=fixture(t),other='https://scp-cs.wikidot.com/other';
 f.state.records[f.url]={...f.record,originProvenanceVersion:VERSION};
 f.state.records[other]={...f.record,url:other};writeState(f.file,f.state);
 let requests=0;
 const report=await refresh({root:f.root,targets:[{url:other,language:'cs'},{url:f.url,language:'cs'}],force:true,maxRequests:2,intervalMs:0,
  request:async url=>{requests++;return {...f.record,url,originProvenanceVersion:VERSION};}});
 assert.equal(requests,2);assert.equal(report.updated,2);assert.equal(report.complete,true);
 assert.equal(readState(f.file).records[other].originProvenanceVersion,VERSION);
});

test('concurrent provenance requests share state and keep the request budget',async t=>{
 const f=fixture(t),urls=Array.from({length:5},(_,i)=>'https://scp-cs.wikidot.com/story-'+i);
 for(const url of urls)f.state.records[url]={...f.record,url};writeState(f.file,f.state);
 let active=0,peak=0;
 const report=await refresh({root:f.root,targets:urls.map(url=>({url,language:'cs'})),force:true,maxRequests:3,intervalMs:0,concurrency:2,
  request:async url=>{active++;peak=Math.max(active,peak);await new Promise(r=>setTimeout(r,10));active--;return {...f.record,url,originProvenanceVersion:VERSION};}});
 assert.equal(report.attempted,3);assert.equal(report.updated,3);assert.equal(report.complete,false);assert.equal(peak,2);
 assert.equal(Object.values(readState(f.file).records).filter(r=>r.originProvenanceVersion===VERSION).length,3);
});
test('weekly collector refreshes missing provenance even while article metadata is otherwise fresh',async t=>{
 const f=fixture(t);let requests=0;
 const options={root:f.root,now:f.date,maxRequests:1,intervalMs:0,sources:[{language:'cs',url:f.source,kind:'tale'}],request:async()=>{throw Error('Fresh index should be reused');},articleRequest:async()=>{requests++;return {...f.record,originProvenanceVersion:VERSION,originalSources:[]};}};
 await crawl('cs',options);assert.equal(requests,1);await crawl('cs',options);assert.equal(requests,1);
});
test('weekly provenance backfill takes priority over ordinary stale metadata',async t=>{
 const f=fixture(t),other='https://scp-cs.wikidot.com/aaa-stale';
 f.state.records[other]={...f.record,url:other,checkedAt:'2026-10-01T00:00:00Z',originProvenanceVersion:VERSION};
 f.state.indexes[f.source].members.push({url:other,source:f.source,kind:'tale'});writeState(f.file,f.state);
 const seen=[];await crawl('cs',{root:f.root,now:f.date,maxRequests:1,intervalMs:0,sources:[{language:'cs',url:f.source,kind:'tale'}],request:async()=>{throw Error('Do not refresh fresh index');},articleRequest:async url=>{seen.push(url);return {...f.record,originProvenanceVersion:VERSION};}});
 assert.deepEqual(seen,[f.url]);
});
