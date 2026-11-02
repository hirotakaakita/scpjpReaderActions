"use strict";
const {norm,relationKey}=require('./survey-assessment');
function positions(text,label){const lower=text.toLowerCase(),needle=norm(label).toLowerCase(),out=[];if(!needle)return out;let i=0;while((i=lower.indexOf(needle,i))>=0){out.push(i);i+=Math.max(1,needle.length);}return out;}
function mergeSpans(spans){const result=[];for(const [a,b] of spans.sort((x,y)=>x[0]-y[0])){const last=result.at(-1);if(last&&a<=last[1])last[1]=Math.max(last[1],b);else result.push([a,b]);}return result;}
function createPlan(doc,key,partResults,version){
 const original=norm(doc.text),candidates=new Map();
 for(const r of partResults)for(const x of [...r.accepted,...(r.candidates||[]),...r.disputed])for(const claim of [x.relation,x.primary,x.reviewer].filter(Boolean)){const id=relationKey(claim,doc.url);if(!candidates.has(id))candidates.set(id,{...claim,evidence:[...claim.evidence]});else candidates.get(id).evidence=[...new Set([...candidates.get(id).evidence,...claim.evidence])];}
 const packets=[],gaps=[];
 if(original.length<=250000)packets.push({text:doc.text,contextCoverage:'complete_text',candidateRelations:[...candidates.values()],contextSpans:[[0,original.length]]});
 else{
  let pending=[],spans=[];
  const flush=()=>{if(!pending.length)return;const intervals=mergeSpans(spans);packets.push({text:intervals.map(([a,b])=>original.slice(a,b)).join('\n\n[SOURCE GAP — separate source spans]\n\n'),contextCoverage:'all_mentions_for_candidate_pairs',candidateRelations:pending,contextSpans:intervals});pending=[];spans=[];};
  for(const claim of candidates.values()){
   const a=positions(original,claim.subject.label),b=positions(original,claim.target.label),rare=a.length&&b.length?(a.length<=b.length?a:b):a.length?a:b;
   let next=[[0,Math.min(3000,original.length)],[Math.max(0,original.length-3000),original.length],...rare.map(i=>[Math.max(0,i-1300),Math.min(original.length,i+1700)])];
   for(const quote of claim.evidence){const q=norm(quote),i=original.indexOf(q);if(i>=0)next.push([Math.max(0,i-1300),Math.min(original.length,i+q.length+1700)]);}
   next=mergeSpans(next);const size=next.reduce((sum,[a,b])=>sum+b-a,0);
   if(size>180000){gaps.push({relation:claim,reason:'Too many source-wide mentions for bounded consolidation'});continue;}
   const combined=mergeSpans([...spans,...next]);if(pending.length&&(pending.length>=8||combined.reduce((n,[a,b])=>n+b-a,0)>180000))flush();
   pending.push(claim);spans.push(...next);
  }flush();
  if(!packets.length&&!candidates.size)packets.push({text:doc.text.slice(0,6000)+'\n\n[SOURCE GAP]\n\n'+doc.text.slice(-6000),contextCoverage:'all_parts_assessed_no_candidates',candidateRelations:[],contextSpans:[[0,Math.min(6000,original.length)],[Math.max(0,original.length-6000),original.length]]});
  else if(!packets.length)gaps.push({reason:'No bounded document-level assessment could be formed'});
 }
 const units=packets.map((p,i)=>({unitId:'v'+version+':'+key+':merge:p2:'+i,documentKey:key,stage:'consolidation',start:0,end:doc.text.length,text:p.text,url:doc.url,title:doc.title,tags:doc.tags,links:doc.links.filter(l=>l.label&&norm(p.text).toLowerCase().includes(norm(l.label).toLowerCase())),publisherMetadata:doc.publisherMetadata||[],sourceContentSha256:doc.contentSha256,sourceTextSha256:doc.textSha256,sourceLimitations:[...(doc.limitations||[]),...(p.contextCoverage==='complete_text'?[]:['source_wide_evidence_context_corpus'])],contextCoverage:p.contextCoverage,contextSpans:p.contextSpans,endpointHints:[...new Map(p.candidateRelations.map(r=>[JSON.stringify([r.subject,r.target]),{subject:r.subject,target:r.target}])).values()],part:i+1,totalParts:packets.length}));
 return {assessmentVersion:version,planVersion:2,documentKey:key,sourceUrl:doc.url,sourceContentSha256:doc.contentSha256,units,gaps};
}
function hydrate(unit,doc){Object.defineProperty(unit,'verificationText',{value:doc.text,enumerable:false});return unit;}
module.exports={positions,mergeSpans,createPlan,hydrate};
