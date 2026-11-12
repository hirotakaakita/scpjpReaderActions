'use strict';
const fs=require('node:fs'),path=require('node:path'),z=require('node:zlib'),crypto=require('node:crypto');
const {LANGUAGES}=require('../languages');
const {normalize,fetchRecord}=require('../related-documents');
const {readState}=require('../catalog-indexes');
const {VERSION,repairStoredExcerpt}=require('../article-excerpts');
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
function read(file){return JSON.parse(file.endsWith('.gz')?z.gunzipSync(fs.readFileSync(file)):fs.readFileSync(file,'utf8'));}
function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',z.gzipSync(JSON.stringify(value),{level:9}));fs.renameSync(file+'.tmp',file);}
function collect(root,language){
 const targets=new Map();let inspected=0;
 function add(row){
  const url=normalize(row.urlJP||row.urlEN||row.url)?.url;
  if(!url||normalize(url).language!==language||typeof row.descriptionExcerpt!=='string')return;
  inspected++;const repaired=repairStoredExcerpt(row.descriptionExcerpt);
  if(!repaired.changed&&!repaired.needsFetch)return;
  const key=url+':'+hash(row.descriptionExcerpt);if(!targets.has(key))targets.set(key,{url,before:row.descriptionExcerpt,...repaired});
 }
 const primary=path.join(root,'local-data',language,'scp-data.json');if(fs.existsSync(primary))read(primary).data.forEach(add);
 for(const stateFile of [path.join(root,'local-data/catalog-indexes',language+'.json.gz'),path.join(root,'partial-data/catalog-indexes',language+'.json.gz')]){
  if(fs.existsSync(stateFile))Object.values(readState(stateFile).records).forEach(add);
 }
 for(const dir of ['related-documents','related-documents-v2']){
  const file=path.join(root,'local-data',dir,'catalog.json.gz'),plain=file.slice(0,-3);
  if(fs.existsSync(file)||fs.existsSync(plain))for(const row of read(fs.existsSync(file)?file:plain).data)if(row.language===language)add(row);
 }
 return {inspected,targets:[...targets.values()]};
}
async function repair({root=path.resolve(__dirname,'..'),language,maxRequests=10000,intervalMs=500,request=fetchRecord,previousFile=null,now=new Date().toISOString()}={}){
 if(!LANGUAGES[language]||!Number.isInteger(maxRequests)||maxRequests<0||intervalMs<0)throw Error('Invalid excerpt repair options');
 const file=path.join(root,'partial-data/excerpt-repairs',language+'.json.gz');
 const collected=collect(root,language),edits=[],failed=[],pending=[],fetched=new Map(),previous=new Map();let attempts=0,last=0;
 if(previousFile&&fs.existsSync(previousFile)){
  const prior=read(previousFile);if(prior.language!==language||prior.version>VERSION)throw Error('Invalid previous excerpt repairs');
  for(const edit of prior.edits){const clean=repairStoredExcerpt(edit.text);if(!clean.needsFetch&&clean.text===edit.text)previous.set(edit.url+':'+hash(edit.before),edit);}
 }
 const report={language,version:VERSION,at:now,inspected:collected.inspected,targets:collected.targets.length,requests:0,edits,failed,pending};
 for(const [index,target]of collected.targets.entries()){
  const resumed=previous.get(target.url+':'+hash(target.before));
  if(resumed){edits.push(resumed);continue;}
  let text=target.text,method='remove_widget',sourceHash=null;
  if(target.needsFetch){
   method='refetch';
   if(!fetched.has(target.url)){
    if(attempts>=maxRequests){pending.push(target.url);continue;}
    let record=null,error;
    for(let retry=0;retry<3;retry++){
     const pause=Math.max(0,last+intervalMs-Date.now());if(pause)await new Promise(r=>setTimeout(r,pause));last=Date.now();attempts++;report.requests++;
     try{record=await request(target.url);error=null;break;}catch(e){error=e;if([404,410].includes(e.response?.status))break;}
    }
    if(error)fetched.set(target.url,{error:error.message});
    else if(record?.url!==target.url||repairStoredExcerpt(record.descriptionExcerpt).needsFetch)fetched.set(target.url,{error:'Extraction still contains metadata'});
    else fetched.set(target.url,{text:record.descriptionExcerpt||'',sourceHash:record.contentSha256});
   }
   const result=fetched.get(target.url);
   if(result.error){failed.push({url:target.url,reason:result.error});continue;}
   text=result.text;sourceHash=result.sourceHash;
  }
  edits.push({url:target.url,before:target.before,text,method,sourceHash});
  if(index%100===0){write(file,report);console.log(`[${language}] excerpt repairs ${index+1}/${collected.targets.length}, requests=${report.requests}, failures=${failed.length}`);}
 }
 write(file,report);console.log(JSON.stringify({language,inspected:report.inspected,targets:report.targets,repaired:edits.length,requests:report.requests,failed:failed.length,pending:pending.length}));
 return report;
}
if(require.main===module)repair({language:process.argv[2],maxRequests:Number(process.env.EXCERPT_MAX_REQUESTS||10000),intervalMs:Number(process.env.CRAWL_REQUEST_INTERVAL_MS||500),previousFile:process.env.EXCERPT_PREVIOUS_REPAIRS||null}).then(report=>{if(process.env.EXCERPT_REQUIRE_COMPLETE==='1'&&(report.failed.length||report.pending.length))process.exitCode=1;}).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={repair,collect,read,write,hash};
