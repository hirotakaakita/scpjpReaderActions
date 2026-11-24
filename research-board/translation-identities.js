'use strict';
const {normalizePage}=require('./extract');
const {originalPage}=require('../origin-provenance');
const {publisherOriginTags}=require('../catalog-origin');
const {verifiedScpOriginal}=require('./explicit-scp-origin');
const {markedIdentityKey}=require('./russian-english-mainlist-originals');
const site=code=>code==='zh-tr'?'zh':code;
const native=p=>site(p.siteBranch)===p.branch||(p.siteBranch==='cs'&&p.branch==='sk');
const generic=/^(?:main|index|home|start|about|groups-of-interest|foundation-tales|canon-hub|series-archive|personnel-and-character-dossier|task-forces|secure-facilities-locations|goi-formats)(?:-[a-z]{2})?$/;
const userId=a=>a.id||/wikidot\.com\/user:info\/([^/?#]+)/i.exec(a.url||'')?.[1]?.toLowerCase();
const authorIds=r=>{
 const translators=new Set([...(r?.translators||[]),...(r?.assetAuthors||[])].map(userId));
 const users=r?.originalAuthors?.length?r.originalAuthors:r?.authors||[];
 return new Set(users.map(userId).filter(id=>id&&(!translators.has(id)||r?.originalAuthors?.some(a=>userId(a)===id))));
};
const consistentCredit=(p,r)=>{
 const raw=(r?.originalSources||[]).filter(x=>x.method==='credit_original_label');
 if(new Set(raw.map(x=>x.url)).size!==1)return false;
 const q=originalPage(raw[0]?.url);
 return q?.hostBranch===p.branch&&decodeURIComponent(new URL(q.url).pathname).slice(1)===p.slug;
};
const originEvidence=(p,r)=>explicitPublisherOrigin(p,r)||r?.catalogIdentity?.originBranch===p.branch&&
 ['publisher_origin_tag','official_index_section','publisher_default_origin','native_official_collection','explicit_original_credit','explicit_translation_metadata','catalog_page_type'].includes(r.catalogIdentity.basis);
const metadataOriginals=r=>(r?.catalogIdentity?.originalSources||[]).filter(s=>s.method==='interwiki_original_metadata');
const rawOriginalClaims=r=>{
 const credits=(r?.originalSources||[]).filter(s=>s.method==='credit_original_label');
 return credits.length?credits:metadataOriginals(r);
};
const explicitPublisherOrigin=(p,r)=>{
 if(!r)return false;
 const tags=publisherOriginTags(p.url,r);
 return tags.origins.length===1&&tags.origins[0]===p.branch&&!tags.conflicts.length&&!tags.unsupported.length;
};
function scpIdentityKey(p){
  const reviewed=markedIdentityKey(p);
  if(reviewed)return reviewed;
 const m=/^scp-(?:([a-z]{2,5})-)?(\d+)(.*)$/.exec(p.slug);
 let identifier=p.slug;
 if(m&&(!m[1]||m[1]===p.branch)){
   let suffix=m[3];
   if(suffix===`-${p.branch}`||suffix.startsWith(`-${p.branch}-`))suffix=suffix.slice(p.branch.length+1);
   identifier='scp-'+m[2]+suffix;
 }
 return p.branch+'\0'+p.pageType+'\0'+identifier;
}
function translationIdentities(pages,sources){
 const byId=new Map(pages.map(p=>[p.id,p])), originals=new Map(), versions=new Map(),candidates=[],review=[];
 for(const p of pages){const key=p.branch+'\0'+p.slug;if(!versions.has(key))versions.set(key,[]);versions.get(key).push(p);}
 const creditClaims=new Map(),ambiguousCredits=new Set();
 for(const p of pages){
   const r=sources.get(p.id)?.record,raw=rawOriginalClaims(r);
   if(new Set(raw.map(x=>x.url)).size!==1)continue;
   const url=originalPage(raw[0]?.url)?.url||raw[0]?.url;if(!url)continue;
   if(!creditClaims.has(url))creditClaims.set(url,new Map());const hosts=creditClaims.get(url);
   if(!hosts.has(p.siteBranch))hosts.set(p.siteBranch,new Set());hosts.get(p.siteBranch).add(p.slug);
   if(hosts.get(p.siteBranch).size>1)ambiguousCredits.add(url);
 }
 const identityCredits=r=>(r?.originalSources||[]).filter(x=>!ambiguousCredits.has(originalPage(x.url)?.url||x.url));
 const creditedGroups=new Map();
 for(const p of pages){
   const state=sources.get(p.id),r=state?.record;
   if(p.branch==='other'||!p.pageType?.startsWith('related-document-')||!r||['not_found','not_article','unavailable'].includes(state.lastAttempt?.status))continue;
   const all=rawOriginalClaims(r);
   if(new Set(all.map(x=>x.url)).size!==1)continue;
   const raw=all.filter(x=>!ambiguousCredits.has(originalPage(x.url)?.url||x.url));
   if(new Set(raw.map(x=>x.url)).size!==1)continue;
   const originals=[...new Set(raw.map(x=>originalPage(x.url)?.url).filter(Boolean))];
   if(originals.length!==1)continue;
   const key=p.branch+'\0'+originals[0];if(!creditedGroups.has(key))creditedGroups.set(key,[]);creditedGroups.get(key).push(p);
 }
 for(const group of creditedGroups.values()){
   group.sort((a,b)=>a.id.localeCompare(b.id,'en'));
   for(let i=1;i<group.length;i++){
     const p=group[i],q=group[0],r=sources.get(p.id).record;
     const bothCredits=[p,q].every(page=>rawOriginalClaims(sources.get(page.id).record).every(x=>x.method==='credit_original_label'));
     if(p.siteBranch!==q.siteBranch)candidates.push({source:p.id,target:q.id,type:'translation_assertion',proof:[p.url,q.url,'shared_original_credit',r.contentSha256,'',bothCredits?'shared_explicit_original_credit':'shared_verified_original_metadata',r.checkedAt]});
   }
 }
 // An SCP published under a number different from its unique, verified native
 // original must NOT be grouped with an unrelated native item of that number.
 // This is evidence-backed, unlike a matching slug or an ordinary hyperlink.
 const explicitNumberOverrides=new Map();
 for(const p of pages){
   const original=verifiedScpOriginal(p,byId,sources);
   if(!original||scpIdentityKey(original)===scpIdentityKey(p))continue;
   const r=sources.get(p.id).record;
   explicitNumberOverrides.set(p.id,original);
   candidates.push({source:p.id,target:original.id,type:'translation_assertion',creditChain:original.creditChain,
     proof:[p.url,original.url,'verified_original_article',r.contentSha256,'',
       original.creditChain?'explicit_transitive_scp_original_credit':'explicit_scp_original_credit',r.checkedAt]});
 }
 const scpGroups=new Map();
 for(const p of pages)if(!explicitNumberOverrides.has(p.id)&&[0,8,9].includes(p.kindIndex)&&p.branch!=='other'&&/^(?:scp-series(?:-[a-z-]+)?|joke-scps(?:-[a-z-]+)?|scp-(?:[a-z-]+-)?ex)$/.test(p.pageType||'')){
   // Full identifier, including proposal/variant suffixes, never number alone.
   const key=scpIdentityKey(p);
   if(!scpGroups.has(key))scpGroups.set(key,[]);scpGroups.get(key).push(p);
 }
 for(const group of scpGroups.values())if(group.length>1){
   group.sort((a,b)=>Number(native(b))-Number(native(a))||a.url.localeCompare(b.url));
   for(const p of group.slice(1))candidates.push({source:p.id,target:group[0].id,type:'translation_assertion',proof:[p.url,group[0].url,'full_scp_identifier','','','catalog_scp_identifier','']});
 }
 for(const p of pages)if(p.pageType&&p.branch!=='other'&&native(p)){
   const key=p.branch+'\0'+p.slug;if(!originals.has(key))originals.set(key,[]);originals.get(key).push(p);
 }
 for(const p of pages){
   const state=sources.get(p.id),r=state?.record;
   if(!r||['not_found','not_article','unavailable'].includes(state.lastAttempt?.status))continue;
   // Already recorded a stricter native-SCP proof above; emitting another
   // generic claim could attach the page to its reused catalog number.
   if(explicitNumberOverrides.has(p.id))continue;
   const creditTargets=[];
   if(new Set((r.originalSources||[]).filter(s=>s.method==='credit_original_label').map(s=>s.url)).size>1){review.push({url:p.url,reason:'conflicting_original_credits'});continue;}
   const credits=identityCredits(r);
   if(r.originalSources?.length&&!credits.length)review.push({url:p.url,reason:'non_unique_original_credit'});
   for(const proof of credits){
     const target=normalizePage(proof.url),q=target&&byId.get(target.id);
     if(q&&q.id!==p.id&&proof.method==='credit_original_label')creditTargets.push({source:p.id,target:q.id,type:'translation_assertion',proof:[r.url,proof.quote||'','original_credit',r.contentSha256,'','credit_original_label',r.checkedAt]});
   }
   if(new Set(creditTargets.map(e=>e.target)).size>1){review.push({url:p.url,reason:'conflicting_original_credits'});continue;}
   candidates.push(...creditTargets);
   if(credits.length)continue; // A work-specific explicit original overrides path conventions.
   const metadata=metadataOriginals(r).filter(x=>!ambiguousCredits.has(originalPage(x.url)?.url||x.url));
   if(!r.originalSources?.length&&metadata.length){
     const urls=[...new Set(metadata.map(x=>originalPage(x.url)?.url).filter(Boolean))];
     if(urls.length!==1){review.push({url:p.url,reason:'conflicting_interwiki_originals'});continue;}
     const target=normalizePage(urls[0]),q=target&&byId.get(target.id);
     if(q&&q.id!==p.id&&q.branch===p.branch)candidates.push({source:p.id,target:q.id,type:'translation_assertion',proof:[p.url,q.url,'verified_translation_original',r.contentSha256,'','interwiki_original_metadata',r.checkedAt]});
     continue; // An exact metadata pointer also overrides matching local paths.
   }
   if(!p.pageType||p.branch==='other'||native(p))continue;
   const possible=originals.get(p.branch+'\0'+p.slug)||[];
   if(!possible.length){
     // A missing native catalog page does not prevent two proven translated
     // versions from sharing one existing node. Require independent provenance
     // and a shared credited author, not just matching slugs.
     if(!p.pageType.startsWith('related-document-')||generic.test(p.slug)||!originEvidence(p,r))continue;
     const a=authorIds(r);
     const matches=(versions.get(p.branch+'\0'+p.slug)||[]).filter(q=>q.id!==p.id&&q.pageType?.startsWith('related-document-')&&q.siteBranch!==p.siteBranch)
       .filter(q=>{
         const state=sources.get(q.id),qr=state?.record;
         if(!qr||['not_found','not_article','unavailable'].includes(state.lastAttempt?.status)||
            (identityCredits(qr).length&&!consistentCredit(q,qr))||!originEvidence(q,qr))return false;
         const b=authorIds(qr),shared=[...b].some(id=>a.has(id));
         if(a.size&&b.size&&!shared){
           if(p.id<q.id)review.push({url:p.url,original:q.url,reason:'author_conflict'});
           return false;
         }
         const proven=shared||explicitPublisherOrigin(p,r)&&explicitPublisherOrigin(q,qr);
         if(!proven&&p.id<q.id)review.push({url:p.url,original:q.url,reason:'missing_translated_identity_evidence'});
         return proven;
       });
     for(const q of matches)if(p.id<q.id||identityCredits(sources.get(q.id).record).length){
       const shared=[...authorIds(sources.get(q.id).record)].some(id=>a.has(id));
       candidates.push({source:p.id,target:q.id,type:'translation_assertion',proof:[p.url,q.url,'translated_catalog_identity',r.contentSha256,'',shared?'translation_path_shared_author':'explicit_origin_and_translation_path',r.checkedAt]});
     }
     continue;
   }
   if(possible.length!==1){review.push({url:p.url,reason:'ambiguous_original'});continue;}
   const q=possible[0],qr=sources.get(q.id)?.record,meta=r.catalogIdentity;
   if(generic.test(p.slug)){review.push({url:p.url,original:q.url,reason:'generic_original_path'});continue;}
   const a=authorIds(r),b=authorIds(qr),shared=[...a].filter(id=>b.has(id));
   if(a.size&&b.size&&!shared.length){review.push({url:p.url,original:q.url,reason:'author_conflict'});continue;}
   const numberedPath=/^scp-(?:[a-z]{2,5}-)?\d+(?:-[\p{L}\p{N}_-]+)?$/u.test(p.slug);
   const originProof=originEvidence(p,r)||(numberedPath&&meta?.originBranch===p.branch&&meta.basis==='scp_identifier');
   const explicitOrigin=explicitPublisherOrigin(p,r);
   // A category is presentation metadata, not work identity. Explicit origin
   // and an exact original path still identify a work when local tags differ.
   // A slug alone, a title, or an unverified origin is never enough.
   if(!(originProof||numberedPath)||(!shared.length&&p.kindIndex===2&&!explicitOrigin&&!numberedPath)){
     review.push({url:p.url,original:q.url,reason:'missing_identity_evidence'});continue;
   }
   candidates.push({source:p.id,target:q.id,type:'translation_assertion',proof:[p.url,q.url,'original_catalog_identity',r.contentSha256,'',shared.length?'origin_path_and_author':numberedPath?'full_numbered_original_catalog_path':'origin_and_original_catalog_path',r.checkedAt]});
 }
 return {candidates,review};
}
module.exports={translationIdentities,native,scpIdentityKey,generic};
