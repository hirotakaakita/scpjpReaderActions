'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {extractDescriptionAndTagsFromDocument}=require('../local-crawler');
const {extractHtml,extractApi}=require('../related-documents');
const {repairStoredExcerpt,VERSION}=require('../article-excerpts');
const base='https://scp-wiki.wikidot.com/scp-173';

test('theme CSS, source comments, credit panels and UI timestamps do not become prose',()=>{
 const html='<div id="page-title">Story</div><div id="page-content"><div class="collapsible-block"><div class="code">/* theme source */ @import url(x); body { color: red; }</div></div><div class="info-container">Writer biography F.A.Q.</div><span class="odate">04 Nov 2026 03:09</span><p>A real story began on 04 Nov 2026.</p></div>';
 assert.equal(extractHtml(base,html).descriptionExcerpt,'A real story began on 04 Nov 2026.');
 const source='[!-- **Описание:** This comment is not the article. --]\n[[module CSS]]\n:root { --x: red; }\n[[/module]]\n\n**Описание:** Реальное описание объекта.';
 assert.equal(extractApi('https://scpfoundation.net/scp-173',{title:'SCP-173',source}).descriptionExcerpt,'Реальное описание объекта.');
 assert.equal(repairStoredExcerpt('@import url(x); body { color: red; }').needsFetch,true);
 assert.equal(repairStoredExcerpt('2026/11/6 8:30AM The actual story begins here.').needsFetch,false);
});

test('Portuguese descriptions and nested colored labels retain all prose, not a trademark symbol',()=>{
 for(const body of ['<p><b>Descrição:</b> SCP-002 é uma massa carnuda anômala.</p>','<p><span style="color:blue"><strong>描述：</strong></span>SCP-2557 is owned by Envelope<sup>®</sup> Logistics.</p>']){
  const dom=new JSDOM('<div id="page-content">'+body+'</div>');
  assert.match(extractDescriptionAndTagsFromDocument(dom.window.document).descriptionExcerpt,/^(?:SCP-002 é|SCP-2557 is)/);dom.window.close();
 }
});

test('blank titles fall back to the actual source heading and literal Untitled is preserved',()=>{
 const {extractArticleTitle}=require('../article-titles');
 for(const [heading,want]of [['SCP-2557','SCP-2557'],['Untitled','Untitled']]){
  const dom=new JSDOM('<div id="page-title"><script>bad()</script>'+heading+'</div>');
  assert.equal(extractArticleTitle(dom.window.document,base),want);dom.window.close();
 }
});

test('FTML alignment and font-size commands never become visible text',()=>{
 const r=extractApi('https://scpfoundation.net/scp-001',{title:'SCP-001',source:'[[=]]\n[[size 200%]]A classified article with actual narrative text and readable words.[[/size]]\n[[/=]]'});
 assert.equal(r.descriptionExcerpt,'A classified article with actual narrative text and readable words.');
 assert.equal(require('../article-excerpts').normalizeFtmlPreview('=\nHeading\nsize 200%Actual words'),'Heading\nActual words');
});

test('RTL description headings accept the colon before the label',()=>{
 const r=extractHtml('https://scp-ar.wikidot.com/scp-ar-010','<div id="page-title">SCP-AR-010</div><div id="page-content"><p>SCP-AR-010: رقم الصنف</p><h1>:الوصف</h1><p>هذا هو الوصف الفعلي للعنصر وليس رأس البيانات.</p></div>');
 assert.equal(r.descriptionExcerpt,'هذا هو الوصف الفعلي للعنصر وليس رأس البيانات.');
});

