'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {inspectArticlePage}=require('../article-page');
const axios=require('axios');
const {LocalSCPCrawler}=require('../local-crawler');
const {extractHtml}=require('../related-documents');
function inspect(body,status=200){const dom=new JSDOM(body);try{return inspectArticlePage(dom.window.document,status)}finally{dom.window.close()}}
test('missing pages are terminal but temporary errors and unknown layouts are not',()=>{
  assert.equal(inspect('<div id="page-content">not found</div>',404).terminal,true);
  assert.equal(inspect('<div id="page-content"><h1>¡Esta página no existe todavía!</h1><p>Crear esta página</p></div>').terminal,true);
  assert.equal(inspect('<div id="page-title">Page not found</div><div id="page-content">Create one</div>').usable,false);
  for(const status of [403,429,500,503])assert.equal(inspect('',status).terminal,false);
  assert.equal(inspect('<title>Security check</title>').terminal,false);
  assert.equal(inspect('<main>Unknown structure</main>').terminal,false);
});
test('empty bodies exclude chrome while image-only and short real articles remain usable',()=>{
  assert.equal(inspect('<div id="page-content"><style>body{}</style><script>x()</script><div class="licensebox">credits</div></div>').terminal,true);
  for(const body of ['<img src="a.png">','<svg></svg>','<iframe src="story"></iframe>','One word.'])assert.equal(inspect('<div id="page-content">'+body+'</div>').usable,true);
});
test('metadata extraction distinguishes unknown markup from a confirmed empty body',()=>{
  assert.throws(()=>extractHtml('https://scp-jp.wikidot.com/test','<title>Changed layout</title><main>Article</main>'),e=>e.articleUnavailable===false);
  assert.throws(()=>extractHtml('https://scp-jp.wikidot.com/test','<div id="page-title">Empty</div><div id="page-content"></div>'),e=>e.articleUnavailable===true);
});
test('legacy lists discard untranslated newpage entries regardless of old fallback settings',()=>{
  const dom=new JSDOM('<div id="page-content"><ul><li><a class="newpage" href="/scp-004">missing</a></li><li><a href="/scp-005">exists</a></li></ul></div>');
  try{const c=new LocalSCPCrawler('jp');for(const skipUnwritten of [true,false])for(const method of ['collectFromListItems','collectFromAnyLinks']){
    const rows=c[method](dom.window.document,{skipUnwritten});assert.deepEqual(rows.map(r=>r.href),['/scp-005']);
  }}finally{dom.window.close()}
});
test('confirmed missing article is removed even when cached; temporary failures retain cache',async t=>{
  const c=new LocalSCPCrawler('es');c.displayProgress=()=>{};c.entryDelayMs=0;
  const url=c.baseUrl+'/scp-series';
  t.mock.method(axios,'get',async()=>({status:200,data:'<ul><li><a href="/scp-004">SCP-004</a> - Work</li></ul>'}));
  const prior={itemId:'scp-series-004',urlJP:c.baseUrl+'/scp-004',isTranslatedJP:true,tags:[],imageUrl:'image'};
  c.extractScpDetailsFromPage=async()=>({fetchSucceeded:false,articleUnavailable:true,tags:[]});
  assert.deepEqual(await c.extractScpDataFromUrl(url,new Map([[prior.itemId,prior]]),1),[]);
  c.extractScpDetailsFromPage=async()=>({fetchSucceeded:false,tags:[]});
  const retained=await c.extractScpDataFromUrl(url,new Map([[prior.itemId,prior]]),1);
  assert.equal(retained.length,1);assert.equal(retained[0].imageUrl,'image');
});
