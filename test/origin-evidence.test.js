'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {parseOriginal}=require('../origin-interwiki');
const {classify}=require('../related-documents');
const {enrich}=require('../tool/enrich-origin-evidence');
const {readState,writeState}=require('../catalog-indexes');
const {JSDOM}=require('jsdom');
const {extractOriginalSources,discussionPage,extractDiscussionSources}=require('../origin-provenance');
const {VERSION}=require('../origin-provenance');
const {refreshAttribution}=require('../tool/refresh-attribution-evidence');
const {buildIndexedCatalog}=require('../merge-catalog-indexes');
const url='https://scp-pl.wikidot.com/story',source='https://scp-wiki.wikidot.com/story',jp='https://scp-jp.wikidot.com/story';
const sha='a'.repeat(64);
function record(evidence={}){return {url,tags:['tłumaczenie'],contentSha256:sha,interwikiOrigin:{schemaVersion:1,queryUrl:url,
 contentSha256:sha,status:'translation',chain:[source],terminal:true,...evidence}};}
test('interwiki records only explicit translationOf chains, never sibling translations or null pages',()=>{
 assert.equal(parseOriginal(url,null).status,'not_indexed');
 assert.equal(parseOriginal(url,{url,translationOf:null}).status,'no_translation');
 assert.deepEqual(parseOriginal(url,{url:url.replace('https:','http:'),translationOf:{url:source,translationOf:{url:jp,translationOf:null}}}).chain,[source,jp]);
 assert.equal(parseOriginal(url,{url,translationOf:{url:source}}).terminal,false);
 assert.throws(()=>parseOriginal(url,{url:jp,translationOf:null}),/mismatch/);
 assert.throws(()=>parseOriginal(url,{url,translationOf:{url,translationOf:null}}),/chain/);
 assert.equal(parseOriginal('https://scpfoundation.net/story',{url:'http://scpfoundation.net/story',translationOf:{url:'http://scp-ru.wikidot.com/story',translationOf:null}}).status,'mirror_only');
 assert.equal(parseOriginal(url,{url,translationOf:{url:'https://example.com/story',translationOf:null}}).status,'unsupported_source');
});
test('interwiki evidence resolves source provenance, requires the captured bytes and preserves ambiguity',()=>{
 const seeds=new Map(),r=record();
 assert.equal(classify(url,new Map([[url,r]]),seeds).branch,'en');
 assert.equal(classify(url,new Map([[url,r],[source,{tags:['_jp','international']}]]),seeds).branch,'jp');
 assert.equal(classify(url,new Map([[url,r],[source,{tags:['_licensebox','resource']}]]),seeds).branch,'en');
 assert.equal(classify(url,new Map([[url,r],[source,{tags:['international','resource']}]]),seeds).branch,null);
 assert.equal(classify(url,new Map([[url,r],[source,{tags:[]}]]),seeds).branch,null);
 const credit={...r,interwikiOrigin:undefined,originalSources:[{url:source,method:'credit_original_label'}]};
 assert.equal(classify(url,new Map([[url,credit],[source,{tags:['resource']}]]),seeds).branch,'en');
 assert.equal(classify(url,new Map([[url,credit],[source,{tags:['international','resource']}]]),seeds).branch,null);
 assert.equal(classify(url,new Map([[url,record({contentSha256:'b'.repeat(64)})]]),seeds).branch,null);
 assert.equal(classify(url,new Map([[url,record({queryUrl:jp})]]),seeds).branch,null);
 assert.equal(classify(url,new Map([[url,record({status:'no_translation'})]]),seeds).branch,null);
 assert.equal(classify(url,new Map([[url,record({terminal:false})]]),seeds).basis,'unresolved_interwiki_origin');
 assert.equal(classify(url,new Map([[url,record({chain:[url]})]]),seeds).basis,'unresolved_interwiki_origin');
 assert.equal(classify(url,new Map([[url,{...r,tags:['en','jp']}]]),seeds).basis,'conflicting_origin_tags');
 const wl=record({chain:['https://wanderers-library.wikidot.com/story']});
 assert.equal(classify(url,new Map([[url,wl]]),seeds).branch,'en');
});
test('bounded evidence collection writes only selected records and resumes without another lookup',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'origin-evidence-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'local-data/catalog-indexes/pl.json.gz');
 const other=url+'-other';writeState(file,{schemaVersion:1,indexes:{},attempts:{},records:{[url]:{url,contentSha256:sha,tags:[]},[other]:{url:other,contentSha256:sha}}});
 const before=fs.readFileSync(file);let calls=0;
 const options={root,targets:[{url,site:'pl'},{url:other,site:'pl'}],maxPages:1,intervalMs:0,
 lookup:async urls=>{calls++;assert.deepEqual(urls,[url]);return [parseOriginal(url,{url,translationOf:{url:source,translationOf:null}})];}};
 const report=await enrich(options);assert.equal(report.processed,1);assert.equal(calls,1);assert.deepEqual(fs.readFileSync(file),before);
 const partial=path.join(root,'partial-data/catalog-indexes/pl.json.gz');
 assert.equal(readState(partial).records[url].interwikiOrigin.chain[0],source);
 assert.equal(readState(partial).records[other].interwikiOrigin,undefined);
 await enrich({...options,targets:[{url,site:'pl'}]});assert.equal(calls,1);
});

