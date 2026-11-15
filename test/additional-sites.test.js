'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const sites=require('../additional-sites.json'),{LANGUAGES}=require('../languages');
const {LocalSCPCrawler,extractObjectClassFromDocument}=require('../local-crawler'),{normalize,classify,extractHtml}=require('../related-documents');
const {parseIndex}=require('../catalog-indexes'),{scpIdentity}=require('../merge-catalog-indexes');
const {MESSAGES,buildNotification}=require('../notification-messages');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const {partialFileName}=require('../partial-file'),{mergeLanguage}=require('../merge-data');
const {generateMobileCatalogs}=require('../mobile-catalog');
function extract(code,page,body){const d=new JSDOM('<div id="page-content">'+body+'</div>',{virtualConsole:new VirtualConsole()});try{const c=Object.assign(Object.create(LocalSCPCrawler.prototype),{baseUrl:LANGUAGES[code].baseUrl});return c.extractFromScpSeries(d.window.document,page);}finally{d.window.close();}}
test('new branches retain the original language matrix and each has a notification locale',()=>{
 const old=['jp','en','cn','cs','de','es','fr','int','it','ko','ru','pl','pt','th','ua','vn','zh-tr'];
 for(const code of old)assert(LANGUAGES[code]);
 assert.equal(Object.keys(sites).length,16);assert.equal(Object.keys(LANGUAGES).length,33);
 for(const [code,site]of Object.entries(sites)){assert.equal(LANGUAGES[code].baseUrl,'https://'+site.host);assert.equal(MESSAGES[code].locale,site.uiLocale);assert(LANGUAGES[code].pages.length);}
 for(const code of ['eo','ie','io','ir','isv','nd','other'])assert(!LANGUAGES[code],'Metadata or incubator codes cannot become a guessed independent site');
});
test('Arabic absolute and relative links preserve IDs while rejecting missing, external and wrong-origin entries',()=>{
 const page=LANGUAGES.ar.pages[0];
 const rows=extract('ar',page,'<a href="https://scp-ar.wikidot.com/scp-ar-010">SCP-AR-010</a> - title <a href="/scp-ar-001">one</a><a class="newpage" href="/scp-ar-002">missing</a><a href="https://example.com/scp-ar-003">external</a><a href="/scp-173">translation</a><a href="/scp-ar-004?action=edit">edit</a>');
 assert.deepEqual(rows.map(r=>r.itemId).sort(),['scp-series-ar-001','scp-series-ar-010']);
});
test('Nordic delivery namespaces retain original EN and ND identities without mixing languages',()=>{
 for(const code of ['da','no','sv']){
  const p=normalize(`https://scp-nd.wikidot.com/${code}:scp-002-nd`);assert.equal(p.language,code);assert.equal(p.slug,'scp-002-nd');assert(p.url.includes(code+':'));
  const rows=extract(code,LANGUAGES[code].pages[0],`<a href="/${code}:scp-002-nd">native</a><a href="/fo:scp-002-nd">other</a>`);assert.equal(rows[0].itemId,'scp-series-nd-002');assert.equal(rows.length,1);
  assert.equal(scpIdentity(p,{title:'Native',tags:['scp']},null,new Map()).pageType,'scp-series-nd');
 }
 assert.equal(normalize('https://scp-nd.wikidot.com/fo:scp-002'),null);assert.equal(normalize('https://scp-nd.wikidot.com/scp-002'),null);
 const rows=extract('da',LANGUAGES.da.pages[1],'<a href="/da:scp-173">EN source</a><a href="/da:scp-1000">wrong series</a><a href="/sv:scp-173">other delivery</a>');assert.equal(rows[0].itemId,'scp-series-173');assert.equal(rows.length,1);
});
test('index discovery keeps Nordic member records in their selected delivery language',()=>{
 const source={language:'da',url:'https://scp-nd.wikidot.com/da:scp-series-nd',kind:'scp',origin:'nd'};
 const result=parseIndex('<div id="page-title">SCP ND</div><div id="page-content"><a href="/da:scp-002-nd">Native</a><a href="/sv:scp-002-nd">Other language</a></div>',source,new Set());
 assert.deepEqual(result.members.map(m=>m.url),['https://scp-nd.wikidot.com/da:scp-002-nd']);
 assert.equal(classify(result.members[0].url,new Map(),new Map()).branch,'nd');
});

