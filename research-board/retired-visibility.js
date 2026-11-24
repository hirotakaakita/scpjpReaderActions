'use strict';
// The official article catalog is not edited. A withdrawn article redirected
// to a publisher staff notice is excluded from research-board presentation at
// the PAGE level. An entire node is hidden only if every version is retired.
// A separately published ARC / VO / old: revision is NOT a retirement marker.
const {originalPage}=require('../origin-provenance');
const BRIGHT='https://scp-wiki.wikidot.com/bright-works-message';
const JP_NOTICE='ブライト関連作品に関するお知らせ';
const EN_NOTICE='Bright Works Message';
const retiredEnglishSlot=/^https:\/\/scp-wiki\.wikidot\.com\/scp-(?:\d+|001-[a-z0-9-]+)(?:-j)?$/;
function isRetiredArticle(record,state){
 if(!record?.url||state?.lastAttempt?.status==='not_found'||
    state?.lastAttempt?.status==='unavailable'||state?.lastAttempt?.status==='not_article')return false;
 if(record.url.startsWith('https://scp-jp.wikidot.com/')&&record.title===JP_NOTICE){
  const credits=(record.originalSources||[]).filter(x=>x.method==='credit_original_label');
  const targets=[...new Set(credits.map(x=>originalPage(x.url)?.url).filter(Boolean))];
  return credits.length>0&&targets.length===1&&targets[0]===BRIGHT;
 }
 // An SCP slot that currently serves the replacement staff announcement is a
 // withdrawn SCP, not the historical article indicated by its old slot URL.
 if(retiredEnglishSlot.test(record.url)&&record.title===EN_NOTICE)return true;
 return false;
}
function retiredVisibility(nodes,sources){
 const states=new Map();
 for(const state of sources.values())if(state?.record?.url)states.set(state.record.url,state);
 const pageUrls=[],nodeIds=[],evidence=[];
 for(const node of nodes){
  const versions=node[13]||[];
  const retired=versions.filter(v=>isRetiredArticle(states.get(v[1])?.record,states.get(v[1])));
  for(const v of retired){
   pageUrls.push(v[1]);
   evidence.push({pageUrl:v[1],nodeId:node[0],publisherTitle:states.get(v[1]).record.title});
  }
  if(versions.length>0&&retired.length===versions.length)nodeIds.push(node[0]);
 }
 const unique=[...new Set(pageUrls)].sort();
 if(unique.length!==pageUrls.length)throw Error('Duplicate retired page URL in work graph');
 return {pageUrls:unique,nodeIds:nodeIds.sort((a,b)=>a-b),evidence};
}
module.exports={isRetiredArticle,retiredVisibility,BRIGHT,JP_NOTICE,EN_NOTICE};
