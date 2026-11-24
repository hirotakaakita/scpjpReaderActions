'use strict';
const axios=require('axios');
const {originalPage}=require('./origin-provenance');
const ENDPOINT='https://api.crom.avn.sh/graphql';
// Same translationOf relation used by interwiki.scpwiki.com/interwiki.js.
async function lookupOriginals(urls){
 if(!urls.length||urls.length>25)throw Error('Invalid interwiki batch');
 const variables={},definitions=[],fields=[];
 urls.forEach((url,i)=>{variables['u'+i]=url.replace(/^https:/,'http:');definitions.push(`$u${i}: URL!`);
  fields.push(`p${i}: page(url:$u${i}) { url translationOf { url translationOf { url translationOf { url translationOf { url } } } } }`);});
 const query=`query Origins(${definitions.join(',')}) { ${fields.join(' ')} }`;
 const response=await axios.post(ENDPOINT,{query,variables},{timeout:30000,maxRedirects:0,maxContentLength:1024*1024,
  headers:{Accept:'application/json','User-Agent':'SCPReaderCatalog/1.0'}});
 if(response.data?.errors?.length||!response.data?.data)throw Error('Invalid interwiki response: '+JSON.stringify(response.data?.errors||[]));
 return urls.map((url,i)=>{try{return parseOriginal(url,response.data.data['p'+i]);}
  catch(e){return {queryUrl:url,status:'invalid_response',chain:[],terminal:false,validationError:e.message};}});
}
function parseOriginal(url,page){
 if(!originalPage(url))throw Error('Unsupported interwiki query URL');
 if(!page)return {queryUrl:url,status:'not_indexed',chain:[],terminal:false};
 if(originalPage(page.url)?.url!==originalPage(url)?.url)throw Error('Interwiki response URL mismatch');
 const chain=[],seen=new Set([originalPage(url)?.url]);let p=page.translationOf;
 while(p){const target=originalPage(p.url);
  if(!target)return {queryUrl:url,status:'unsupported_source',chain:[],unsupportedUrl:p.url,terminal:false};
  if(seen.has(target.url)){
   const pair=new Set([new URL(url).hostname,new URL(p.url).hostname]);
   if(!chain.length&&pair.size===2&&pair.has('scpfoundation.net')&&pair.has('scp-ru.wikidot.com'))
    return {queryUrl:url,status:'mirror_only',chain:[],terminal:true};
   throw Error('Invalid interwiki source chain');}
  seen.add(target.url);chain.push(target.url);
  if(!Object.hasOwn(p,'translationOf'))return {queryUrl:url,status:'depth_limit',chain,terminal:false};
  p=p.translationOf;
 }
 return {queryUrl:url,status:chain.length?'translation':'no_translation',chain,terminal:true};
}
module.exports={lookupOriginals,parseOriginal,ENDPOINT};
