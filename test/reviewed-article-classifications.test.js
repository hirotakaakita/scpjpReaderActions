'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {reclassifyScpArticle}=require('../article-category');
const {scpIdentity}=require('../merge-catalog-indexes');
const {cases}=require('./fixtures/reviewed-article-classifications.json');

test('all 360 source-reviewed articles reach the reviewed category and origin on rebuild',()=>{
 assert.equal(cases.length,360);
 for(const {expected,line,language,...row} of cases){
  const corrected=reclassifyScpArticle(row);
  for(const [key,value]of Object.entries(expected))assert.equal(corrected[key],value,`CSV ${line} ${key}: ${row.urlJP}`);
  assert.deepEqual(reclassifyScpArticle(corrected),corrected,`CSV ${line}: repeat build`);
  assert.equal(corrected.urlJP,row.urlJP);
  assert(corrected.numericItemId==null||Number.isSafeInteger(corrected.numericItemId),`CSV ${line}: the reader expects an integer numericItemId`);
 }
});

test('retained tag IDs and embedded labels give the same result as source labels',()=>{
 const dictionary=require('../tag-dictionary.json').tags;
 const ids=new Map(Object.entries(dictionary).flatMap(([id,t])=>(t.aliases||[]).map(label=>[label,id])));
 for(const {expected,line,...row}of cases){
  for(const tags of [row.tags.map(label=>({id:ids.get(label)||label,label})),row.tags.map(label=>ids.get(label)||label)]){
   const result=reclassifyScpArticle({...row,tags});
   for(const [k,v]of Object.entries(expected))assert.equal(result[k],v,`CSV ${line}: canonical tag ${k}`);
  }
 }
});

test('reclassification merges aliases for one work but rejects collisions between different works',()=>{
 const {deduplicateReclassifiedArticles}=require('../article-metadata');
 const row={itemId:'scp-series-jp-4133',urlJP:'https://scp-jp.wikidot.com/scp-4133-jp'};
 assert.deepEqual(deduplicateReclassifiedArticles([{...row,urlJP:'http://scp-jp.wikidot.com/scp-4000-jp-o-92-mallet'},row]).map(r=>r.urlJP),[row.urlJP]);
 assert.equal(deduplicateReclassifiedArticles([row,{...row,urlJP:row.urlJP.replace('https:','http:')}]).length,1);
 assert.throws(()=>deduplicateReclassifiedArticles([row,{...row,urlJP:'https://scp-jp.wikidot.com/scp-9999-jp'}]),/Conflicting reclassified itemId/);
});

test('new official-index crawls agree with the reviewed delivery classifications',()=>{
 for(const {expected,line,...row}of cases){
  const slug=decodeURIComponent(new URL(row.urlJP).pathname).slice(1);
  const scp=scpIdentity({slug,url:row.urlJP},{tags:row.tags,title:row.titleJP},null,new Map());
  if(expected.contentType==='scp'){
   assert.equal(scp?.pageType,expected.pageType,`CSV ${line}: ${row.urlJP}`);
   if(expected.itemId)assert.equal(scp.itemId,expected.itemId,`CSV ${line}: identifier`);
  }else assert.equal(scp,null,`CSV ${line}: a non-SCP must not enter a numbered series`);
 }
});
