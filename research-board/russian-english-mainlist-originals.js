'use strict';
// Frozen publisher review of a Russian original published under the English
// SCP-1138 number. The identical-number *native* Russian SCP-1138-RU is a
// different story; do not merge it with Book of Letters.
//
// Evidence: EN SCP-1138 publisher credit explicitly points to
// https://scpfoundation.net/scp-1138 (Книга писем / Book of Letters).
// Native https://scpfoundation.net/scp-1138-ru is Прямой эфир (Live Broadcast).
// Supplementary version membership was checked against the publisher body
// titles and saved capture hashes in the 2026-11-23 125,100-page audit.
// Do not infer *other* Russian original identities from matching numbers.
const {normalizePage}=require('./extract');
const {originalPage}=require('../origin-provenance');
const originalUrl='https://scpfoundation.net/scp-1138';
const nativeOtherUrl='https://scpfoundation.net/scp-1138-ru';
const enUrl='https://scp-wiki.wikidot.com/scp-1138';
const evidenceUrls=Object.freeze([
 originalUrl,enUrl,
 'https://scp-wiki-cn.wikidot.com/scp-1138',
 'https://scp-vn.wikidot.com/scp-1138',
 'https://scp-pt-br.wikidot.com/scp-1138',
 'https://fondationscp.wikidot.com/scp-1138',
 'https://lafundacionscp.wikidot.com/scp-1138',
 'https://scp-jp.wikidot.com/scp-1138',
 'https://scp-pl.wikidot.com/scp-1138',
 'https://scp-wiki-de.wikidot.com/scp-1138',
 'https://scpko.wikidot.com/scp-1138'
]);
const evidenceSet=new Set(evidenceUrls);
const marker='russian-book-of-letters-1138';
function isRussianBook1138(url){return evidenceSet.has(url);}
function markedIdentityKey(p){
 return p?.historicalOriginalReview===marker?
    'ru\0scp-series-ru\0scp-1138@book-of-letters-original':
    null;
}
function applyRussianBook1138(pages,sources,{strict=false}={}){
 const byUrl=new Map(pages.map(p=>[p.url,p]));
 const en=byUrl.get(enUrl),original=byUrl.get(originalUrl),
       other=byUrl.get(nativeOtherUrl);
 // No new catalog membership is fabricated by this correction.
 if(!en||!original||!other)return;
 const enRecord=sources?.get(en.id)?.record,originalRecord=sources?.get(original.id)?.record,
       otherRecord=sources?.get(other.id)?.record;
 if(!enRecord||!originalRecord||!otherRecord)return;
 const credits=(enRecord.originalSources||[]).filter(x=>x.method==='credit_original_label');
 const targets=[...new Set(credits.map(x=>originalPage(x.url)?.url).filter(Boolean))];
 if(credits.length!==1||targets.length!==1||targets[0]!==originalUrl||
    !/книга\s+писем/i.test(originalRecord.title||'')||
    !/прямой\s+эфир/i.test(otherRecord.title||''))
   throw Error('Unsafe RU Book of Letters vs Live Broadcast publisher evidence');
 const members=evidenceUrls.map(url=>byUrl.get(url)).filter(Boolean);
 if(strict&&members.length!==evidenceUrls.length)
   throw Error('Missing known Book of Letters catalog version');
 for(const p of members){
   // Never attach a page whose publisher explicitly credits another work.
   const record=sources.get(p.id)?.record;
   if(!record||!([0,8,9].includes(p.kindIndex))||
      p.kindIndex!==en.kindIndex)throw Error('Missing fetched SCP identity source '+p.url);
   const claims=(record.originalSources||[]).filter(x=>x.method==='credit_original_label');
   const urls=[...new Set(claims.map(x=>originalPage(x.url)?.url).filter(Boolean))];
   if(urls.length>1||claims.some(c=>!originalPage(c.url))||
      (urls.length===1&&!new Set([originalUrl,enUrl]).has(urls[0])))
     throw Error('Conflicting Book of Letters original credit '+p.url);
   p.branch='ru';p.pageType='scp-series-ru';
   p.historicalOriginalReview=marker;
   p.classificationBasis='publisher_reviewed_russian_english_mainlist';
 }
 // Different RU-native work must retain its own root, ledger key and URLs.
 if(other.historicalOriginalReview||other.slug!=='scp-1138-ru'||other.branch!=='ru')
   throw Error('Native Russian SCP-1138-RU identity would be overwritten');
}
module.exports={marker,originalUrl,nativeOtherUrl,enUrl,evidenceUrls,isRussianBook1138,markedIdentityKey,applyRussianBook1138};
