'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const {makeRecord,normalizePage,digest,extractFtml,EXTRACTOR_VERSION}=require('../research-board/extract');
const {buildBoard}=require('../research-board/catalog');
const {saveSources,readSources,merge}=require('../research-board/source-store');
const {importCatalogSources}=require('../research-board/catalog-sources');
const {refresh}=require('../research-board/refresh-links');
const base='https://scp-wiki.wikidot.com/',stamp='2026-11-08T00:00:00Z';
const html=body=>'<title>Article</title><div id="page-content"><p>'+('Article content. '.repeat(10))+'</p>'+body+'</div>';
const row=(slug,language='en')=>({itemId:'scp-series-'+slug.slice(4),pageType:'scp-series',urlJP:(language==='en'?base:'https://scp-jp.wikidot.com/')+slug,isTranslatedJP:true,contentType:'scp'});
const catalog=(rows,language='en')=>({language,timestamp:stamp,totalCount:rows.length,data:rows});
const record=(slug,body)=>makeRecord(base+slug,html(body),'html',stamp);
const sources=(records)=>new Map(records.map(r=>[r.pageId,{record:r,lastAttempt:{status:'success',at:stamp}}]));
test('body extraction excludes navigation, credits, translations, missing pages, fragment-only and unsafe links',()=>{
  const r=record('scp-001','<a href="http://www.scpwiki.com/scp-002#log">Two</a><a href="/scp-002">duplicate</a>'+
    '<nav><a href="/nav-target">nav</a></nav><div class="wikiwalk-nav"><a href="/walk">walk</a></div>'+
    '<div class="creditRate"><a href="/credit-target">credit</a></div><div class="translation-source"><a href="/origin">origin</a></div>'+
    '<div class="interwiki-box"><a href="/interwiki">lang</a></div><div class="toc"><a href="/toc-target">toc</a></div>'+
    '<a class="newpage" href="/missing">missing</a><a href="#x">local</a><a href="/scp-003?action=edit">edit</a><a href="https://outside.example/a">external</a>');
  assert.equal(r.linkExtractionVersion,EXTRACTOR_VERSION);assert.equal(r.links.length,1);
  assert.equal(r.links[0].target,base+'scp-002');assert.equal(r.links[0].quote,'Two');
});
test('FTML uses explicit links only and excludes comments, code and includes',()=>{
  const r=extractFtml({title:'RU',source:'SCP-003 [[[scp-002|Two]]] [https://scpfoundation.net/scp-004 Four] '+
    '[!-- [[[scp-005]]] --] [[code]][[[scp-006]]][[/code]] [[include scp-007]]'},'https://scpfoundation.net/scp-001');
  assert.deepEqual(r.links.map(l=>l.target),['https://scpfoundation.net/scp-002','https://scpfoundation.net/scp-004']);
});
test('links consolidate translated endpoints, suppress self-links, deduplicate and never add nodes',()=>{
  const rows=[row('scp-001'),row('scp-002')],jp=[row('scp-001','jp'),row('scp-002','jp')];
  const a=record('scp-001','<a href="/scp-002">2</a><a href="/outside">outside</a><a href="https://scp-jp.wikidot.com/scp-001">translation</a>');
  const b=makeRecord(jp[0].urlJP,html('<a href="/scp-002">二</a>'),'html',stamp);
  const board=buildBoard([catalog(rows),catalog(jp,'jp')],sources([a,b]));
  assert.equal(board.nodes.length,2);assert.equal(board.edges.length,1);assert.equal(board.edges[0][4].length,2);
  assert.equal(board.overview.bodyLinkCoverage.referenceEdges,1);
  const old={...a,linkExtractionVersion:5};assert.equal(buildBoard([catalog(rows)],sources([old])).edges.length,0);
});
test('current links survive source save/reload and catalog metadata import',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'board-links-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const r=record('scp-001','<a href="/scp-002">Two</a>'),map=sources([r]);
  saveSources(map,path.join(root,'research-board-sources'));
  assert.deepEqual(readSources(path.join(root,'research-board-sources')).get(r.pageId).record.links,r.links);
  fs.mkdirSync(path.join(root,'catalog-indexes'));
  const related={...r,bodyLinks:r.links,links:r.links.map(l=>l.target)};
  fs.writeFileSync(path.join(root,'catalog-indexes/en.json.gz'),zlib.gzipSync(JSON.stringify({records:{[r.url]:related}})));
  const imported=new Map();importCatalogSources(imported,root,[catalog([row('scp-001'),row('scp-002')])]);
  assert.equal(buildBoard([catalog([row('scp-001'),row('scp-002')])],imported).edges.length,1);
});
test('backfill visits only catalog pages, resumes and applies a strict request budget',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'board-link-refresh-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const dir=path.join(root,'local-data/mobile-v3/en');fs.mkdirSync(dir,{recursive:true});
  const c=catalog([row('scp-001'),row('scp-002')]),bytes=zlib.gzipSync(JSON.stringify(c)),name='catalog-'+digest(bytes)+'.json.gz';
  fs.writeFileSync(path.join(dir,name),bytes);fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({fileName:name,sha256:digest(bytes),bytes:bytes.length}));
  const calls=[],request=async url=>{calls.push(url);return record(normalizePage(url).slug,'<a href="/outside">outside</a>');};
  const a=await refresh({root,language:'en',maxRequests:1,intervalMs:0,now:stamp,request});assert.equal(a.updated,1);
  const b=await refresh({root,language:'en',maxRequests:10,intervalMs:0,now:stamp,request});assert.equal(b.updated,1);
  assert.deepEqual(calls,[base+'scp-001',base+'scp-002']);
});

