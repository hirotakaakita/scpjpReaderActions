'use strict';
const fs=require('node:fs'),path=require('node:path'),z=require('node:zlib'),crypto=require('node:crypto');
const {LANGUAGES}=require('../languages');
const {normalize,fetchRecord}=require('../related-documents');
const {readState}=require('../catalog-indexes');
const {VERSION,repairStoredExcerpt,titleNeedsRepair,datePrefix}=require('../article-excerpts');
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
function read(file){return JSON.parse(file.endsWith('.gz')?z.gunzipSync(fs.readFileSync(file)):fs.readFileSync(file,'utf8'));}
function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',z.gzipSync(JSON.stringify(value),{level:9}));fs.renameSync(file+'.tmp',file);}
function collect(root,language,{force=false}={}){
 const targets=new Map(),active=new Set(),states=[],trusted=new Map(),ambiguous=new Set(),published=[];let inspected=0;
 function trust(row){
  const url=normalize(row.urlJP||row.urlEN||row.url)?.url,text=typeof row.descriptionExcerpt==='string'?row.descriptionExcerpt.trim():'';
  if(!url||!text||ambiguous.has(url)||/^[®:：;；]+$/u.test(text))return;const clean=repairStoredExcerpt(text);if(clean.needsFetch||clean.text!==text)return;
  const old=trusted.get(url);if(old&&old!==text&&!old.startsWith(text)&&!text.startsWith(old)){trusted.delete(url);ambiguous.add(url);return;}
  if(!old||text.length>old.length)trusted.set(url,text);
 }
 const pointer=path.join(root,'local-data/mobile-v3',language,'manifest.json');
 if(fs.existsSync(pointer)){const manifest=read(pointer);for(const row of read(path.join(path.dirname(pointer),manifest.fileName)).data){published.push(row);const page=normalize(row.urlJP||row.urlEN);if(page)active.add(page.url);trust(row);}}
 const primary=path.join(root,'local-data',language,'scp-data.json'),primaryRows=fs.existsSync(primary)?read(primary).data:[];
 // Include newly crawled native articles before merge-data writes local-data.
 // Their URL/text variants also need source observations and empty-body checks.
 for(const page of LANGUAGES[language].pages){
  const file=path.join(root,'partial-data',require('../partial-file').partialFileName(language,page.path));
  if(!fs.existsSync(file))continue;const incoming=read(file);
  if(!Array.isArray(incoming.data))throw Error('Invalid incoming native catalog: '+file);
  primaryRows.push(...incoming.data);
 }
 for(const row of primaryRows)if(row.isTranslatedJP!==false){const page=normalize(row.urlJP||row.urlEN);if(page)active.add(page.url);trust(row);}
 for(const stateFile of [path.join(root,'local-data/catalog-indexes',language+'.json.gz'),path.join(root,'partial-data/catalog-indexes',language+'.json.gz')]){
  if(!fs.existsSync(stateFile))continue;const state=readState(stateFile);states.push(state);
  const missing=new Map();for(const index of Object.values(state.indexes))for(const url of index.missing||[])missing.set(url,Math.max(missing.get(url)||0,Date.parse(index.at)||0));
  for(const index of Object.values(state.indexes))for(const member of index.members||[]){const record=state.records[member.url];
   if(state.attempts[member.url]?.status!=='unavailable'&&(!missing.has(member.url)||Date.parse(record?.checkedAt)>missing.get(member.url))&&!require('../catalog-indexes').isExcluded(member.url,record?.tags||[]))active.add(member.url);
  }
 }
 function add(row){
  const url=normalize(row.urlJP||row.urlEN||row.url)?.url;
  if(!url||normalize(url).language!==language)return;
  const before=String(row.descriptionExcerpt||'');
  const needsTitle=('titleJP'in row||'title'in row)&&titleNeedsRepair(row.titleJP??row.title);
  const empty=!before.trim()&&(row.descriptionStatus!=='no_prose'||row.descriptionVersion!==VERSION);
  const tiny=/^[®:：;；]+$/u.test(before)&&row.descriptionStatus!=='source_literal';
  const inspectLiteral=before&&row.descriptionVersion!==VERSION&&(datePrefix(before)||Array.from(before).length<20);
  inspected++;const repaired=repairStoredExcerpt(before);
  repaired.needsFetch ||= force||empty||needsTitle||tiny||!!inspectLiteral;
  if(!repaired.changed&&!repaired.needsFetch)return;
  // Old caches retain removed pages for provenance. Do not refetch those pages
  // unless they are published now or belong to the current incoming scope.
  if(repaired.needsFetch&&!active.has(url))return;
  if(repaired.needsFetch&&trusted.has(url)&&!force&&!needsTitle&&!inspectLiteral){repaired.text=trusted.get(url);repaired.needsFetch=false;repaired.method='matching_article';}
  const key=url+':'+hash(before);if(!targets.has(key))targets.set(key,{url,before,...repaired});
 }
 primaryRows.forEach(add);published.forEach(add);for(const state of states)Object.values(state.records).forEach(add);
 for(const dir of ['related-documents','related-documents-v2']){
  const file=path.join(root,'local-data',dir,'catalog.json.gz'),plain=file.slice(0,-3);
  if(fs.existsSync(file)||fs.existsSync(plain))for(const row of read(fs.existsSync(file)?file:plain).data)if(row.language===language)add(row);
 }
 return {inspected,published:published.length,uniqueTargets:new Set([...targets.values()].map(t=>t.url)).size,targets:[...targets.values()]};
}
function retryDelayMs(error,retry,now=Date.now()){
 const status=error.response?.status;
 if(![429,500,502,503,504].includes(status)&&!['ECONNRESET','ETIMEDOUT','ECONNABORTED','EAI_AGAIN'].includes(error.code))return 0;
 const value=error.response?.headers?.['retry-after'];
 const retryAfter=value==null?0:/^\d+(?:\.\d+)?$/.test(String(value))?Number(value)*1000:Math.max(0,Date.parse(value)-now)||0;
 return Math.min(60000,Math.max(5000*3**retry,retryAfter));
}
async function repair({root=path.resolve(__dirname,'..'),language,maxRequests=10000,intervalMs=500,request=fetchRecord,previousFile=null,force=false,now=new Date().toISOString(),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 if(!LANGUAGES[language]||!Number.isInteger(maxRequests)||maxRequests<0||intervalMs<0)throw Error('Invalid excerpt repair options');
 const file=path.join(root,'partial-data/excerpt-repairs',language+'.json.gz');
 const collected=collect(root,language,{force}),edits=[],failed=[],pending=[],fetched=new Map(),previous=new Map();let attempts=0,last=0;
 // Normal weekly crawling already refetches numbered SCPs. Reuse only captures
 // produced in this invocation, never an older persisted "clean" cache.
 if(force)for(const target of collected.targets){
  const capture=path.join(root,'partial-data/related-documents',hash(target.url)+'.json');
  if(!fs.existsSync(capture))continue;const fresh=read(capture);
  if(fresh.url===target.url&&fresh.descriptionVersion===VERSION&&fresh.descriptionExcerpt&&!repairStoredExcerpt(fresh.descriptionExcerpt).needsFetch)
   fetched.set(target.url,{text:fresh.descriptionExcerpt,title:fresh.title,sourceHash:fresh.contentSha256,freshCapture:true});
 }
 if(previousFile&&fs.existsSync(previousFile)){
  const prior=read(previousFile);if(prior.language!==language||prior.version>VERSION)throw Error('Invalid previous excerpt repairs');
  for(const edit of prior.edits){const clean=repairStoredExcerpt(edit.text);const observed=!force||['refetch','no_prose','unavailable'].includes(edit.method);if(observed&&!clean.needsFetch&&clean.text===edit.text)previous.set(edit.url+':'+hash(edit.before),edit);}
 }
 const report={language,version:VERSION,force,at:now,inspected:collected.inspected,published:collected.published,uniqueTargets:collected.uniqueTargets,targets:collected.targets.length,requests:0,freshCaptures:fetched.size,edits,failed,pending,unavailable:[]};
 for(const [index,target]of collected.targets.entries()){
  const resumed=previous.get(target.url+':'+hash(target.before));
  if(resumed){edits.push(resumed);if(resumed.method==='unavailable'&&!report.unavailable.includes(resumed.url))report.unavailable.push(resumed.url);continue;}
  let text=target.text,method=target.method||'remove_widget',sourceHash=null;
  if(target.needsFetch){
   method='refetch';
   if(!fetched.has(target.url)){
    if(attempts>=maxRequests){pending.push(target.url);continue;}
    let record=null,error;
    for(let retry=0;retry<3;retry++){
     const pause=Math.max(0,last+intervalMs-Date.now());if(pause)await new Promise(r=>setTimeout(r,pause));last=Date.now();attempts++;report.requests++;
     try{record=await request(target.url,null,{timeoutMs:20000*(retry+1)});error=null;break;}catch(e){error=e;if([404,410].includes(e.response?.status)||e.articleUnavailable===true){fetched.set(target.url,{unavailable:true,title:e.articleTitle,statusCode:e.response?.status||null,reason:e.message==='Unavailable article: not_found'?'not_found':'no_prose'});break;}
      const delay=retryDelayMs(e,retry);if(retry<2&&delay){console.warn(`[${language}] temporary fetch failure ${target.url}: ${e.response?.status||e.code}; retry in ${delay}ms`);await wait(delay);}
     }
    }
    if(fetched.get(target.url)?.unavailable){}
    else if(error)fetched.set(target.url,{error:error.message});
    else if(record?.url!==target.url||repairStoredExcerpt(record.descriptionExcerpt).needsFetch)fetched.set(target.url,{error:'Extraction still contains metadata'});
    else fetched.set(target.url,{text:record.descriptionExcerpt||'',title:record.title,sourceHash:record.contentSha256});
   }
   const result=fetched.get(target.url);
   if(result.error){failed.push({url:target.url,reason:result.error});continue;}
   if(result.unavailable){const missing=[404,410].includes(result.statusCode)||result.reason==='not_found';if(missing&&!report.unavailable.includes(target.url))report.unavailable.push(target.url);edits.push({url:target.url,before:target.before,text:'',method:missing?'unavailable':'no_prose',descriptionStatus:'no_prose',sourceHash:null,statusCode:result.statusCode,reason:result.reason,...(result.title?{title:result.title}:{})});continue;}
   text=result.text;sourceHash=result.sourceHash;
  }
  edits.push({url:target.url,before:target.before,text,method,sourceHash,refreshTitle:force,...(fetched.get(target.url)?.title?{title:fetched.get(target.url).title}:{}),...(!text?{descriptionStatus:'no_prose'}:text===target.before&&/^[®:：;；]+$/u.test(text)?{descriptionStatus:'source_literal'}:{})});
  if(index%100===0){write(file,report);console.log(`[${language}] excerpt repairs ${index+1}/${collected.targets.length}, requests=${report.requests}, failures=${failed.length}`);}
 }
 write(file,report);console.log(JSON.stringify({language,inspected:report.inspected,targets:report.targets,repaired:edits.length,requests:report.requests,failed:failed.length,pending:pending.length}));
 return report;
}
if(require.main===module)repair({language:process.argv[2],maxRequests:Number(process.env.EXCERPT_MAX_REQUESTS||10000),intervalMs:Number(process.env.CRAWL_REQUEST_INTERVAL_MS||500),previousFile:process.env.EXCERPT_PREVIOUS_REPAIRS||null,force:process.env.FORCE_REFRESH_ARTICLE_TEXT==='1'}).then(report=>{if(process.env.EXCERPT_REQUIRE_COMPLETE==='1'&&(report.failed.length||report.pending.length))process.exitCode=1;}).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={repair,collect,read,write,hash,retryDelayMs};
