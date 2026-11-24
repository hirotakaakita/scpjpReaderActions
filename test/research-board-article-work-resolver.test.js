'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildArticleWorkResolver}=require('../research-board/resolve-article-work');
function node(work,items){
 const n=new Array(15).fill(null);
 n[13]=items.map(([url,site='en'])=>[site,url,url.split('/').at(-1),'Test','fetched']);
 n[14]=[work,'legacy',['catalog:scp-series:scp-series-179']];
 return n;
}
test('exact page URL wins even when raw itemId belongs to other works',()=>{
 const en='https://scp-wiki.wikidot.com/scp-179';
 const es26='https://lafundacionscp.wikidot.com/scp-es-026';
 const es179='https://lafundacionscp.wikidot.com/scp-es-179';
 const n1=node('catalog:scp-series-es:scp-series-es-026',[[en],[es26,'es']]);
 n1[14][2]=['catalog:scp-series-es:scp-series-es-026'];
 const n2=node('catalog:scp-series-es:scp-series-es-179',[[es179,'es']]);
 n2[14][2]=['catalog:scp-series-es:scp-series-es-179','catalog:scp-series:scp-series-179'];
 const catalogs=[{language:'en',data:[{itemId:'scp-series-179',urlJP:en,isTranslatedJP:true}]},
  {language:'es',data:[{itemId:'scp-series-es-026',urlJP:es26,isTranslatedJP:true},
    {itemId:'scp-series-es-179',urlJP:es179,isTranslatedJP:true}]}];
 const r=buildArticleWorkResolver({schemaVersion:3,nodes:[n1,n2]},{catalogs});
 assert.equal(r.resolve({articleUrl:en,itemId:'scp-series-179'}).workId,n1[14][0]);
 assert.equal(r.resolve({articleUrl:es179,itemId:'scp-series-179'}).workId,n2[14][0]);
 assert.equal(r.resolve({itemId:'scp-series-179'}).workId,n1[14][0],
   'Raw ID comes from the actual catalog, not the reused work alias');
 assert.equal(r.resolve({articleUrl:'https://scp-wiki.wikidot.com/scp-9999',itemId:'scp-series-179'}).status,'source_not_in_catalog');
});
test('duplicated itemId cannot identify which Research Board work without source URL',()=>{
 const one=node('work-a',[['https://scp-wiki.wikidot.com/scp-100']]);
 const two=node('work-b',[['https://scp-wiki-cn.wikidot.com/scp-100','cn']]);
 one[14][2]=['catalog:scp-series:scp-series-100'];
 two[14][2]=['catalog:scp-series-cn:scp-series-100'];
 const catalogs=[
  {language:'en',data:[{urlJP:'https://scp-wiki.wikidot.com/scp-100',itemId:'scp-series-100',isTranslatedJP:true}]},
  {language:'cn',data:[{urlJP:'https://scp-wiki-cn.wikidot.com/scp-100',itemId:'scp-series-100',isTranslatedJP:true}]}
 ];
 const r=buildArticleWorkResolver({schemaVersion:3,nodes:[one,two]},{catalogs});
 assert.deepEqual(r.resolve({itemId:'scp-series-100'}),
  {status:'ambiguous_item_id',workId:null,candidateCount:2});
 assert.equal(r.resolve({articleUrl:'https://scp-wiki-cn.wikidot.com/scp-100',itemId:'scp-series-100'}).workId,'work-b');
});
test('unsupported source URL or a missing exact page fails closed',()=>{
 const one=node('a',[['https://scp-wiki.wikidot.com/scp-174']]);
 one[14][2]=['catalog:scp-series:scp-series-174'];
 const r=buildArticleWorkResolver({schemaVersion:3,nodes:[one]});
 assert.equal(r.resolve({articleUrl:'https://evil.example/scp-174'}).status,'invalid_source_url');
 assert.equal(r.resolve({articleUrl:'https://scp-wiki.wikidot.com/scp-178'}).status,'source_not_in_catalog');
 assert.equal(r.resolve({itemId:'unknown'}).status,'item_id_requires_catalog_context');
 assert.equal(r.resolve().status,'missing_article_identity');
 assert.equal(r.resolve({itemId:'scp-series-174'}).status,'item_id_requires_catalog_context');
});
test('duplicate source URL across work nodes is always rejected',()=>{
 const one=node('a',[['https://scp-wiki.wikidot.com/scp-174']]);
 const two=node('b',[['https://scp-wiki.wikidot.com/scp-174']]);
 assert.throws(()=>buildArticleWorkResolver({schemaVersion:3,nodes:[one,two]}),/Duplicate source URL/);
});
