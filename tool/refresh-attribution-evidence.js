'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const axios=require('axios'),{JSDOM,VirtualConsole}=require('jsdom');
const {readState,writeState}=require('../catalog-indexes');
const {fetchRecord}=require('../related-documents');
const {VERSION,extractDiscussionSources,validDiscussionUrl}=require('../origin-provenance');
async function refreshAttribution({root=path.join(__dirname,'..'),language=null,targets=null,maxRequests=40,maxDurationMs=120000,
 intervalMs=500,writeLocal=false,request=null,discussionRequest=async url=>(await axios.get(url,{timeout:20000,maxRedirects:0,maxContentLength:3*1024*1024})).data}={}){
 if(!Number.isInteger(maxRequests)||maxRequests<0||maxRequests>2000||maxDurationMs<=0||intervalMs<0)throw Error('Invalid attribution budget');
 if(!targets){const c=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root,'local-data/related-documents/catalog.json.gz'))));
  targets=c.data.filter(r=>r.pageType==='related-document-unclassified').map(r=>({url:r.url,site:r.language}));}
 const states=new Map(),files=new Map();
 for(const row of targets){const lang=row.site||row.language;if(language&&lang!==language||states.has(lang))continue;
  const local=path.join(root,'local-data/catalog-indexes',lang+'.json.gz'),partial=path.join(root,'partial-data/catalog-indexes',lang+'.json.gz');
  if(!fs.existsSync(local)&&!fs.existsSync(partial))continue;
  states.set(lang,readState(writeLocal&&fs.existsSync(local)?local:fs.existsSync(partial)?partial:local));files.set(lang,{local,partial});}
 const queue=targets.filter(row=>{const r=states.get(row.site||row.language)?.records[row.url];
  return r&&(!language||(row.site||row.language)===language)&&((r.originProvenanceVersion||0)<VERSION||
    (r.attributionDiscussionUrl&&!r.originalSources?.length&&!r.discussionAttributionVersion));});
 const dirty=new Map(),report={eligible:queue.length,requests:0,updated:0,originals:0,discussionPages:0,failures:[]};
 const started=Date.now();let nextStart=0;
 async function slot(){if(report.requests>=maxRequests||Date.now()-started>=maxDurationMs)return false;
  const at=Math.max(Date.now(),nextStart);nextStart=at+intervalMs;if(at>Date.now())await new Promise(r=>setTimeout(r,at-Date.now()));report.requests++;return true;}
 const rawDir=path.join(root,'partial-data/origin-evidence/attribution');fs.mkdirSync(rawDir,{recursive:true});
 request ||= url=>fetchRecord(url,null,{rawDirectory:rawDir});
 for(const row of queue){if(report.requests>=maxRequests||Date.now()-started>=maxDurationMs)break;const lang=row.site||row.language;
  try{const previous=states.get(lang).records[row.url];
   const needsPage=(previous.originProvenanceVersion||0)<VERSION;
   if(needsPage&&!await slot())break;
   const record=needsPage?await request(row.url):{...previous};
   if(record.url!==row.url||record.originProvenanceVersion!==VERSION)throw Error('Unexpected attribution article');
   const file=path.join(rawDir,crypto.createHash('sha256').update(row.url).digest('hex')+'.json');
   if(validDiscussionUrl(row.url,record.attributionDiscussionUrl)&&!record.originalSources?.length&&await slot()){
    try{const text=await discussionRequest(record.attributionDiscussionUrl);const dom=new JSDOM(text,{virtualConsole:new VirtualConsole()});
     try{const sources=extractDiscussionSources(dom.window.document,row.url,record.attributionDiscussionUrl);
      record.originalSources=sources.map(s=>({...s,attributionSha256:crypto.createHash('sha256').update(String(text)).digest('hex')}));
      record.discussionAttributionVersion=1;report.discussionPages++;
      fs.writeFileSync(file+'.discussion.html.gz',zlib.gzipSync(String(text)));
     }finally{dom.window.close();}
    }catch(e){report.failures.push({url:record.attributionDiscussionUrl,reason:e.message});}
   }
   if(previous.contentSha256===record.contentSha256&&previous.interwikiOrigin)record.interwikiOrigin=previous.interwikiOrigin;
   fs.writeFileSync(file,JSON.stringify(record));states.get(lang).records[row.url]={...record,links:[]};
   if(!dirty.has(lang))dirty.set(lang,new Set());dirty.get(lang).add(row.url);report.updated++;
   if(record.originalSources?.length)report.originals++;
  }catch(e){report.failures.push({url:row.url,reason:e.message});}}
 for(const [lang,urls]of dirty){const state=states.get(lang),f=files.get(lang);
  if(writeLocal){writeState(f.local,state);if(fs.existsSync(f.partial)){const partial=readState(f.partial);
   for(const url of urls)if(!partial.records[url]||Date.parse(partial.records[url].checkedAt)<=Date.parse(state.records[url].checkedAt))partial.records[url]=state.records[url];
   writeState(f.partial,partial);}}
  else writeState(f.partial,state);}
 console.log(JSON.stringify(report));return report;
}
if(require.main===module)refreshAttribution({language:process.argv[2]||null,maxRequests:Number(process.env.ATTRIBUTION_MAX_REQUESTS||40),maxDurationMs:Number(process.env.ATTRIBUTION_MAX_DURATION_MS||120000)}).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={refreshAttribution};
