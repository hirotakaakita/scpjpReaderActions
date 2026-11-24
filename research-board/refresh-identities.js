'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {readSources,importDirectory,merge,captureFailure}=require('./source-store');
const {normalizePage,digest}=require('./extract');
const {native}=require('./translation-identities');
const {fetchRecord}=require('../related-documents');
function selectTargets(board){
 const byPath=new Map(),targets=new Map();
 for(const n of board.nodes)for(const p of n[13]){const key=n[8]+'\0'+p[2];if(!byPath.has(key))byPath.set(key,[]);byPath.get(key).push({n,p});}
 let candidateNodes=0;
 for(const n of board.nodes){
  if(n[8]==='other'||new Set(n[13].map(p=>p[0])).size!==1||n[13].some(p=>native({branch:n[8],siteBranch:p[0]})))continue;
  const other=(byPath.get(n[8]+'\0'+n[13][0][2])||[]).filter(x=>x.n!==n);
  if(!other.length)continue;candidateNodes++;
  for(const p of [...n[13],...other.map(x=>x.p)])targets.set(p[1],normalizePage(p[1]));
 }
 return {candidateNodes,pages:[...targets.values()].filter(Boolean).sort((a,b)=>a.url.localeCompare(b.url,'en'))};
}
async function refresh({root=path.join(__dirname,'..'),language=null,maxRequests=5000,maxDurationMs=1800000,intervalMs=500,concurrency=6,request,retryFailures=false,force=false}={}){
 if(!Number.isInteger(maxRequests)||maxRequests<0||maxRequests>10000||maxDurationMs<=0||intervalMs<0||!Number.isInteger(concurrency)||concurrency<1||concurrency>8)throw Error('Invalid identity refresh limits');
 const input=path.join(root,'local-data'),dir=path.join(input,'mobile-v3/research-board'),manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
 if(!/^board-[a-f0-9]{64}\.json\.gz$/.test(manifest.fileName))throw Error('Invalid board pointer');
 const bytes=fs.readFileSync(path.join(dir,manifest.fileName));if(digest(bytes)!==manifest.sha256)throw Error('Board checksum mismatch');
 const board=JSON.parse(zlib.gunzipSync(bytes)),selected=selectTargets(board);
 const incoming=path.join(root,'partial-data/related-documents/research-board'),sources=readSources(path.join(input,'research-board-sources'));importDirectory(sources,incoming);
 const retry=Date.now()-86400000,stale=Date.now()-28*86400000;
 const pages=selected.pages.filter(p=>{
  if(language&&p.branch!==language)return false;
  const state=sources.get(p.id);return (force||!(state?.record?.identityMetadataVersion>=1)||Date.parse(state.record.checkedAt)<stale)&&
   (!state?.lastAttempt||['success','not_modified'].includes(state.lastAttempt.status)||Date.parse(state.lastAttempt.at)<retry||(retryFailures&&state.lastAttempt.status==='fetch_error'));
 });
 const queues=new Map();for(const p of pages){if(!queues.has(p.host))queues.set(p.host,[]);queues.get(p.host).push(p);}
 const active=new Set(),nextAt=new Map(),started=Date.now();let reserved=0;
 const report={revision:board.revision,candidateNodes:selected.candidateNodes,selectedPages:selected.pages.length,eligible:pages.length,attempted:0,updated:0,failures:[],complete:false};
 fs.mkdirSync(incoming,{recursive:true});
 const progress=path.join(root,'partial-data',`identity-refresh-${language||'all'}.json`);
 function flush(){fs.writeFileSync(progress+'.tmp',JSON.stringify(report));fs.renameSync(progress+'.tmp',progress);}
 const fetch=request||(async url=>{
   const requestedAt=Date.now(),current=await fetchRecord(url,incoming),p=normalizePage(url),file=path.join(incoming,digest(p.id)+'.json');
   const record=JSON.parse(fs.readFileSync(file)).record;
   if(!freshCapture(record,current,requestedAt))throw Error('Stale identity capture');return record;
 });
 async function worker(){while(Date.now()-started<maxDurationMs&&reserved<maxRequests){
  const host=[...queues.keys()].find(h=>queues.get(h).length&&!active.has(h));
  if(!host){if(![...queues.values()].some(q=>q.length))return;await new Promise(r=>setTimeout(r,50));continue;}
  active.add(host);const p=queues.get(host).shift();reserved++;
  try{
   const delay=(nextAt.get(host)||0)-Date.now();if(delay>0)await new Promise(r=>setTimeout(r,delay));nextAt.set(host,Date.now()+intervalMs);
   const record=await fetch(p.url);
   if(record?.pageId!==p.id||!(record.identityMetadataVersion>=1))throw Error('Missing current identity metadata');
   const state={record,lastAttempt:{status:'success',at:record.checkedAt}};merge(sources,state);
   const file=path.join(incoming,digest(p.id)+'.json');fs.writeFileSync(file+'.tmp',JSON.stringify(state));fs.renameSync(file+'.tmp',file);report.updated++;
  }catch(error){
   captureFailure(p.url,[404,410].includes(error.response?.status)||error.articleUnavailable?'unavailable':'fetch_error',incoming);
   report.failures.push({url:p.url,error:error.message});
  }finally{active.delete(host);report.attempted++;flush();if(report.attempted%25===0)console.log(JSON.stringify({attempted:report.attempted,eligible:report.eligible,updated:report.updated,failed:report.failures.length}));}
 }}
 await Promise.all(Array.from({length:concurrency},worker));report.complete=report.attempted===pages.length;flush();
 console.log(JSON.stringify({...report,failures:report.failures.length}));return report;
}
function freshCapture(record,current,requestedAt){
 // FTML catalog records hash the source string; research evidence hashes the
 // complete API response. They must not be compared as the same byte stream.
 return !!record&&record.url===current.url&&record.format===current.format&&Number.isFinite(Date.parse(record.checkedAt))&&
  Date.parse(record.checkedAt)>=requestedAt&&(current.format==='ftml'||record.contentSha256===current.contentSha256);
}
if(require.main===module)refresh({language:process.argv[2]||null,maxRequests:Number(process.env.IDENTITY_MAX_REQUESTS||5000),maxDurationMs:Number(process.env.IDENTITY_MAX_DURATION_MS||1800000),retryFailures:process.env.IDENTITY_RETRY_FAILURES==='1',force:process.env.IDENTITY_FORCE==='1'}).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={refresh,selectTargets,freshCapture};
