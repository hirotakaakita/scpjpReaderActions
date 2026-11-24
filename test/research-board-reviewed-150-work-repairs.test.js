'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const plan=require('../research-board/reviewed-original-67.json');
const {reviewedRepair}=require('../research-board/reviewed-150-work-repairs');
const base=plan.rules.find(r=>r.source==='https://scp-cs.wikidot.com/scp-025');
const multi=plan.rules.find(r=>r.source==='https://scp-vn.wikidot.com/scp-4000');
function caseFixture(rule,sha=rule.sourceSha256,extra=[]){
 const p={id:'s',url:rule.source,siteBranch:'cs'},q={id:'t',url:rule.target,siteBranch:'en'};
 const pages=[p,q,...extra],sources=new Map([
  ['s',{record:{url:p.url,contentSha256:sha},lastAttempt:{status:'success'}}],
  ['t',{record:{url:q.url,contentSha256:'b'.repeat(64)},lastAttempt:{status:'success'}}]
 ]);
 const pageKeys=new Map(pages.map(x=>[x.id,x.id])),
  parent=new Map(pages.map(x=>[x.id,x.id])),
  root=k=>{while(parent.get(k)!==k)k=parent.get(k);return k;},
  components=new Map(pages.map(x=>[x.id,new Set([x.id])])),nativeKeys=new Set(),proofs=[];
 for(const o of extra){
  const old='s';parent.set(o.id,old);
  components.get(old).add(o.id);components.delete(o.id);
 }
 return {p,q,pageKeys,parent,root,components,nativeKeys,proofs,
  options:{pages,sources,pageKeys,parent,root,components,nativeKeys,proofs}};
}
test('the frozen 67 audited source claims exclude all six retired-staff notices',()=>{
 assert.equal(plan.rules.length,67);
 assert.equal(plan.retiredNoticeSkipped,6);
 assert.equal(plan.wrongPublisherCreditCases,18);
 assert(!plan.rules.some(x=>x.target.endsWith('/bright-works-message')));
});
test('corrects a verified wrong Czech original-credit without ever mutating publisher credit',()=>{
 const f=caseFixture(base);
 const r=reviewedRepair(f.options);
 assert.equal(r.mergedGroups.length,1);
 assert.equal(f.root(f.pageKeys.get('s')),f.root(f.pageKeys.get('t')));
 assert.equal(f.proofs[0].method,'reviewed_primary_publisher_content_20261124');
 assert.equal(base.target,'https://scp-wiki.wikidot.com/scp-025');
 assert.equal(base.creditedOriginal,'https://scp-wiki.wikidot.com/scp-024');
});
test('fail closed on changed publisher capture content',()=>{
 const f=caseFixture(base,'a'.repeat(64));
 assert.throws(()=>reviewedRepair(f.options),/publisher evidence changed/);
});
test('canonical numbered SCP work survives a verified publisher URL alias merge',()=>{
 const f=caseFixture(multi,multi.sourceSha256,[{id:'sib',url:'https://scp-wiki.wikidot.com/scp-4000',siteBranch:'en'}]);
 f.options.sources.set('sib',{record:{url:'https://scp-wiki.wikidot.com/scp-4000',contentSha256:'a'.repeat(64)}});
 const r=reviewedRepair(f.options);
 assert.equal(r.mergedGroups.length,1);
 assert.equal(f.root('t'),f.root('s'));
 assert(f.components.get(f.root('s')).has('sib'));
});
test('unexpected full-publisher catalog without any evidence-hashed repair is rejected',()=>{
 const f=caseFixture(base,base.sourceSha256);
 f.options.pages=[...Array(100000).fill(f.p),f.q];
 assert.throws(()=>reviewedRepair(f.options),/Official full catalog lost reviewed pages|Unexpectedly few reviewed work repairs/);
});
