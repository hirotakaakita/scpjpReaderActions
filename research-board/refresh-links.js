'use strict';
// Exhaust catalog members, with serial requests and durable per-page checkpoints.
// Zero budgets mean no application-level limit.
const fs=require('node:fs'),path=require('node:path');
const {loadCatalogs}=require('./catalog');
const {readSources,importDirectory,merge,captureFailure}=require('./source-store');
const {normalizePage,digest,EXTRACTOR_VERSION,FTML_LINK_VERSION}=require('./extract');
const {fetchRecord,normalize:publisherPage}=require('../related-documents');
const {freshCapture}=require('./refresh-identities');
const success=status=>['success','not_modified'].includes(status);
const required=p=>p.branch==='ru'?FTML_LINK_VERSION:EXTRACTOR_VERSION;
const checked=s=>s?.record?.linkExtractionVersion>=6&&Array.isArray(s.record.links)&&
  !s.record.limitations?.includes('legacy_unchecked_links')&&success(s.lastAttempt?.status);
const transient=e=>[429,500,502,503,504].includes(e.response?.status)||
  ['ECONNRESET','ETIMEDOUT','ECONNABORTED','EAI_AGAIN'].includes(e.code);
function retryAfter(error,now=Date.now()){
  const value=error.response?.headers?.['retry-after'];if(value==null)return 0;
  const seconds=Number(value);
  return Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,Date.parse(value)-now)||0;
}
async function refresh({root=path.join(__dirname,'..'),language='all',maxRequests=0,maxDurationMs=0,
  intervalMs=1000,now=new Date().toISOString(),request,uncheckedOnly=false,
  checkpointAfterMs=0,maxAttempts=3,reportFile=null,sleep=ms=>new Promise(r=>setTimeout(r,ms)),
  clock=Date.now,shouldStop=()=>false}={}){
  if(!language||![maxRequests,maxDurationMs,checkpointAfterMs].every(n=>Number.isSafeInteger(n)&&n>=0)||
    !Number.isFinite(intervalMs)||intervalMs<0||!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>5)throw Error('Invalid refresh limits');
  const input=path.join(root,'local-data'),incoming=path.join(root,'partial-data/related-documents/research-board');
  const sources=readSources(path.join(input,'research-board-sources'));importDirectory(sources,incoming);
  const languages=language==='all'?null:new Set(language.split(',')),pages=new Map();
  for(const c of loadCatalogs(input))for(const row of c.data){
    const p=normalizePage(row.isTranslatedJP!==false&&row.urlJP?row.urlJP:row.urlEN);
    if(p&&(!languages||languages.has(publisherPage(p.url)?.language)))pages.set(p.id,p);
  }
  const cutoff=Date.parse(now)-28*86400000;
  const eligible=p=>{const s=sources.get(p.id),r=s?.record;
    return uncheckedOnly?!checked(s):!checked(s)||!(r?.linkExtractionVersion>=required(p))||Date.parse(r.checkedAt)<cutoff;};
  const queue=[...pages.values()].filter(eligible).sort((a,b)=>{
    const sa=sources.get(a.id),sb=sources.get(b.id);
    return Number(checked(sa))-Number(checked(sb))||
      (sa?.record?.checkedAt||'').localeCompare(sb?.record?.checkedAt||'')||a.id.localeCompare(b.id,'en');
  });
  const report={language,totalCatalogPages:pages.size,pendingBefore:queue.length,attempted:0,updated:0,
    failed:0,retries:0,deferred:0,remaining:queue.length,interrupted:false,stopReason:null,failures:[]};
  const pendingIds=new Set(queue.map(p=>p.id));
  let lastRequest=null,consecutivePublisherFailures=0;
  async function beforeRequest(){
    if(lastRequest!==null)await sleep(Math.max(0,intervalMs-(clock()-lastRequest)));
    lastRequest=clock();
  }
  const fetch=request|| (async url=>{
    const requestedAt=Date.now(),current=await fetchRecord(url,incoming,{beforeRequest,expandDescriptions:false});
    const p=normalizePage(url),file=path.join(incoming,digest(p.id)+'.json');
    if(!fs.existsSync(file))throw Error('Missing current body-link capture');
    const record=JSON.parse(fs.readFileSync(file)).record;
    if(!freshCapture(record,current,requestedAt))throw Error('Stale body-link capture');return record;
  });
  function flush(){
    report.remaining=pendingIds.size;
    if(reportFile){fs.mkdirSync(path.dirname(reportFile),{recursive:true});
      fs.writeFileSync(reportFile+'.tmp',JSON.stringify(report)+'\n');fs.renameSync(reportFile+'.tmp',reportFile);}
  }
  const started=clock();flush();
  for(const p of queue){
    if(shouldStop()||(maxRequests&&report.attempted>=maxRequests)||(maxDurationMs&&clock()-started>=maxDurationMs)||
      (checkpointAfterMs&&clock()-started>=checkpointAfterMs)){
      report.interrupted=true;report.stopReason=shouldStop()?'signal':checkpointAfterMs&&clock()-started>=checkpointAfterMs?'checkpoint':'budget';break;
    }
    const previous=sources.get(p.id)?.lastAttempt;
    if(previous&&!success(previous.status)&&Date.parse(previous.retryAfter)>clock()){
      report.deferred++;continue;
    }
    report.attempted++;let failure;
    for(let attempt=0;attempt<maxAttempts;attempt++){
      try{
        if(request)await beforeRequest();const record=await fetch(p.url);
        if(record?.pageId!==p.id||!(record.linkExtractionVersion>=required(p))||!Array.isArray(record.links))throw Error('Invalid current body-link capture');
        record.limitations=(record.limitations||[]).filter(x=>x!=='legacy_unchecked_links');
        const state={record,lastAttempt:{status:'success',at:record.checkedAt}};merge(sources,state);
        fs.mkdirSync(incoming,{recursive:true});const file=path.join(incoming,digest(p.id)+'.json');
        fs.writeFileSync(file+'.tmp',JSON.stringify(state));fs.renameSync(file+'.tmp',file);
        if(!eligible(p))pendingIds.delete(p.id);
        report.updated++;consecutivePublisherFailures=0;failure=null;break;
      }catch(error){
        failure=error;if(!transient(error)||attempt===maxAttempts-1)break;
        report.retries++;await sleep(Math.max(retryAfter(error,clock()),(error.response?.status===429?60000:10000)*2**attempt));
      }
    }
    if(failure){
      const status=[404,410].includes(failure.response?.status)||failure.articleUnavailable?'unavailable':'fetch_error';
      captureFailure(p.url,status,incoming);
      const file=path.join(incoming,digest(p.id)+'.json'),state=JSON.parse(fs.readFileSync(file));
      state.lastAttempt.retryAfter=new Date(clock()+Math.max(retryAfter(failure,clock()),status==='unavailable'?7*86400000:3600000)).toISOString();
      fs.writeFileSync(file+'.tmp',JSON.stringify(state));fs.renameSync(file+'.tmp',file);merge(sources,state);
      report.failed++;report.failures.push({url:p.url,status,httpStatus:failure.response?.status||null,retryAfter:state.lastAttempt.retryAfter});
      console.warn(`Body-link refresh failed: ${p.url}: ${failure.message}`);
      if(failure.response?.status===429){report.interrupted=true;report.stopReason='rate_limited';flush();break;}
      if([401,403,500,502,503,504].includes(failure.response?.status)||transient(failure))consecutivePublisherFailures++;
      else consecutivePublisherFailures=0;
      if(consecutivePublisherFailures>=5){report.interrupted=true;report.stopReason='publisher_unavailable';flush();break;}
    }
    flush();if(report.attempted%25===0)console.log(JSON.stringify({...report,failures:undefined}));
  }
  flush();console.log(JSON.stringify({...report,failures:undefined}));return report;
}
if(require.main===module){
  let stopped=false;process.on('SIGTERM',()=>{stopped=true;});process.on('SIGINT',()=>{stopped=true;});
  const runnerDeadline=Number(process.env.BOARD_LINK_RUNNER_DEADLINE_MS||0);
  refresh({language:process.argv[2]||'all',maxRequests:Number(process.env.BOARD_LINK_MAX_REQUESTS||0),
    maxDurationMs:Number(process.env.BOARD_LINK_MAX_DURATION_MS||0),intervalMs:Number(process.env.CRAWL_REQUEST_INTERVAL_MS||1000),
    uncheckedOnly:process.env.BOARD_LINK_UNCHECKED_ONLY==='1',checkpointAfterMs:Number(process.env.BOARD_LINK_CHECKPOINT_AFTER_MS||(runnerDeadline?Math.max(1,runnerDeadline-Date.now()):0)),
    reportFile:process.env.BOARD_LINK_REPORT_FILE?path.resolve(process.env.BOARD_LINK_REPORT_FILE):null,shouldStop:()=>stopped})
    .catch(error=>{console.error(error);process.exitCode=1;});
}
module.exports={refresh,checked,retryAfter};