test('every added language has verified collection inputs and a nonempty primary index',()=>{
 const inventory=require('../docs/additional-site-inventory.json');
 const sources=require('../catalog-index-sources.json').sources;
 for(const [code,site]of Object.entries(sites)){
  const proof=inventory.sites.find(s=>s.code===code);assert(proof);
  assert(proof.sources.find(s=>s.primary&&s.extractedArticles>0));
  const inputs=sources.filter(s=>s.language===code);assert(inputs.length);
  for(const input of inputs){const u=new URL(input.url);assert.equal(u.hostname,site.host);assert.equal(u.protocol,'https:');if(site.namespace)assert(u.pathname.startsWith('/'+site.namespace));}
 }
});

test('native class headings normalize verified new-site spellings and ignore crossed-out former classes',()=>{
 for(const [body,expected]of [
  ['<strong>Objectklasse:</strong> Euclid','Euclid'],
  ['<strong>Κατηγορία Aντικειμένου:</strong> Euclid','Euclid'],
  ['<strong>Osztály:</strong> Euklid','Euclid'],
  ['<strong>Genus Rei:</strong> Εὐκλείδης','Euclid'],
  ['<strong>Gjenstandsklasse:</strong> Sikker','Safe'],
  ['<strong>Föremålsklass:</strong> Euklides','Euclid'],
  ['<strong>Ontainmentcay Assclay:</strong> eterkay','Keter'],
  ['<strong>Nesne Sınıfı:</strong> <s>Güvenli</s> Nötralize Edildi','Neutralized'],
  ['<p>A fictional researcher named Euklid visits a Sikker building.</p>',null],
 ]){const d=new JSDOM('<div id="page-content">'+body+'</div>',{virtualConsole:new VirtualConsole()});try{assert.equal(extractObjectClassFromDocument(d.window.document),expected);}finally{d.window.close();}}
});

test('Nordic crawl checkpoints merge and generate downloadable v3 data on Windows and Linux',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'scp-nordic-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const partial=path.join(root,'partial'),input=path.join(root,'local-data');fs.mkdirSync(partial);fs.mkdirSync(input);
 const stamp='2026-11-09T00:00:00Z';
 for(const page of LANGUAGES.da.pages){const native=page.pageType==='scp-series-nd',slug=native?'scp-002-nd':'scp-173';
  const row={itemId:native?'scp-series-nd-002':'scp-series-173',numericItemId:native?2:173,titleJP:'Native title',urlJP:'https://scp-nd.wikidot.com/da:'+slug,isTranslatedJP:true,extractedFrom:page.pageType,pageType:page.pageType,contentType:'scp',lastUpdated:stamp,tags:[]};
  const name=partialFileName('da',page.path);assert(!name.includes(':'));fs.writeFileSync(path.join(partial,name),JSON.stringify({data:[row],timestamp:stamp}));}
 assert.equal(partialFileName('jp','scp-series'),'jp--scp-series.json');
 assert(mergeLanguage('da',partial,input));generateMobileCatalogs(input);
 const directory=path.join(input,'mobile-v3/da'),manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json')));
 const delivered=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(directory,manifest.fileName))));
 assert.equal(delivered.language,'da');assert.equal(delivered.data.length,2);
 assert(delivered.data.every(r=>r.urlJP.includes('/da:')));
 assert.deepEqual(delivered.data.map(r=>r.itemId).sort(),['scp-series-173','scp-series-nd-002']);
});

test('native description headings supply the excerpt instead of preceding theme or navigation text',()=>{
 for(const [label,body]of [['الوصف','هذا وصف المقال.'],['Beskrivelse','En beskrivelse.'],['Leírás','A leírás.'],['Açıklama','Bu bir açıklamadır.']]) {
  const record=extractHtml('https://scp-ar.wikidot.com/scp-ar-010','<div id="page-title">Article</div><div id="page-content"><p>Unrelated template text</p><p><strong>'+label+':</strong> '+body+'</p></div>');
  assert.equal(record.descriptionExcerpt,body);
 }
});

test('Arabic notifications isolate Latin SCP identifiers within RTL text',()=>{
 const message=buildNotification('ar',[{itemId:'scp-series-ar-010',titleJP:'عنوان المقال'}]);
 assert(message.body.includes('\u2066SCP-AR-010\u2069'));
 assert(!buildNotification('en',[{itemId:'scp-series-173',titleJP:'Title'}]).body.includes('\u2066'));
});
