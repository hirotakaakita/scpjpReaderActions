'use strict';
const fs=require('node:fs'),path=require('node:path');
const {normalize,fetchRecord,loadCache,saveCache}=require('../related-documents');
const {readState,writeState,eligibleRecord}=require('../catalog-indexes');

// Refresh original metadata, not a string-stripped version of an old excerpt.
// Fetch every requested page before writing any retained index/cache records.
async function refresh({root=path.resolve(__dirname,'..'),urls=[],request=fetchRecord}={}){
 const states=new Map(),targets=[];
 for(const input of new Set(urls)){
  const page=normalize(input);if(!page)throw Error('Unsupported article URL: '+input);
  const file=path.join(root,'local-data/catalog-indexes',page.language+'.json.gz');
  if(!states.has(page.language))states.set(page.language,{file,state:readState(file)});
  if(!states.get(page.language).state.records[page.url])throw Error('Article is not in the retained index: '+page.url);
  if(!targets.some(t=>t.url===page.url))targets.push(page);
 }
 if(!targets.length)throw Error('Provide existing article URLs');
 const observations=[];
 for(const page of targets){
  const record=await request(page.url);
  if(record.url!==page.url||!eligibleRecord(record)||!record.descriptionExcerpt?.trim())throw Error('Unusable refreshed article: '+page.url);
  observations.push(record);
 }
 const cacheDirectory=path.join(root,'local-data/related-document-cache');
 const cache=loadCache(cacheDirectory);let cacheChanged=false;
 for(const record of observations){
  const state=states.get(record.language).state;
  state.records[record.url]=record;
  state.attempts[record.url]={status:'success',at:record.checkedAt};
  if(cache.records.has(record.url)){
   cache.records.set(record.url,record);cache.attempts.set(record.url,{status:'success',at:record.checkedAt});cacheChanged=true;
  }
 }
 for(const {file,state}of states.values())writeState(file,state);
 if(cacheChanged)saveCache(cacheDirectory,cache.records,cache.attempts);
 const report=observations.map(r=>({url:r.url,descriptionExcerpt:r.descriptionExcerpt}));
 console.log(JSON.stringify({refreshed:report.length,articles:report}));return report;
}
if(require.main===module)refresh({urls:process.argv.slice(2).length?process.argv.slice(2):(process.env.DOCUMENT_REFRESH_URLS||'').split(/[\s,]+/).filter(Boolean)}).catch(error=>{console.error(error);process.exitCode=1;});
module.exports={refresh};
