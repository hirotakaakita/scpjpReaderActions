'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),os=require('os');
const {russianJokeIdentity}=require('../russian-joke-identity');
const {reclassifyScpArticle}=require('../article-category');
const {scpIdentity}=require('../merge-catalog-indexes');
const {crawlRussianApi}=require('../rufoundation-crawler');
const base='https://scpfoundation.net/',tags=['тип:шуточный','структура:объект'];
const examples=[['scp-1d6-j','joke-scps-1d6','joke-scps',null],['scp-3v1l-j','joke-scps-3v1l','joke-scps',null],['scp-008-de-j','joke-scps-de-008','joke-scps-de',8],['scp-1733-ru-j','joke-scps-ru-1733','joke-scps-ru',1733],['scp-1121-ru-j-v','joke-scps-ru-1121-j-v','joke-scps-ru',1121],['scp-minus-1-j','joke-scps-minus-1-j','joke-scps',null]];

test('Russian Joke identity supports alphanumeric identifiers, origin branches and variants',()=>{
 for(const [slug,id,type,n] of examples){
  const r=russianJokeIdentity(base+slug,tags);assert.equal(r.itemId,id);assert.equal(r.pageType,type);assert.equal(r.numericItemId,n);
 }
 assert.equal(russianJokeIdentity(base+'scp-682-cu',[{id:'tag-hash',label:'тип:шуточный'}]).pageType,'joke-scps');
 assert.equal(russianJokeIdentity(base+'spc-169-j',tags),null);
 assert.equal(russianJokeIdentity(base+'scp-1471-j-supplement-log',tags),null);
 assert.equal(russianJokeIdentity(base+'scp-173',[]),null);
 assert.equal(russianJokeIdentity('https://scp-jp.wikidot.com/scp-173-j',[]),null);
});

test('delivery repairs cached RU Joke classifications while respecting explicit non-SCP types',()=>{
 for(const [slug,id,type,n] of examples){
  const before={itemId:'scp-series-'+slug.slice(4),pageType:'scp-series',contentType:'scp',extractedFrom:'scp-series',urlJP:base+slug,tags:[],createdAt:'2026-01-01',lastUpdated:'2026-11-01',imageUrl:'https://example.com/photo.jpg'};
  const after=reclassifyScpArticle(before);assert.equal(after.itemId,id);assert.equal(after.pageType,type);assert.equal(after.extractedFrom,type);assert.equal(after.numericItemId,n);
  for(const k of ['urlJP','createdAt','lastUpdated','imageUrl'])assert.equal(after[k],before[k]);
  assert.deepEqual(reclassifyScpArticle(after),after);
  for(const kind of ['tale','goi','record','archive']){
   const explicit={...before,pageType:'related-document-en',contentType:kind};assert.deepEqual(reclassifyScpArticle(explicit),explicit);
  }
  const archived={...before,tags:['archived']};assert.equal(reclassifyScpArticle(archived).contentType,'archive');
 }
});

test('official-index merging recognizes nondecimal Russian Joke SCPs without admitting SPC formats',()=>{
 for(const slug of ['scp-1d6-j','scp-3v1l-j','scp-minus-1-j']){
  const row=scpIdentity({slug,url:base+slug},{tags},'en',new Map());assert(row.pageType.startsWith('joke-scps'));
 }
 assert.equal(scpIdentity({slug:'spc-169-j',url:base+'spc-169-j'},{tags},'en',new Map()),null);
 assert.equal(scpIdentity({slug:'scp-1d6-j',url:base+'scp-1d6-j'},{tags:['tale',...tags]},'en',new Map()),null);
});

test('RU API reruns assign Joke IDs and reuse exact-URL metadata across an ID correction',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ru-joke-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const language of ['ru','en'])fs.mkdirSync(path.join(root,'local-data',language),{recursive:true});
 fs.writeFileSync(path.join(root,'local-data/en/scp-data.json'),JSON.stringify({data:[]}));
 const chosen=examples,created='2026-01-01T00:00:00Z';
 const old=chosen.map(([slug])=>({itemId:'scp-series-'+slug.slice(4),urlJP:base+slug,pageType:'scp-series',objectClass:'Safe',descriptionExcerpt:'Existing valid description',imageUrl:'https://example.com/'+slug+'.jpg',availabilityVersion:1,createdAt:created,tags:[]}));
 const file=path.join(root,'local-data/ru/scp-data.json');fs.writeFileSync(file,JSON.stringify({data:old}));
 const list=[...chosen.map(([pageId])=>({pageId,title:pageId.toUpperCase(),tags})),{pageId:'scp-pl-kot-j-arc',title:'SCP-PL-KOT-J-ARC',tags:['archived',...tags]}];let calls=0;
 const request=async url=>{calls++;assert(url.endsWith('/api/articles'));return list;};
 const first=await crawlRussianApi({root,request,metadataOnly:true});assert.equal(first.totalCount,chosen.length);
 for(const [index,slug] of chosen.entries()){
  const r=first.data.find(r=>r.itemId===slug[1]);assert(r);assert.equal(r.pageType,slug[2]);assert.equal(r.extractedFrom,slug[2]);assert.equal(r.numericItemId,slug[3]);assert.equal(r.imageUrl,old[index].imageUrl);assert.equal(r.createdAt,created);
 }
 fs.writeFileSync(file,JSON.stringify(first));const next=await crawlRussianApi({root,request,metadataOnly:true});
 assert.deepEqual(next.data.map(r=>r.itemId),first.data.map(r=>r.itemId));assert.equal(calls,2);
});
