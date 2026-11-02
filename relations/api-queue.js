"use strict";
// Bounded public API reads with one shared start-rate limiter, not per-worker limits.
async function apiQueue(pages,{fetchPage,onResult=()=>{},shouldStop=()=>false,concurrency=3,intervalMs=500,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now}={}){
 let cursor=0,nextStart=0,gate=Promise.resolve(),delay=intervalMs,failures=0,halted=false;
 async function slot(page){
  const previous=gate;let release;gate=new Promise(r=>release=r);
  await previous;try{while(now()<nextStart)await sleep(nextStart-now());if(halted||shouldStop())return null;nextStart=now()+delay;return{request:fetchPage(page)};}finally{release();}
 }
 async function worker(){while(cursor<pages.length&&!halted&&!shouldStop()){
  const page=pages[cursor++];
  for(let attempt=0;attempt<3&&!halted&&!shouldStop();attempt++){
   const issued=await slot(page);if(!issued)return;
   const result=await issued.request;await onResult(page,result);
   if(result.status==='rate_limited'){
    if(attempt===2)halted=true;
    delay=Math.min(10000,Math.max(1000,delay*2));nextStart=Math.max(nextStart,now()+Math.max(30000,result.retryAfterMs||0));
    continue;
   }
   failures=['http_error','timeout','fetch_or_parse_error'].includes(result.status)?failures+1:0;
   if(failures>=3)halted=true;
   break;
  }
 }}
 await Promise.all(Array.from({length:concurrency},worker));return{halted,intervalMs:delay};
}
module.exports={apiQueue};
