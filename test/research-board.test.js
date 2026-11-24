'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os=require('node:os'), path=require('node:path'), zlib=require('node:zlib');
const {buildBoard, loadCatalogs} = require('../research-board/catalog');
const {makeRecord, normalizePage, EXTRACTOR_VERSION} = require('../research-board/extract');
const {merge} = require('../research-board/source-store');
const {importCatalogSources} = require('../research-board/catalog-sources');
const {CATEGORY_ORDER,KIND_BY_CATEGORY,homeCategory} = require('../research-board/article-categories');
const base='https://scp-wiki.wikidot.com/';
const stamp='2026-11-07T00:00:00Z';
test('board categories match the HOME contract and order',()=>{
  const contract = require('./fixtures/board-article-categories.json');
  assert.deepEqual(CATEGORY_ORDER,contract.categoryOrder);
  for(const row of contract.cases) assert.equal(homeCategory(row.pageType,row.contentType),row.category,JSON.stringify(row));
});
function article(slug, extra={}) {
  return {itemId:`scp-series-${slug.replace('scp-','')}`,pageType:'scp-series',contentType:'scp',
    titleJP:slug,urlJP:base+slug,isTranslatedJP:true,...extra};
}
const catalog=(data, language='en')=>({schemaVersion:1,language,timestamp:stamp,data,totalCount:data.length});
function source(slug,html) {
  const record=makeRecord(base+slug,`<html><title>${slug}</title><div id="page-content"><p>${'Source article content. '.repeat(5)}</p>${html}</div></html>`,'html',stamp);
  return {record,lastAttempt:{status:'success',at:stamp}};
}
test('only official catalog members become article nodes, even when linked from captured pages',()=>{
  const sources=new Map();
  merge(sources,source('scp-001','<a href="/outside-article">outside</a>'));
  merge(sources,source('outside-article','<a href="/scp-002">inbound only</a>'));
  const board=buildBoard([catalog([article('scp-001'),article('scp-002')])],sources);
  assert.equal(board.nodes.length,2);
  assert.equal(board.overview.sourcePageCount,2);
  assert.equal(board.edges.length,0);
  assert(board.nodes.some(n=>n[4]==='scp-002'&&n[9]===0));
  assert.equal(board.overview.membership,'official_index_catalog_v3');
});
test('origin is catalog pageType; translations share a work while JP originals and variants stay separate',()=>{
  const data=[catalog([article('scp-1537'),article('scp-1537-j',{itemId:'joke-scps-1537',pageType:'joke-scps'})]),
    catalog([article('scp-1537',{urlJP:'https://scp-jp.wikidot.com/scp-1537'}),
      article('scp-1537-jp',{itemId:'scp-series-jp-1537',pageType:'scp-series-jp',urlJP:'https://scp-jp.wikidot.com/scp-1537-jp'})],'jp')];
  const board=buildBoard(data,new Map());
  assert.equal(board.nodes.length,3);
  const original=board.nodes.find(n=>n[14][0]==='catalog:scp-series:scp-series-1537');
  assert.equal(original[8],'en');assert.equal(original[13].length,2);
  assert.equal(board.nodes.find(n=>n[4]==='scp-1537-jp')[8],'jp');
});
test('new catalog content categories separate records, GoI, settings, Tales and hubs',()=>{
  const types=['record','goi','setting','tale','hub'];
  const board=buildBoard([catalog(types.map(type=>article(type,{itemId:'document-en--'+type,pageType:'related-document-en',contentType:type})))],new Map());
  assert.deepEqual(Object.fromEntries(board.nodes.map(n=>[n[4],n[3]])),{goi:6,hub:2,record:1,setting:7,tale:3});
  assert.equal(board.overview.sections.length,5);
});
test('SCP-EX and JOKE have their own districts and unknown articles never use tag/URL guesses',()=>{
  const rows=[article('scp-001'),article('scp-002-ex',{pageType:'scp-ex'}),
    article('scp-003-j',{itemId:'joke-scps-003',pageType:'joke-scps'}),
    article('experiment-log-004',{itemId:'document-en--experiment-log-004',pageType:'related-document-en',contentType:'other'})];
  const sources=new Map();
  merge(sources,source('experiment-log-004','<div class="page-tags"><a>tale</a><a>scp</a></div>'));
  const board=buildBoard([catalog(rows)],sources);
  assert.equal(board.nodes.find(n=>n[4]==='scp-002-ex')[3],KIND_BY_CATEGORY.ex);
  assert.equal(board.nodes.find(n=>n[4]==='scp-003-j')[3],KIND_BY_CATEGORY.joke);
  assert.equal(board.nodes.find(n=>n[4]==='experiment-log-004')[3],KIND_BY_CATEGORY.other);
  assert.deepEqual(board.overview.sections.map(s=>s.kind),[0,8,9,5]);
});
test('mutual and addendum hyperlinks connect only existing works with direction',()=>{
  const sources=new Map();merge(sources,source('scp-001','<h2>Addendum:</h2><a href="/scp-002">SCP-002</a>'));
  merge(sources,source('scp-002','<a href="/scp-001">SCP-001</a>'));
  const board=buildBoard([catalog([article('scp-001'),article('scp-002')])],sources);
  assert.deepEqual(board.overview.types,['references']);assert.equal(board.edges.length,2);
  assert.equal(board.nodes.length,2);
  assert.deepEqual(board.edges.map(e=>e.slice(0,2)).sort(),[[0,1],[1,0]]);
  assert.equal(board.overview.linkPolicy,'catalog_members_body_links_v6');
});
test('reviewed exact-source assertions survive only with both catalog endpoints',()=>{
  const sources=new Map();merge(sources,source('scp-079','<p>SCP-079 and SCP-682 were contained within the same chamber for 43 minutes.</p><a href="/scp-682">682</a>'));
  const rows=[article('scp-079'),article('scp-682')];
  const board=buildBoard([catalog(rows)],sources);
  assert(board.overview.types.includes('co_appearance'));
  assert.equal(buildBoard([catalog(rows.slice(0,1))],sources).edges.length,0);
});
test('layout is deterministic and isolated articles retain stable positions',()=>{
  const catalogs=[catalog([article('scp-001'),article('scp-002'),article('scp-100')])];
  const a=buildBoard(catalogs,new Map()),b=buildBoard(catalogs,new Map());
  assert.deepEqual(a,b);
  for(const n of a.nodes)assert(n[1]>=0&&n[2]>=0&&n[1]<=a.overview.width&&n[2]<=a.overview.height);
});
test('failed or deleted source observations do not publish old relations as current',()=>{
  for (const status of ['failed','unavailable','not_found']) {
    const sources=new Map();const state=source('scp-001','<a href="/scp-002">002</a>');
    state.lastAttempt={status,at:'2026-11-08T00:00:00Z'};merge(sources,state);
    const board=buildBoard([catalog([article('scp-001'),article('scp-002')])],sources);
    assert.equal(board.edges.length,0);
    assert.equal(board.nodes.find(n=>n[4]==='scp-001')[7],status==='failed'?'stale':'missing');
  }
});
test('mobile-v1/v2 alone never populate the new board',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'board-v3-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'mobile-v2','en'),{recursive:true});
  fs.writeFileSync(path.join(root,'mobile-v2','en','manifest.json'),'{}');
  assert.deepEqual(loadCatalogs(root),[]);
});
test('updated metadata drops obsolete links and unverified semantic claims',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'board-sources-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const sources=new Map();merge(sources,source('scp-079','<p>SCP-079 and SCP-682 were contained within the same chamber for 43 minutes.</p>'));
  fs.mkdirSync(path.join(root,'catalog-indexes'));
  const record={url:base+'scp-079',title:'Updated',tags:[],checkedAt:'2026-11-08T00:00:00Z',contentSha256:'f'.repeat(64),format:'html',links:[],bodyLinks:[],linkExtractionVersion:EXTRACTOR_VERSION};
  fs.writeFileSync(path.join(root,'catalog-indexes','en.json.gz'),zlib.gzipSync(JSON.stringify({records:{[record.url]:record}})));
  importCatalogSources(sources,root,[catalog([article('scp-079')])]);
  const current=sources.get(normalizePage(record.url).id).record;
  assert.deepEqual(current.links,[]);assert.deepEqual(current.semanticRelations,[]);
});
test('explicit translated Tales retain every catalog identity within one work',()=>{
  const en=base+'example-tale',jp='https://scp-jp.wikidot.com/example-tale';
  const record=makeRecord(jp,'<title>Tale</title><a rel="alternate" hreflang="en" href="'+en+'"></a><div id="page-content"><p>'+('A readable tale. '.repeat(8))+'</p></div>','html',stamp);
  const sources=new Map();merge(sources,{record,lastAttempt:{status:'success',at:stamp}});
  const board=buildBoard([catalog([article('example-tale',{itemId:'document-en--example-tale',pageType:'related-document-en',contentType:'tale'})]),
    catalog([article('example-tale',{itemId:'document-jp--example-tale',pageType:'related-document-en',contentType:'tale',urlJP:jp})],'jp')],sources);
  assert.equal(board.nodes.length,1);assert.equal(board.nodes[0][13].length,2);
  assert.deepEqual(board.nodes[0][14][2],['catalog:related-document-en:document-en--example-tale','catalog:related-document-en:document-jp--example-tale']);
});
test('a conflicting third-language catalog cannot mark a different branch work as read',()=>{
  const english=article('scp-123');
  const japanese=article('scp-123-jp',{itemId:'scp-series-jp-123',pageType:'scp-series-jp',urlJP:'https://scp-jp.wikidot.com/scp-123-jp'});
  const conflict={...english,urlJP:japanese.urlJP};
  const board=buildBoard([catalog([english]),catalog([japanese],'jp'),catalog([conflict],'fr')],new Map());
  const jp=board.nodes.find(n=>n[8]==='jp');
  assert.deepEqual(jp[14][2],['catalog:scp-series-jp:scp-series-jp-123']);
  const aliases=board.nodes.flatMap(n=>n[14][2]);assert.equal(new Set(aliases).size,aliases.length);
});