test('fragment shells use only their declared children and owned HTML frames',async()=>{
 const ru=require('../rufoundation-crawler');
 const text=await ru.extractApiDescription({source:'[[module ListPages category="fragment" parent="."]]\n%%content%%\n[[/module]]',children:['https://evil.example/x','fragment:story-1']},async url=>{assert.equal(url,'https://scpfoundation.net/api/articles/fragment%3Astory-1');return {source:'**Описание:** The actual transcluded description.'};});
 assert.equal(text,'The actual transcluded description.');
 const {extractOwnedFrameProse}=require('../article-frames');let calls=0;
 const html='<div id="page-content"><iframe src="https://evil.example/a"></iframe><iframe src="https://scp-wiki.wdfiles.com/local--html/scp-173/abc"></iframe></div>';
 assert.equal(await extractOwnedFrameProse(base,html,async url=>{calls++;assert(url.includes('/local--html/scp-173/'));return '<style>body{color:red}</style><p>The actual embedded story.</p>';}),'The actual embedded story.');assert.equal(calls,1);
});

test('stored widgets are removed precisely while prose, SCP references and evaluations survive',()=>{
 assert.equal(repairStoredExcerpt('rating: +12+–x rating: +12+–x SCP-173 is a statue.').text,'SCP-173 is a statue.');
 assert.equal(repairStoredExcerpt('notation: +12+–x fermer Crédits close Actual narrative.').text,'Actual narrative.');
 assert.equal(repairStoredExcerpt('Rating: 评分: +8+–x Actual narrative.').text,'Actual narrative.');
 for(const label of ['avaliação','рейтинг','đánh giá','คะแนน'])assert.equal(repairStoredExcerpt(label+': +12+–x Actual narrative.').text,'Actual narrative.');
 assert.equal(repairStoredExcerpt('Author panel rating: +12+–x Actual narrative.').needsFetch,true);
 for(const text of ['The rating: +12 is part of the experiment.','Item numbers are mentioned in this story.','项目编号未被分配给任何项目。','SCP-173 is classified as Euclid.'])assert.equal(repairStoredExcerpt(text).needsFetch,false);
 for(const text of ['Item #: SCP-173 Object Class: Euclid','アイテム番号: SCP-173','項目編號：SCP-173','Object Class: Euclid','Objet # : SCP-173','Elemento #: SCP-003-IT','rating: +12+–x'])assert.equal(repairStoredExcerpt(text).needsFetch,true);
});

test('SCP descriptions accept plain paragraphs and inline fields without leaking headers or mutating metadata',()=>{
 const body='<div class="page-rate-widget-box"><span class="rate-points"><span class="number">+24</span></span>rating: +24+–x</div><p>Item #: SCP-173</p><p>Object Class: Euclid</p><p>Description: SCP-173 is a statue with an unusual history.</p>';
 const dom=new JSDOM(`<div id="page-content">${body}</div><div class="page-tags"><a>humanoid</a></div>`);
 const before=dom.window.document.body.innerHTML,details=extractDescriptionAndTagsFromDocument(dom.window.document);
 assert.equal(details.descriptionExcerpt,'SCP-173 is a statue with an unusual history.');assert.equal(details.descriptionVersion,VERSION);assert.deepEqual(details.tags,['humanoid']);
 assert.equal(dom.window.document.body.innerHTML,before);dom.window.close();
 const record=extractHtml(base,`<div id="page-title">SCP-173</div><div id="page-content">${body}</div>`);
 assert.equal(record.rating,24);assert.equal(record.objectClass,'Euclid');assert.equal(record.descriptionExcerpt,details.descriptionExcerpt);
 const fallback=extractHtml(base,'<div id="page-title">SCP-173</div><div id="page-content"><p>Item #: SCP-173 Object Class: Euclid Special Containment Procedures: The actual procedures are recorded here and remain available for readers.</p></div>');
 assert.equal(fallback.descriptionExcerpt,'The actual procedures are recorded here and remain available for readers.');
});

test('Russian indexed excerpts use the same Description extraction as SCP API crawling',()=>{
 const source='[[module Rate]]\n\n**Объект №:** SCP-173\n\n**Класс объекта:** Евклид\n\n**Описание:** This is the actual description of the anomaly.';
 const record=extractApi('https://scpfoundation.net/scp-173',{title:'SCP-173',source,tags:[]});
 assert.equal(record.descriptionExcerpt,'This is the actual description of the anomaly.');assert.equal(record.descriptionVersion,VERSION);
});