test('older same-content metadata cannot reintroduce removed navigation links', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'board-nav-metadata-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const current=record('scp-001','<p>≪ <a href="/scp-002">Previous</a> | SCP-001 | <a href="/scp-003">Next</a> ≫</p>');
  const legacy={...current,checkedAt:'2026-11-09T00:00:00Z',linkExtractionVersion:6,
    bodyLinks:[{target:base+'scp-002',quote:'Previous',location:'article_body',method:'body_hyperlink_v6'}]};
  legacy.links=legacy.bodyLinks;
  const map=sources([current]);
  merge(map,{record:legacy,lastAttempt:{status:'success',at:legacy.checkedAt}});
  assert.deepEqual(map.get(current.pageId).record.links,[]);
  assert.equal(map.get(current.pageId).record.linkExtractionVersion,EXTRACTOR_VERSION);
  fs.mkdirSync(path.join(root,'catalog-indexes'));
  fs.writeFileSync(path.join(root,'catalog-indexes/en.json.gz'),zlib.gzipSync(JSON.stringify({records:{[current.url]:legacy}})));
  importCatalogSources(map,root,[catalog([row('scp-001'),row('scp-002'),row('scp-003')])]);
  assert.deepEqual(map.get(current.pageId).record.links,[]);
  assert.equal(map.get(current.pageId).record.linkExtractionVersion,EXTRACTOR_VERSION);
});


test('legacy production index imports cannot erase captured body links or original credits',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'board-legacy-import-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const current=record('scp-001','<a href="/scp-002">Two</a>');
 current.originalSources=[{url:base+'scp-002',method:'credit_original_label'}];
 const map=sources([current]),later='2026-11-09T00:00:00Z';
 const legacy={url:current.url,title:'Index metadata',contentSha256:'b'.repeat(64),checkedAt:later,tags:[]};
 fs.mkdirSync(path.join(root,'catalog-indexes'));
 fs.writeFileSync(path.join(root,'catalog-indexes/en.json.gz'),zlib.gzipSync(JSON.stringify({
  records:{[current.url]:legacy},attempts:{[current.url]:{status:'not_found',at:later}}
 })));
 importCatalogSources(map,root,[catalog([row('scp-001'),row('scp-002')])]);
 assert.equal(map.get(current.pageId).record.contentSha256,current.contentSha256);
 assert.deepEqual(map.get(current.pageId).record.links,current.links);
 assert.deepEqual(map.get(current.pageId).record.originalSources,current.originalSources);
 assert.equal(map.get(current.pageId).lastAttempt.status,'not_found');
});
