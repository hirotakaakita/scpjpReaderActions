'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {verifiedCatalogOriginals}=require('../research-board/identity-metadata');
const {merge}=require('../research-board/source-store');
const {normalizePage}=require('../research-board/extract');
const {validateIdentityProofs}=require('../research-board/validate-identity-proofs');
const row=()=>({url:'https://scp-pl.wikidot.com/omega-k',originBranch:'en',classification:{basis:'interwiki_original_metadata',evidence:[{
 queryUrl:'https://scp-pl.wikidot.com/omega-k',status:'translation',terminal:true,schemaVersion:1,
 checkedAt:'2026-11-09T00:00:00Z',contentSha256:'a'.repeat(64),chain:['https://scp-wiki.wikidot.com/omega-k'],
}]}});
test('terminal article-specific metadata is preserved as an exact original URL',()=>{
 const r=verifiedCatalogOriginals(row());assert.equal(r.length,1);assert.equal(r[0].url,'https://scp-wiki.wikidot.com/omega-k');
 assert.equal(r[0].method,'interwiki_original_metadata');assert.equal(r[0].checkedAt,'2026-11-09T00:00:00Z');
});
test('an intermediate translated source is accepted only with its independently cataloged original branch',()=>{
 const r=row();r.classification.evidence[0].chain=['https://scpko.wikidot.com/omega-k'];
 assert.deepEqual(verifiedCatalogOriginals(r),[]);
 assert.equal(verifiedCatalogOriginals(r,new Map([['https://scpko.wikidot.com/omega-k','en']]))[0].url,'https://scpko.wikidot.com/omega-k');
 assert.deepEqual(verifiedCatalogOriginals(r,new Map([['https://scpko.wikidot.com/omega-k','ko']])),[]);
});
test('origin labels, incomplete chains, another article and conflicting original branch do not become identity pointers',()=>{
 for(const mode of ['label','terminal','query','branch','date','hash']){
  const r=row(),p=r.classification.evidence[0];
  if(mode==='label')r.classification.basis='publisher_origin_tag';
  if(mode==='terminal')p.terminal=false;
  if(mode==='query')p.queryUrl='https://scp-pl.wikidot.com/different';
  if(mode==='branch')r.originBranch='jp';
  if(mode==='date')p.checkedAt='unknown';
  if(mode==='hash')p.contentSha256='';
  assert.deepEqual(verifiedCatalogOriginals(r),[],mode);
 }
});

test('corrected author roles upgrade identical bodies and cannot be downgraded by older metadata parsers',()=>{
 const p=normalizePage('https://scp-wiki.wikidot.com/story'),sources=new Map();
 const old={url:p.url,pageId:p.id,contentSha256:'a'.repeat(64),checkedAt:'2026-11-17T00:00:00Z',authorCreditVersion:1,originalAuthors:[{id:'artist'}]};
 merge(sources,{record:old});
 merge(sources,{record:{...old,authorCreditVersion:2,originalAuthors:[],assetAuthors:[{id:'artist'}]}});
 assert.equal(sources.get(p.id).record.authorCreditVersion,2);
 assert.deepEqual(sources.get(p.id).record.originalAuthors,[]);
 merge(sources,{record:{...old,checkedAt:'2026-11-18T00:00:00Z'}});
 assert.equal(sources.get(p.id).record.authorCreditVersion,2);
 assert.deepEqual(sources.get(p.id).record.assetAuthors,[{id:'artist'}]);
});

test('publication validation checks the exact original pointer rather than accepting its method name',()=>{
 const a=normalizePage('https://scp-jp.wikidot.com/translated'),b=normalizePage('https://scp-wiki.wikidot.com/original');
 const r={url:a.url,catalogIdentity:{originalSources:[{url:b.url,method:'interwiki_original_metadata'}]}};
 const sources=new Map([[a.id,{record:r}]]),board={nodes:[],workIdentityProofs:[{source:a.url,target:b.url,method:'interwiki_original_metadata'}]};
 validateIdentityProofs(board,sources);
 r.catalogIdentity.originalSources[0].url='https://scp-wiki.wikidot.com/different';
 assert.throws(()=>validateIdentityProofs(board,sources),/Unproven interwiki/);
});

test('publication validation accepts mixed credit/metadata originals but rejects contradictory targets',()=>{
 const a=normalizePage('https://scp-jp.wikidot.com/translated'),b=normalizePage('https://scp-wiki-cn.wikidot.com/translated');
 const url='https://scp-wiki.wikidot.com/original';
 const sources=new Map([[a.id,{record:{url:a.url,originalSources:[{url,method:'credit_original_label'}]}}],
  [b.id,{record:{url:b.url,catalogIdentity:{originalSources:[{url,method:'interwiki_original_metadata'}]}}}]]);
 const board={nodes:[],workIdentityProofs:[{source:a.url,target:b.url,method:'shared_verified_original_metadata'}]};
 validateIdentityProofs(board,sources);
 board.workIdentityProofs[0].method='shared_explicit_original_credit';
 assert.throws(()=>validateIdentityProofs(board,sources),/Unproven shared/);
});
