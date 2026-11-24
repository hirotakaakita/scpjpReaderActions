'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {audit}=require('../tool/audit-board-reading-itemids');
function node(work,url){
 const x=new Array(15).fill(null);
 x[13]=[['en',url,url.split('/').at(-1),'Test','fetched']];
 x[14]=[work,'legacy:test',[work]];return x;
}
test('same catalog itemId across different works is a reading-record ambiguity',()=>{
 const en='https://scp-wiki.wikidot.com/scp-001';
 const es='https://lafundacionscp.wikidot.com/scp-es-001';
 const other='https://scp-wiki.wikidot.com/scp-002';
 const board={revision:'test',
   nodes:[node('catalog:en:001',en),node('catalog:es:001',es),node('catalog:en:002',other)]};
 const row=(url,id)=>({urlJP:url,isTranslatedJP:true,itemId:id,pageType:'scp-series',titleJP:id});
 const catalogs=[
  {language:'en',data:[row(en,'shared-item-id'),row(other,'distinct-item-id')]},
  {language:'es',data:[row(es,'shared-item-id')]}
 ];
 const moved=[{url:en,previousWork:'old-work',nextWork:'catalog:en:001'}];
 const r=audit(catalogs,board,moved);
 assert.equal(r.summary.movedUrlCount,1);
 assert.equal(r.summary.foundMovedUrls,1);
 assert.equal(r.summary.globalAmbiguousItemIds,1);
 assert.equal(r.summary.ambiguousAffectedRawItemIds,1);
 assert.equal(r.summary.movedRowsWithAmbiguousItemId,1);
 assert.equal(r.moved[0].rawItemIdIsAmbiguous,true);
 assert.match(r.moved[0].conflictingWorks,/catalog:es:001/);
});
test('translations sharing an itemId within one work are not a collision',()=>{
 const en='https://scp-wiki.wikidot.com/scp-003';
 const jp='https://scp-jp.wikidot.com/scp-003';
 const board={revision:'test',nodes:[(()=>{
  const n=node('catalog:en:003',en);
  n[13].push(['jp',jp,'scp-003','Test','fetched']);return n;
 })()]};
 const row=url=>({urlJP:url,isTranslatedJP:true,itemId:'scp-series-003',pageType:'scp-series'});
 const r=audit([{language:'en',data:[row(en)]},{language:'jp',data:[row(jp)]}],
  board,[{url:jp,previousWork:'old',nextWork:'catalog:en:003'}]);
 assert.equal(r.summary.globalAmbiguousItemIds,0);
 assert.equal(r.summary.ambiguousAffectedRawItemIds,0);
});
