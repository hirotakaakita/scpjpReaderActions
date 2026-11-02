"use strict";
const axios=require('axios');
async function networkAvailable(){
 for(const host of ['scp-wiki.wikidot.com','scp-jp.wikidot.com']){
  try {await axios.get(`https://${host}/robots.txt`,{timeout:8000,maxRedirects:2,validateStatus:()=>true,headers:{'User-Agent':'SCPReaderRelations/1.0'}});return true;}catch{}
 }
 return false;
}
async function waitForNetwork({probe=networkAvailable,sleep=ms=>new Promise(r=>setTimeout(r,ms)),notify=()=>{},now=Date.now,maxWaitMs=86400000}={}){
 const start=now();
 while(!await probe()){
  if(now()-start>=maxWaitMs)throw new Error('Network recovery wait expired');
  notify();await sleep(30000);
 }
}
module.exports={networkAvailable,waitForNetwork};
