'use strict';
// Only a unique publisher-explicit original article credit, pointing to a
// known catalog page natively hosted by its origin branch, can override a
// numbered SCP identity. Never use bare matching numbers or ordinary links.
const {normalizePage}=require('./extract');
const {originalPage}=require('../origin-provenance');
const {validOrigin}=require('../catalog-origin');
const numbered=/^scp-(?:[a-z]{2,5}-)?\d+(?:-[\p{L}\p{N}_-]+)?$/u;
const ordinary=p=>numbered.test(p?.slug||'')||p?.host==='scp-nd.wikidot.com'&&
  p.slug.startsWith('sv:')&&numbered.test(p.slug.slice(3));

function nativeBranch(page) {
  return (page.siteBranch==='zh-tr'?'zh':page.siteBranch)===page.branch||
    (page.siteBranch==='cs'&&page.branch==='sk');
}
function originalPath(page,pagesById,sources) {
  if(!page||![0,8,9].includes(page.kindIndex)||!page.pageType||!page.id)return null;
  // A known Nordic delivery namespace may follow an exact original credit;
  // draft/custom namespaces never establish an identity merely by number.
  if(!ordinary(page))return null;
  let current=page;const chain=[page],seen=new Set([page.id]);
  for(let depth=0;depth<32;depth++){
    const state=sources?.get(current.id),record=state?.record;
    if(!record||['unavailable','not_found','not_article'].includes(state?.lastAttempt?.status))return null;
    const claims=(record.originalSources||[]).filter(x=>x.method==='credit_original_label');
    const urls=[...new Set(claims.map(x=>originalPage(x.url)?.url).filter(Boolean))];
    if(!claims.length||urls.length!==1||claims.some(x=>!originalPage(x.url)))return null;
    const target=normalizePage(urls[0]),original=target&&pagesById.get(target.id);
    if(!original||seen.has(original.id)||!ordinary(original)||original.kindIndex!==page.kindIndex)return null;
    chain.push(original);seen.add(original.id);
    if(nativeBranch(original))return {original,chain};
    current=original;
  }
  return null;
}
function inheritTransitiveOrigins(pages,sources){
  const byId=new Map(pages.map(p=>[p.id,p]));
  for(const page of pages){
    const path=originalPath(page,byId,sources);
    if(!path||path.chain.length<3||nativeBranch(page)||page.siteBranch===path.original.siteBranch)continue;
    const inherited=new Set(path.chain.slice(1).flatMap(p=>[p.branch,p.siteBranch]));
    if(!inherited.has(page.branch))continue;
    const identifier=/^scp-(?:([a-z]{2,5})-)?\d+(?:-([a-z]{2,5})(?:-|$))?/.exec(page.slug);
    if([identifier?.[1],identifier?.[2]].map(validOrigin).filter(Boolean).some(b=>b!==path.original.branch))continue;
    page.branch=path.original.branch;page.pageType=path.original.pageType;
    page.classificationBasis='explicit_transitive_original_credit';
  }
}
function verifiedScpOriginal(page,pagesById,sources){
  const path=originalPath(page,pagesById,sources),original=path?.original;
  if(!original||original.siteBranch===page.siteBranch||original.branch!==page.branch||original.pageType!==page.pageType)return null;
  return path.chain.length>2?{...original,creditChain:path.chain.map(p=>p.url)}:original;
}
module.exports={nativeBranch,verifiedScpOriginal,originalPath,inheritTransitiveOrigins};
