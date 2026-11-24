'use strict';
// Article-catalogue preserving corrections audited from 319 live publisher
// article URLs and 150 explicit original-claim cases on 2026-11-24.
// Only the exact 67 still-visible translation cases may change work groups.
// The original publisher credit is not rewritten; incorrect credits remain
// intact as evidence. Archived editions and historic retirement notices are
// not in the manifest. No synthetic nodes or catalogue IDs are introduced.
const plan=require('./reviewed-original-67.json');
const preservedMainRoot=new Set([
 'https://scp-jp.wikidot.com/scp-173-but-it-s-the-admonition-hub',
 'https://scp-vn.wikidot.com/scp-2195',
 'https://scp-vn.wikidot.com/scp-4000',
 'https://scp-vn.wikidot.com/scp-5814',
 'https://scp-wiki-de.wikidot.com/scp-4194',
 'https://scp-wiki-de.wikidot.com/scp-eo-416',
 'https://scp-wiki.wikidot.com/scp-1150-j',
 'https://scp-wiki.wikidot.com/scp-206',
 'https://scpko.wikidot.com/scp-6470',
 'https://scp-wiki-cn.wikidot.com/scp-002-ir'
]);
const statusBad=new Set(['not_found','not_article','unavailable']);
function reviewedRepair({pages,sources,pageKeys,parent,root,components,nativeKeys,proofs}){
 if(plan.schemaVersion!==1||plan.workIdentityCases!==67||
  plan.retiredNoticeSkipped!==6||plan.wrongPublisherCreditCases!==18||
  plan.rules?.length!==67||new Set(plan.rules.map(r=>r.source)).size!==67)
  throw Error('Reviewed work plan no longer matches 150-case publisher audit');
 const byUrl=new Map(pages.map(p=>[p.url,p]));
 const merged=[],alreadyCombined=[],missing=[];
 for(const rule of plan.rules){
  const source=byUrl.get(rule.source),target=byUrl.get(rule.target);
  // Small synthetic unit tests may not include every official catalog page.
  // Synthetic tests may contain one end of a reviewed pair. Full-catalogue
  // builds enforce complete coverage after processing all rules.
  if(!source||!target){missing.push(rule.source);continue;}
  const state=sources.get(source.id),targetState=sources.get(target.id);
  if(!state?.record||!targetState?.record||statusBad.has(state.lastAttempt?.status)||
   statusBad.has(targetState.lastAttempt?.status)||
   state.record.url!==rule.source||
   state.record.contentSha256!==rule.sourceSha256||
   !/^[a-f0-9]{64}$/.test(rule.publisherBodySha256))
   throw Error('Original/translation publisher evidence changed: '+rule.source);
  const sourceKey=pageKeys.get(source.id),targetKey=pageKeys.get(target.id);
  if(!sourceKey||!targetKey)throw Error('Lost catalog identity for '+rule.source);
  const a=root(sourceKey),b=root(targetKey);
  if(a!==b){
   const left=components.get(a),right=components.get(b);
   if(!left?.has(source.id)||!right?.has(target.id))throw Error('Identity component collision: '+rule.source);
   // Do NOT join by a name, a number, or a slug. This union is authorized by
   // the unique evidence-hashed source URL in this exact reviewed set.
   const preferred=preservedMainRoot.has(rule.source)?a:b;
   const other=preferred===a?b:a;
   parent.set(other,preferred);
   components.set(preferred,new Set([...left,...right]));
   components.delete(other);
   if(nativeKeys.has(a)||nativeKeys.has(b))nativeKeys.add(preferred);
   merged.push({source:rule.source,target:rule.target,sourcePages:left.size,targetPages:right.size,
    retainedWork:preferred,absorbedWork:other});
  }else alreadyCombined.push(rule.source);
  proofs.push({source:source.url,target:target.url,method:'reviewed_primary_publisher_content_20261124',
   reference:rule.publisherBodySha256,correctedCredit:rule.method==='verified_wrong_original_credit'});
 }
 if(pages.length>100000&&missing.length)throw Error('Official full catalog lost reviewed pages '+missing.join(', '));
 if(pages.length>100000&&merged.length<40)throw Error('Unexpectedly few reviewed work repairs: '+merged.length);
 return {reviewedCount:plan.rules.length,mergedGroups:merged,alreadyCombined,missing};
}
module.exports={reviewedRepair,preservedMainRoot};
