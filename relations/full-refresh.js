"use strict";
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {refresh}=require('./refresh');
const {networkAvailable,waitForNetwork}=require('./network');
const {catalogIndex}=require('./build');
const {atomicJson}=require('./store');
const root=path.join(__dirname,'..');
const statusFile=path.join(__dirname,'.cache','full-refresh-status.json');
async function main(){
 const prior=fs.existsSync(statusFile)?JSON.parse(fs.readFileSync(statusFile,'utf8')):null;
 if(prior?.state==='running'){try{process.kill(prior.pid,0);throw new Error('A full refresh is already running');}catch(e){if(e.code!=='ESRCH')throw e;}}
 const {pages}=catalogIndex(path.join(root,'local-data'));
 const counts={};for(const p of pages.values())counts[p.branch]=(counts[p.branch]||0)+1;
 const excludeArg=process.argv.indexOf('--exclude-language');
 const excluded=new Set(excludeArg>=0?(process.argv[excludeArg+1]||'').split(','):[]);
 const languages=Object.keys(counts).filter(l=>!excluded.has(l)).sort((a,b)=>counts[b]-counts[a]);
 const status={state:'running',pid:process.pid,startedAt:new Date().toISOString(),targetPages:Object.entries(counts).filter(([l])=>!excluded.has(l)).reduce((sum,[,n])=>sum+n,0),excludedLanguages:[...excluded],scope:'catalog pages plus reviewed sources; semantic relations remain evidence-limited',branches:{}};
 for(const l of languages)status.branches[l]={state:'pending',catalogPages:counts[l]};
 const save=()=>{status.updatedAt=new Date().toISOString();atomicJson(statusFile,status);};save();
 let cursor=0;
 async function worker(){while(cursor<languages.length){const language=languages[cursor++];status.branches[language].state='running';save();try{
   let summary;
   for(let pass=0;pass<3;pass++){
     await waitForNetwork({notify:()=>{status.branches[language].state='waiting_for_network';save();}});
     status.branches[language].state='running';status.branches[language].pass=pass+1;save();
     summary=await refresh({language,maxPages:0,maxSeconds:86400,concurrency:1,ageDays:365});
     if(summary.stopped || summary.attempted>=summary.selected || summary.results.robots_denied)break;
     const offline=!await networkAvailable();
     if(!offline && !(summary.results.timeout || summary.results.fetch_or_parse_error || summary.results.http_error))break;
     // A disconnected run may open the circuit breaker. Reuse successful records
     // and select the remainder again after connectivity returns.
   }
   status.branches[language]={...status.branches[language],state:summary.stopped?'interrupted':'finished_pass',...summary};
 }catch(e){status.branches[language]={...status.branches[language],state:'failed',error:e.message};}save();}}
 await Promise.all(Array.from({length:4},worker));
 status.state='building';save();
 for(const script of ['build.js','validate.js','preview.js']){
  const result=spawnSync(process.execPath,['--max-old-space-size=8192',path.join(__dirname,script)],{cwd:root,stdio:'inherit',windowsHide:true});
  if(result.status!==0)throw new Error(script+' failed');
 }
 const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'output','manifest.json'),'utf8'));
 status.state='finished_pass';status.finishedAt=new Date().toISOString();status.counts=manifest.counts;
 status.note='A finished pass is not full coverage: inspect robots skips, failures, unfetched counts and semantic coverage.';save();
}
if(require.main===module)main().catch(e=>{console.error(e.stack);const status=fs.existsSync(statusFile)?JSON.parse(fs.readFileSync(statusFile,'utf8')):{};if(status.pid===process.pid)atomicJson(statusFile,{...status,state:'failed',error:e.message,updatedAt:new Date().toISOString()});process.exitCode=1;});
