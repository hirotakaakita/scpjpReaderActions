'use strict';
const crypto=require('node:crypto');
const plan=require('./reviewed-original-67.json');
const reviewedUrls=new Set(plan.rules.map(r=>r.source));
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const norm=value=>String(value||'').replace(/\s+/g,' ').trim();

// Exactly the HTML body algorithm used by the independent 2026-11-24 audit
// (deep-verify-original-150.js, commit 00d34701). The audit covered the first
// 200 substantive blocks. Never compare a different extraction to its hashes.
function auditBody(document){
 const main=document.querySelector('#page-content')?.cloneNode(true);
 if(!main)return null;
 for(const node of main.querySelectorAll('script,style,nav,.page-tags,.licensebox,.license-area,.interwiki-wrapper,.creditRate,.credit-box,.collapsible-block-folded'))node.remove();
 return main;
}
function bodySha256(document){
 const main=auditBody(document);
 if(!main)return null;
 const blocks=[...main.querySelectorAll('p,li,h2,h3,h4,blockquote,td')]
  .map(n=>norm(n.textContent)).filter(s=>s.length>35).slice(0,200);
 return blocks.length?sha(blocks.join('\n')):null;
}
function identitySha256(record){
 const authors=key=>Array.isArray(record[key])?[...new Set(record[key].map(a=>
  norm(a.id||a.url||a.name).toLowerCase()))].sort():null;
 return sha(JSON.stringify({version:1,title:norm(record.title),
  originalSources:Array.isArray(record.originalSources)?[...new Set(record.originalSources.map(s=>s.url))].sort():null,
  originalAuthors:authors('originalAuthors'),upstreamAuthors:authors('upstreamAuthors'),
  translators:authors('translators')}));
}
function captureEvidence(document,url,contentSha256){
 if(!reviewedUrls.has(url))return {};
 const imageRule=plan.rules.find(r=>r.source===url)?.imageEvidence;
 return {reviewedIdentityEvidence:{version:1,contentSha256,bodySha256:bodySha256(document),
  ...(imageRule?{imageUrls:[...new Set([...auditBody(document).querySelectorAll('img[src]')].map(i=>i.src))].sort()}: {})}};
}
function matchesReviewedEvidence(record,rule){
 if(record?.url!==rule.source)return false;
 // Legacy, byte-identical captures are still the exact independently reviewed
 // evidence. Changed HTML needs BOTH the audited body and identity metadata.
 if(!rule.imageEvidence&&record.contentSha256===rule.sourceSha256)return true;
 const e=record.reviewedIdentityEvidence;
 const bodyMatches=rule.imageEvidence?
  e?.bodySha256===null&&e.imageUrls?.length===1&&e.imageUrls[0]===rule.imageEvidence.url&&
   e.imageSha256===rule.imageEvidence.sha256:e?.bodySha256===rule.publisherBodySha256;
 return record.authorCreditVersion>=1&&e?.version===1&&e.contentSha256===record.contentSha256&&
  /^[a-f0-9]{64}$/.test(rule.identitySha256||'')&&
  bodyMatches&&identitySha256(record)===rule.identitySha256;
}
module.exports={bodySha256,identitySha256,captureEvidence,matchesReviewedEvidence};
