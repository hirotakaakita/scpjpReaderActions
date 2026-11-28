'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {bodySha256,identitySha256,matchesReviewedEvidence}=require('../research-board/reviewed-identity-evidence');
const {makeRecord}=require('../research-board/extract');
const {refresh}=require('../tool/refresh-reviewed-identity-evidence');
const plan=require('../research-board/reviewed-original-67.json');
const base=plan.rules[0];
test('real publisher captures preserve the audited Czech correction and the reviewed image translation',()=>{
 for(const record of require('./fixtures/reviewed-identity-captures.json')){
  const rule=plan.rules.find(r=>r.source===record.url);
  assert.notEqual(record.contentSha256,rule.sourceSha256);
  assert(matchesReviewedEvidence(record,rule));
 }
 const cs=require('./fixtures/reviewed-identity-captures.json')[0];
 assert.equal(cs.originalSources[0].url,'https://scp-wiki.wikidot.com/scp-024');
});
const prose='This is the substantive publisher article text, preserved across page furniture changes.';
const html=(outside='',body=prose)=>`<html><head><title>SCP-025</title>${outside}</head><body><div id="page-title">SCP-025</div><div id="page-content"><p>${body}</p><div class="licensebox"><p>Original author and publisher credit outside the audited body blocks.</p></div></div></body></html>`;
function fixture(){
 const old=makeRecord(base.source,html()),current=makeRecord(base.source,html('<meta name="new-layout" content="1">'));
 current.authorCreditVersion=old.authorCreditVersion=1;
 const rule={...base,sourceSha256:old.contentSha256,publisherBodySha256:old.reviewedIdentityEvidence.bodySha256,identitySha256:identitySha256(old)};
 return {old,current,rule};
}
test('HTML furniture and credit widget display do not change the independently audited body fingerprint',()=>{
 const a=new JSDOM(html()),b=new JSDOM(html().replace('</body>','<footer>New footer</footer></body>').replace('Original author and publisher credit','Changed widget display'));
 try{assert.equal(bodySha256(a.window.document),bodySha256(b.window.document));}finally{a.window.close();b.window.close();}
 const {old,current,rule}=fixture();assert.notEqual(old.contentSha256,current.contentSha256);
 assert(matchesReviewedEvidence(current,rule));
});
test('changed article prose, identity claims, author roles, URLs and unbound fingerprints are rejected',()=>{
 const {current,rule}=fixture();
 const changed=makeRecord(base.source,html('',prose+' Substantive new content.'));
 assert(!matchesReviewedEvidence(changed,rule));
 for(const patch of [
  {title:'Different work'}, {originalSources:[{url:'https://scp-wiki.wikidot.com/scp-999'}]},
  {originalAuthors:[{id:'other-author'}]}, {translators:[{id:'new-translator'}]},
  {upstreamAuthors:[{id:'different-upstream-author'}]},
  {authorCreditVersion:0}, {url:base.target},
  {reviewedIdentityEvidence:undefined},
  {reviewedIdentityEvidence:{...current.reviewedIdentityEvidence,contentSha256:'a'.repeat(64)}},
  {reviewedIdentityEvidence:{...current.reviewedIdentityEvidence,version:2}}
 ])assert(!matchesReviewedEvidence({...current,...patch},rule),JSON.stringify(patch));
 assert(!matchesReviewedEvidence(current,{...rule,identitySha256:undefined}));
});
test('parser upgrades preserve equal semantic identity rather than invalidating its audit',()=>{
 const {current,rule}=fixture();assert(matchesReviewedEvidence({...current,authorCreditVersion:2},rule));
});
test('same-content source refreshes and catalog imports retain the stable evidence',()=>{
 const fs=require('fs'),os=require('os'),path=require('path'),z=require('zlib');
 const {merge}=require('../research-board/source-store'),{importCatalogSources}=require('../research-board/catalog-sources');
 const {current}=fixture(),sources=new Map(),stamp='2026-11-28T00:00:00.000Z';
 const state={record:{...current,checkedAt:stamp},lastAttempt:{status:'success',at:stamp}};
 merge(sources,state);
 const later={...current,checkedAt:'2026-11-28T00:01:00.000Z'};delete later.reviewedIdentityEvidence;
 merge(sources,{record:later,lastAttempt:{status:'success',at:later.checkedAt}});
 assert.deepEqual(sources.get(current.pageId).record.reviewedIdentityEvidence,current.reviewedIdentityEvidence);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'reviewed-evidence-'));
 try{
  fs.mkdirSync(path.join(dir,'catalog-indexes'));
  fs.writeFileSync(path.join(dir,'catalog-indexes/cs.json.gz'),z.gzipSync(JSON.stringify({records:{[base.source]:{...later,checkedAt:'2026-11-28T00:02:00.000Z',bodyLinks:later.links}},attempts:{}})));
  importCatalogSources(sources,dir,[{data:[{urlEN:base.source,isTranslatedJP:false}]}]);
  assert.deepEqual(sources.get(current.pageId).record.reviewedIdentityEvidence,current.reviewedIdentityEvidence);
  merge(sources,{record:{...later,contentSha256:'d'.repeat(64),checkedAt:'2026-11-28T00:03:00.000Z'}});
  assert.equal(sources.get(current.pageId).record.reviewedIdentityEvidence,undefined);
 }finally{
  assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
test('identity comparisons tolerate ordering but preserve original author and translator roles',()=>{
 const r={title:'A title',originalSources:[{url:base.target},{url:base.creditedOriginal}],authorCreditVersion:2,
 originalAuthors:[{id:'alice'},{id:'bob'}],upstreamAuthors:[],translators:[{id:'carol'}]};
 assert.equal(identitySha256(r),identitySha256({...r,originalSources:[...r.originalSources].reverse(),originalAuthors:[...r.originalAuthors].reverse()}));
 assert.notEqual(identitySha256(r),identitySha256({...r,originalAuthors:r.translators,translators:r.originalAuthors}));
});
test('stable fingerprints are collected only for exact reviewed publisher URLs',()=>{
 assert(makeRecord(base.source,html()).reviewedIdentityEvidence);
 assert.equal(makeRecord('https://scp-cs.wikidot.com/scp-9999',html()).reviewedIdentityEvidence,undefined);
});
function legacySources(){return new Map(plan.rules.map(r=>['page:'+new URL(r.source).host+new URL(r.source).pathname,
 {record:{url:r.source,contentSha256:r.sourceSha256},lastAttempt:{status:'success'}}]));}
test('legacy byte-identical evidence needs no network request or mutation',async()=>{
 const report=await refresh(legacySources(),{rules:plan.rules.filter(r=>!r.imageEvidence),fetchRecord:()=>assert.fail('unexpected fetch'),writeRecord:()=>assert.fail('unexpected write')});
 assert.equal(report.unchanged,66);assert.equal(report.fetched,0);
});

test('image-only articles require the exact reviewed asset and recheck its bytes on every publication',async()=>{
 const {digest}=require('../research-board/extract');
 const imageRule=plan.rules.find(r=>r.imageEvidence),image=Buffer.from('reviewed artwork');
 const raw=`<html><head><title>Image story</title></head><body><div id="page-content"><img src="${imageRule.imageEvidence.url}"></div></body></html>`;
 const record=makeRecord(imageRule.source,raw);
 const rule={...imageRule,identitySha256:identitySha256(record),imageEvidence:{...imageRule.imageEvidence,sha256:digest(image)}};
 assert(!matchesReviewedEvidence(record,rule));
 record.reviewedIdentityEvidence.imageSha256=digest(image);
 assert(matchesReviewedEvidence(record,rule));
 assert(!matchesReviewedEvidence({...record,reviewedIdentityEvidence:{...record.reviewedIdentityEvidence,imageUrls:['https://example.com/other.png']}},rule));
 assert(!matchesReviewedEvidence({...record,reviewedIdentityEvidence:{...record.reviewedIdentityEvidence,bodySha256:'a'.repeat(64)}},rule));
 const sources=new Map([[record.pageId,{record,lastAttempt:{status:'success'}}]]);let written=0;
 const report=await refresh(sources,{rules:[rule],fetchRecord:()=>assert.fail('already captured'),fetchImage:async()=>image,writeRecord:async()=>{written++;}});
 assert.equal(report.imagesChecked,1);assert.equal(written,1);
 await assert.rejects(refresh(sources,{rules:[rule],fetchRecord:()=>assert.fail('already captured'),fetchImage:async()=>Buffer.from('replacement artwork'),writeRecord:()=>assert.fail('unverified write')}),/image or identity changed/);
});
test('a changed legacy artifact is revalidated, never accepted or written on missing evidence or network failure',async()=>{
 const sources=legacySources(),id=sources.keys().next().value;
 sources.get(id).record.contentSha256='a'.repeat(64);
 await assert.rejects(refresh(sources,{fetchRecord:async()=>{throw Error('HTTP 503');},writeRecord:()=>assert.fail('unexpected write')}),/HTTP 503/);
 await assert.rejects(refresh(sources,{fetchRecord:async()=>makeRecord(base.source,html()),writeRecord:()=>assert.fail('unexpected write')}),/body or identity changed/);
 sources.get(id).record.reviewedIdentityEvidence={version:1,contentSha256:'a'.repeat(64),bodySha256:'b'.repeat(64)};
 await assert.rejects(refresh(sources,{fetchRecord:()=>assert.fail('changed current evidence must not be refreshed away'),writeRecord:()=>assert.fail('unexpected write')}),/body or identity changed/);
});

test('only the independently audited publisher redirects are followed',async()=>{
 const {fetchReviewedRecord}=require('../tool/refresh-reviewed-identity-evidence');
 const rule=plan.rules.find(r=>r.source==='https://scp-vn.wikidot.com/scp-4000');let requests=[];
 const record=await fetchReviewedRecord(rule.source,{delayMs:0,fetchImpl:async url=>{
  requests.push(url);
  return requests.length===1?{status:301,headers:{get:()=>'/taboo'}}:{status:200,ok:true,text:async()=>html()};
 }});
 assert.deepEqual(requests,[rule.source,rule.auditedFinalUrl]);assert.equal(record.url,rule.source);
 await assert.rejects(fetchReviewedRecord(rule.source,{delayMs:0,fetchImpl:async()=>({status:301,headers:{get:()=>'/unreviewed-other-work'}})}),/Unreviewed publisher redirect/);
 await assert.rejects(fetchReviewedRecord(base.source,{delayMs:0,fetchImpl:async()=>({status:503,ok:false})}),/HTTP 503/);
 await assert.rejects(fetchReviewedRecord(rule.source,{delayMs:0,fetchImpl:async()=>({status:301,headers:{get:()=>'/taboo'}})}),/redirect limit/);
});
