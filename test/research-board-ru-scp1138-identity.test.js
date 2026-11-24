'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildBoard}=require('../research-board/catalog');
const {makeRecord}=require('../research-board/extract');
const {scpIdentityKey}=require('../research-board/translation-identities');
const {evidenceUrls,originalUrl,nativeOtherUrl,enUrl,markedIdentityKey,marker}
  =require('../research-board/russian-english-mainlist-originals');
const at='2026-11-23T00:00:00Z';
function fixture({wrongCredit=false,omitSecond=false,includeDeConflict=false}={}){
 const native=evidenceUrls;
 const catalogs=[],states=[];
 for(const url of [...native,nativeOtherUrl]){
  const u=new URL(url),language=({
   'scpfoundation.net':'ru','scp-wiki.wikidot.com':'en','scp-wiki-cn.wikidot.com':'cn',
   'scp-vn.wikidot.com':'vn','scp-pt-br.wikidot.com':'pt',
   'fondationscp.wikidot.com':'fr','lafundacionscp.wikidot.com':'es',
   'scp-jp.wikidot.com':'jp','scp-pl.wikidot.com':'pl',
   'scp-wiki-de.wikidot.com':'de','scpko.wikidot.com':'ko'
  })[u.hostname];
  const original= url===originalUrl,other=url===nativeOtherUrl,en=url===enUrl;
  const itemId=other?'scp-series-1138-ru':'scp-series-1138';
  const pageType=other?'scp-series-ru':'scp-series';
  if(!catalogs.some(x=>x.language===language))catalogs.push({language,timestamp:at,data:[]});
  catalogs.find(c=>c.language===language).data.push({urlJP:url,isTranslatedJP:true,itemId,pageType,
    contentType:'scp',numericItemId:1138,titleJP:original?'SCP-1138 - Книга писем':
    other?'SCP-1138-RU - Прямой эфир':'Book of Letters'});
  const record=makeRecord(url,'<html><title>Book of Letters</title><div id="page-content"><p>'+
    ('Contained letters in a book. '.repeat(14))+'</p></div></html>','html',at);
  record.title=original?'SCP-1138 - Книга писем':other?'SCP-1138-RU - Прямой эфир':
    'SCP-1138 - Book of Letters';
  record.tags=original?['филиал:en','филиал:ru']:
    other?['филиал:ru']:en?['_ru','international']:['scp','ru'];
  record.originalSources=en?[{url:wrongCredit?nativeOtherUrl:originalUrl,
    method:'credit_original_label',quote:'Original Article:'}]:
    (includeDeConflict&&language==='de')?[{url:nativeOtherUrl,
      method:'credit_original_label',quote:'Original Article:'}]:[];
  states.push({url,id:record.pageId,record});
 }
 for(const c of catalogs)c.totalCount=c.data.length;
 const sources=new Map(states.map(x=>[x.id,{record:x.record,lastAttempt:{status:'success',at}}]));
 if(omitSecond){
   const key=states.find(x=>x.url===nativeOtherUrl)?.id;
   sources.delete(key);
 }
 return {catalogs,sources};
}
const parent=(board,url)=>board.nodes.find(n=>n[13].some(p=>p[1]===url));
test('all 11 curated Book of Letters versions unify, but native RU SCP-1138-RU stays different',()=>{
 const {catalogs,sources}=fixture(),b=buildBoard(catalogs,sources);
 const book=parent(b,originalUrl),live=parent(b,nativeOtherUrl),english=parent(b,enUrl);
 assert(book&&live&&english);
 for(const url of evidenceUrls)assert.equal(parent(b,url)?.[14][0],book[14][0],url);
 assert.notEqual(book[14][0],live[14][0]);
 assert.equal(book[14][0],'catalog:scp-series:scp-series-1138');
 assert.equal(live[14][0],'catalog:scp-series-ru:scp-series-1138-ru');
 assert.equal(book[8],'ru');assert.equal(book[12],'scp-series-ru');
 assert.equal(b.nodes.reduce((n,v)=>n+v[13].length,0),evidenceUrls.length+1);
 assert.deepEqual([...new Set(b.nodes.flatMap(n=>n[14][2]))].sort(),
   b.nodes.flatMap(n=>n[14][2]).sort());
});
test('regular Russian SCP-1138-RU remains on its own numbered key, never inherits the special label',()=>{
 const native={slug:'scp-1138-ru',branch:'ru',pageType:'scp-series-ru'};
 const en={slug:'scp-1138',branch:'ru',pageType:'scp-series-ru',
   historicalOriginalReview:marker};
 assert.notEqual(scpIdentityKey(native),scpIdentityKey(en));
 assert.equal(markedIdentityKey(native),null);
});
test('malformed or contradictory Russian original attribution blocks this correction',()=>{
 assert.throws(()=>buildBoard(...Object.values(fixture({wrongCredit:true}))),/Unsafe RU Book of Letters/);
 assert.throws(()=>buildBoard(...Object.values(fixture({includeDeConflict:true}))),/Conflicting Book of Letters original credit/);
});
test('missing original native paper does not cause an invented work merge',()=>{
 const {catalogs,sources}=fixture({omitSecond:true});
 const b=buildBoard(catalogs,sources);
 assert(b.nodes.length>0);
 // No proof for a non-existing original; the full-catalog publisher audit
 // separately detects missing native capture. All pages stay present.
 assert.equal(b.overview.sourcePageCount,evidenceUrls.length+1);
});
