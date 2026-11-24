'use strict';
const {normalizePage}=require('./extract');
const {originalPage}=require('../origin-provenance');
const {publisherOriginTags}=require('../catalog-origin');
const {generic}=require('./translation-identities');
const {verifiedScpOriginal}=require('./explicit-scp-origin');
function publisherTransitiveChainMatches(proof,sources,owners){
 const urls=proof.chain;
 if(!Array.isArray(urls)||urls.length<3||urls[0]!==proof.source||
  urls.at(-1)!==proof.target||new Set(urls).size!==urls.length||
  owners.get(proof.source)!==owners.get(proof.target))return false;
 for(let i=0;i<urls.length-1;i++){
  const page=normalizePage(urls[i]),record=page&&sources.get(page.id)?.record;
  const credits=(record?.originalSources||[]).filter(x=>x.method==='credit_original_label');
  const canonical=[...new Set(credits.map(x=>originalPage(x.url)?.url).filter(Boolean))];
  if(!credits.length||canonical.length!==1||canonical[0]!==urls[i+1]||
     credits.some(x=>!originalPage(x.url)))return false;
 }
 return true;
}
function validateIdentityProofs(board,sources){
 const owners=new Map(board.nodes.flatMap(n=>n[13].map(p=>[p[1],n])));
 const record=url=>sources.get(normalizePage(url)?.id)?.record;
 const pages=new Map(board.nodes.flatMap(n=>n[13].map(v=>{
  const p=normalizePage(v[1]);return [p.id,{...p,siteBranch:v[0],branch:n[8],pageType:n[12],kindIndex:n[3]}];
 })));
 const original=(url,metadata)=>{
  const r=record(url),credits=(r?.originalSources||[]).filter(x=>x.method==='credit_original_label');
  const raw=credits.length?credits:metadata?(r?.catalogIdentity?.originalSources||[]).filter(x=>x.method==='interwiki_original_metadata'):[];
  const urls=[...new Set(raw.map(x=>originalPage(x.url)?.url).filter(Boolean))];
  return urls.length===1?urls[0]:null;
 };
 for(const proof of board.workIdentityProofs||[]){
  if(proof.method==='explicit_transitive_scp_original_credit'){
   const source=normalizePage(proof.source),p=source&&pages.get(source.id);
   const original=verifiedScpOriginal(p,pages,sources);
   const originTraceValid=original?.creditChain&&original.url===proof.target&&
     JSON.stringify(original.creditChain)===JSON.stringify(proof.chain)&&
     owners.get(proof.source)===owners.get(proof.target);
   // When a separately audited multi-lingual cluster is joined to its actual
   // publisher original, a node's representative branch/pageType can change.
   // Reconstruct the *exact publisher credit chain* independently from that
   // presentation metadata, rather than invalidating a valid original credit.
   if(!originTraceValid&&!publisherTransitiveChainMatches(proof,sources,owners))
    throw Error('Unproven transitive original SCP credit '+proof.source+' -> '+proof.target);
  }
  if(['shared_explicit_original_credit','shared_verified_original_metadata'].includes(proof.method)){
   const metadata=proof.method==='shared_verified_original_metadata';
   const a=original(proof.source,metadata),b=original(proof.target,metadata);
   if(!a||a!==b)throw Error('Unproven shared original identity');
  }
  if(proof.method==='explicit_scp_original_credit'){
   const source=normalizePage(proof.source),target=normalizePage(proof.target);
   const r=source&&sources.get(source.id)?.record;
   const credits=(r?.originalSources||[]).filter(x=>x.method==='credit_original_label');
   const urls=[...new Set(credits.map(x=>originalPage(x.url)?.url).filter(Boolean))];
   const src=owners.get(proof.source),dst=owners.get(proof.target);
   if(!source||!target||credits.length===0||urls.length!==1||urls[0]!==target.url||
      credits.some(x=>!originalPage(x.url))||!src||!dst||src!==dst||
      ![0,8,9].includes(src[3])||src[3]!==dst[3]||
      proof.source===proof.target){
     throw Error('Unproven exact original SCP credit');
   }
  }
  if(proof.method==='interwiki_original_metadata'){
   const r=record(proof.source);
   if(r?.originalSources?.length||original(proof.source,true)!==originalPage(proof.target)?.url)throw Error('Unproven interwiki original identity');
  }
  if(proof.method==='explicit_origin_and_translation_path'){
   const a=normalizePage(proof.source),b=normalizePage(proof.target);
   // The representative catalog can remain unclassified even when these two
   // publisher pages have an explicit matching origin. Verify the evidence
   // itself, independently of the work's presentation classification.
   const sourceTags=publisherOriginTags(proof.source,record(proof.source));
   const origin=sourceTags.origins.length===1?sourceTags.origins[0]:null;
   if(!a||!b||a.slug!==b.slug||a.host===b.host||generic.test(a.slug)||!origin||origin==='other'||
      !owners.has(proof.source)||owners.get(proof.source)!==owners.get(proof.target))throw Error('Unproven translated path identity');
   for(const url of [proof.source,proof.target]){
    const tags=publisherOriginTags(url,record(url));
    if(tags.origins.length!==1||tags.origins[0]!==origin||tags.conflicts.length||tags.unsupported.length)throw Error('Unproven translated origin identity');
   }
  }
 }
}
module.exports={validateIdentityProofs};
