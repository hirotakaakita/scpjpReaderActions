'use strict';
const fs=require('node:fs'),path=require('node:path');
const {loadBoard,buildIndex}=require('./audit');
const {readSources}=require('../source-store');
const {originalPage}=require('../../origin-provenance');
const {normalizedUrl}=require('./reference');
// Follow only publisher-explicit "Original Article" links. Other identity
// claims are useful evidence, but must not silently become verified ancestry.
function traceRoot(source,pointers,maxDepth=32){
  let current=source,trail=[source],seen=new Set();
  for(let i=0;i<maxDepth;i++){
    if(seen.has(current))return {status:'cycle',root:current,path:trail};
    seen.add(current);
    const next=pointers.get(current);
    if(!next)return {status:'terminal',root:current,path:trail};
    trail.push(next);current=next;
  }
  return {status:'depth_limit',root:current,path:trail};
}
function sourcePointer(record){
  const direct=(record?.originalSources||[]).filter(x=>x.method==='credit_original_label');
  const urls=[...new Set(direct.map(x=>{try{return normalizedUrl(originalPage(x.url)?.url||x.url);}catch(_){return null;}}).filter(Boolean))];
  return {urls,rawCount:direct.length};
}
function classify(index,pointers,sourceRecords){
  const review=[],count={},pagesByWork=new Map();
  for(const page of index.pages){
    if(!pagesByWork.has(page.workId))pagesByWork.set(page.workId,[]);
    pagesByWork.get(page.workId).push(page);
  }
  for(const [source,target] of pointers){
    const owner=index.workByUrl.get(source),resolution=traceRoot(source,pointers);
    const rootWork=index.workByUrl.get(resolution.root)||null;
    let category;
    if(resolution.status==='cycle')category='original_credit_cycle';
    else if(resolution.status==='depth_limit')category='chain_depth_limit';
    else if(!rootWork)category='credited_original_absent_from_catalog';
    else if(rootWork===owner)category='same_work_verified_by_credit';
    else {
      const hostname=new URL(resolution.root).hostname;
      const members=pagesByWork.get(owner)||[];
      const conflictingNative=members.filter(p=>new URL(p.url).hostname===hostname&&
        p.url!==resolution.root).map(p=>p.url);
      category=conflictingNative.length?'explicit_original_vs_native_work_collision':'explicit_original_work_split';
    }
    if(category!=='same_work_verified_by_credit'){
      const record=sourceRecords.get(source);
      const targetMembers=pagesByWork.get(rootWork)||[];
      const sourceHost=new URL(source).hostname;
      const sameSiteTargets=targetMembers.filter(p=>new URL(p.url).hostname===sourceHost&&p.url!==source).map(p=>p.url);
      const disposition=/(?:^|\/)bright-works-message$/.test(resolution.root)?'hold_retirement_notice':
        resolution.status!=='terminal'?'hold_invalid_credit_chain':!rootWork?'hold_outside_catalog':
        sameSiteTargets.length?'hold_same_site_collision':'hold_publisher_identity_review';
      review.push({source,creditedOriginal:target,ultimateOriginal:resolution.root,
        ownerWork:owner,originalWork:rootWork,category,disposition,
        sameSiteTargets,chain:resolution.path,contentSha256:record?.contentSha256||null,
        checkedAt:record?.checkedAt||null,claims:record?.originalSources||[]});
    }
    count[category]=(count[category]||0)+1;
  }
  return {counts:count,review:review.sort((a,b)=>a.category.localeCompare(b.category)||a.source.localeCompare(b.source))};
}
function run(out){
  const {board}=loadBoard(),index=buildIndex(board);
  const records=readSources(path.join(__dirname,'../../local-data/research-board-sources'));
  const pointers=new Map(),metadata=new Map(),ambiguous=[];
  for(const state of records.values()){
    const record=state?.record;if(!record?.url||!index.workByUrl.has(record.url))continue;
    const source=normalizedUrl(record.url),claim=sourcePointer(record);
    if(claim.urls.length>1)ambiguous.push({source,urls:claim.urls,disposition:'hold_ambiguous_originals',
      contentSha256:record.contentSha256,checkedAt:record.checkedAt,claims:record.originalSources});
    else if(claim.urls.length===1&&claim.urls[0]!==source) {
      pointers.set(source,claim.urls[0]);metadata.set(source,record);
    }
  }
  const classification=classify(index,pointers,metadata);
  const result={schemaVersion:1,generatedAt:new Date().toISOString(),revision:board.revision,
    explicitSourceCount:pointers.size,ambiguousCount:ambiguous.length,
    counts:classification.counts,dispositions:classification.review.reduce((m,c)=>{
      m[c.disposition]=(m[c.disposition]||0)+1;return m;
    },{}),cases:classification.review,ambiguous};
  fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'identity-provenance.json'),JSON.stringify(result,null,2)+'\n');
  const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const headings=['source','category','disposition','ownerWork','ultimateOriginal','originalWork','sameSiteTargets','chain','contentSha256','checkedAt'];
  const lines=[headings.map(q).join(',')];
  for(const item of classification.review)
    lines.push(headings.map(h=>q(Array.isArray(item[h])?item[h].join(' | '):item[h])).join(','));
  fs.writeFileSync(path.join(out,'identity-provenance.csv'),lines.join('\n')+'\n');
  fs.writeFileSync(path.join(out,'IDENTITY-PROVENANCE.md'),[
    '# Explicit original credit chains',
    '', 'Revision: '+board.revision,
    'Direct unique credit pointers: '+pointers.size,
    'Ambiguous multiple originals: '+ambiguous.length,
    '', '| Category | Count |','| --- | ---: |',
    ...Object.entries(result.counts).sort((a,b)=>b[1]-a[1]).map(([k,v])=>'| '+k+' | '+v+' |'),
    '', 'A different work key can reflect a missing translation merge; it is not automatically an error.',
    'Retirement notices, multiple original claims, absent catalog targets and publisher-site collisions remain separate.',
    'Every unresolved case retains its source hash, capture time, explicit credits and a hold disposition.',
    'All findings are read-only and require human interpretation of the publisher origin metadata.'
  ].join('\n')+'\n');
  console.log(JSON.stringify({revision:board.revision,count:pointers.size,
    classes:result.counts,dispositions:result.dispositions},null,2));
  return result;
}
if(require.main===module)try{run(path.resolve(process.argv[2]||'research-board/verification/audit-results/identity-provenance'));}
catch(e){console.error(e);process.exitCode=1;}
module.exports={traceRoot,sourcePointer,classify,run};
