'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {extractDescriptionAndTagsFromDocument}=require('../local-crawler');
const {extractHtml,extractApi}=require('../related-documents');
const {repairStoredExcerpt,VERSION}=require('../article-excerpts');
const base='https://scp-wiki.wikidot.com/scp-173';

test('stored widgets are removed precisely while prose, SCP references and evaluations survive',()=>{
 assert.equal(repairStoredExcerpt('rating: +12+–x rating: +12+–x SCP-173 is a statue.').text,'SCP-173 is a statue.');
 assert.equal(repairStoredExcerpt('notation: +12+–x fermer Crédits close Actual narrative.').text,'Actual narrative.');
 assert.equal(repairStoredExcerpt('Rating: 评分: +8+–x Actual narrative.').text,'Actual narrative.');
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