test('Vietnamese translated citations distinguish article source from the translation and image sources',()=>{
 const vn='https://scp-vn.wikidot.com/story';
 const citation=`<div class="licensebox"><blockquote><p>"Story" by Author. Nguồn bài viết: <a href="${source}">${source}</a>. CC BY-SA.</p><p>Được dịch sang Tiếng Việt. Nguồn bản dịch: <a href="${vn}">${vn}</a>.</p><p>Image source: <a href="${jp}">Image</a></p></blockquote></div>`;
 const d=new JSDOM(citation).window.document;
 assert.deepEqual(extractOriginalSources(d,vn).map(r=>r.url),[source]);
 assert.deepEqual(extractOriginalSources(d,url),[]);
 assert.deepEqual(extractOriginalSources(new JSDOM(citation.replace('Được dịch sang Tiếng Việt','Local author')).window.document,vn),[]);
});

test('credit table original labels work across cells without accepting other table links',()=>{
 const d=new JSDOM(`<div class="credit"><table><tr><th>Original:</th><td><a href="${source}">Story</a></td></tr><tr><td>Other works</td><td><a href="${jp}">Other</a></td></tr></table></div>`).window.document;
 assert.deepEqual(extractOriginalSources(d,url).map(r=>r.url),[source]);
});

test('Polish discussion attribution requires the linked thread, article backlink and first attribution post',()=>{
 const thread='https://scp-pl.wikidot.com/forum/t-123/story';
 const article=new JSDOM('<a id="discuss-button" href="/forum/t-123/story">Discuss</a>').window.document;
 assert.equal(discussionPage(article,url),thread);
 assert.equal(discussionPage(article,'https://scp-vn.wikidot.com/story'),null);
 assert.equal(discussionPage(new JSDOM('<a id="discuss-button" href="https://evil.test/forum/t-123/story">Discuss</a>').window.document,url),null);
 const text=`<div class="description-block"><a href="/story">Article</a></div><div class="post" id="post-1"><div class="long"><div class="head"><div class="title">Atrybucja</div></div><div class="content"><a href="${source}">Oryginał</a> autorstwa Author</div></div></div><div class="post"><div class="long"><div class="content"><a href="${jp}">Oryginał</a></div></div></div>`;
 assert.deepEqual(extractDiscussionSources(new JSDOM(text).window.document,url,thread).map(r=>r.url),[source]);
 assert.deepEqual(extractDiscussionSources(new JSDOM(text.replace('href="/story"','href="/other"')).window.document,url,thread),[]);
 assert.deepEqual(extractDiscussionSources(new JSDOM(text.replace('Atrybucja','Recommendations')).window.document,url,thread),[]);
});

test('attribution refresh budgets both page and linked discussion, resuming without re-fetching the page',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'attribution-budget-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const local=path.join(root,'local-data/catalog-indexes/pl.json.gz');
 writeState(local,{schemaVersion:1,indexes:{},attempts:{},records:{[url]:{url,contentSha256:sha,originProvenanceVersion:1}}});
 let pages=0,threads=0;const thread='https://scp-pl.wikidot.com/forum/t-123/story';
 const options={root,targets:[{url,site:'pl'}],maxRequests:1,intervalMs:0,request:async()=>{pages++;return {url,contentSha256:sha,originProvenanceVersion:VERSION,attributionDiscussionUrl:thread,originalSources:[]};},
  discussionRequest:async()=>{threads++;return `<div class="description-block"><a href="/story">Story</a></div><div class="post"><div class="long"><div class="title">Atrybucja</div><div class="content"><a href="${source}">Oryginał</a></div></div></div>`;}};
 await refreshAttribution(options);assert.equal(pages,1);assert.equal(threads,0);
 const result=await refreshAttribution(options);assert.equal(result.requests,1);assert.equal(pages,1);assert.equal(threads,1);
 const saved=readState(path.join(root,'partial-data/catalog-indexes/pl.json.gz')).records[url];
 assert.equal(saved.originalSources[0].url,source);assert.equal(saved.discussionAttributionVersion,1);
 assert.equal(readState(local).records[url].originProvenanceVersion,1);
});

test('interwiki origin reaches the indexed catalog without adding source pages or replacing the article ID',()=>{
 const previous={data:[{url,language:'pl',itemId:'document-existing',pageType:'related-document-unclassified'}]};
 const index='https://scp-pl.wikidot.com/foundation-tales';
 const state={indexes:{[index]:{members:[{url,source:index,kind:'tale'}]}},attempts:{},records:{[url]:{...record(),title:'Story',availabilityVersion:1,checkedAt:new Date().toISOString()}}};
 const result=buildIndexedCatalog([],{pl:state},previous);
 assert.equal(result.data.length,1);assert.equal(result.data[0].url,url);assert.equal(result.data[0].itemId,'document-existing');
 assert.equal(result.data[0].pageType,'related-document-en');assert.equal(result.data[0].classification.basis,'interwiki_original_metadata');
});

test('published origin proof survives new page bytes and an absent local API cache within its refresh window',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'published-origin-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const local=path.join(root,'local-data/catalog-indexes/pl.json.gz');
 writeState(local,{schemaVersion:1,indexes:{},attempts:{},records:{[url]:{url,contentSha256:'b'.repeat(64)}}});
 const proof={...record().interwikiOrigin,checkedAt:new Date().toISOString()};
 const result=await enrich({root,targets:[{url,site:'pl',publishedOriginEvidence:proof}],maxPages:1,intervalMs:0,
  lookup:async()=>{throw Error('Should reuse published proof');}});
 assert.equal(result.processed,1);assert.equal(result.requests,0);
 const saved=readState(path.join(root,'partial-data/catalog-indexes/pl.json.gz')).records[url];
 assert.equal(saved.interwikiOrigin.contentSha256,'b'.repeat(64));assert.deepEqual(saved.interwikiOrigin.chain,[source]);
});
