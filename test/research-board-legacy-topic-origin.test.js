'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildBoard}=require('../research-board/catalog');
const {makeRecord}=require('../research-board/extract');
const {legacyEnglishTopicPigAliases}=require('../research-board/legacy-topic-origin-aliases');
const en='https://scp-wiki.wikidot.com/scp-509',jp='https://scp-jp.wikidot.com/scp-509';
const date='2026-11-23T00:00:00Z';
function record(url,tags){const r=makeRecord(url,'<div id="page-title">Test</div><div id="page-content">'+
  '<p>'+('Containment test. '.repeat(20))+'</p></div>','html',date);r.tags=tags;return r;}
test('published historical 24 English topic-tag aliases are stable and scoped by exact source URL',()=>{
 assert.equal(legacyEnglishTopicPigAliases.size,24);
 assert.equal(legacyEnglishTopicPigAliases.get(en),'catalog:scp-series-pig:scp-series-509');
 assert.equal(legacyEnglishTopicPigAliases.get('https://scp-wiki.wikidot.com/scp-1551-ex'),'catalog:scp-pig-ex:scp-ex-1551');
});
test('topic pig on EN SCP-509 preserves old work-ID alias in the correctly classified EN work',()=>{
 const catalogs=[
  {language:'en',data:[{urlJP:en,isTranslatedJP:true,itemId:'scp-series-509',pageType:'scp-series',contentType:'scp'}]},
  {language:'jp',data:[{urlJP:jp,isTranslatedJP:true,itemId:'scp-series-509',pageType:'scp-series',contentType:'scp'}]}
 ];
 const records=[record(en,['scp','pig','safe']),record(jp,['scp','en'])];
 const sources=new Map(records.map(r=>[r.pageId,{record:r,lastAttempt:{status:'success',at:date}}]));
 const b=buildBoard(catalogs,sources),node=b.nodes.find(n=>n[13].some(v=>v[1]===en));
 assert(node);
 assert.equal(node[14][0],'catalog:scp-series:scp-series-509');
 assert(node[14][2].includes('catalog:scp-series-pig:scp-series-509'));
 assert(b.nodes.every(n=>n[14][0]!=='catalog:scp-series-pig:scp-series-509'));
});
test('a genuine Pig Latin translation cannot steal an English original legacy alias',()=>{
 const catalogs=[{language:'en',data:[{urlJP:en,isTranslatedJP:true,
   itemId:'scp-series-509',pageType:'scp-series',contentType:'scp'}]}];
 const r=record(en,['scp','international','_pig']);
 const sources=new Map([[r.pageId,{record:r,lastAttempt:{status:'success',at:date}}]]);
 assert.throws(()=>buildBoard(catalogs,sources),/Invalid source evidence for legacy topic-tag alias/);
});
