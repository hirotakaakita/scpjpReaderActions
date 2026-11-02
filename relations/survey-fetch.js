"use strict";
const fs=require('node:fs'),path=require('node:path');
const {refresh}=require('./refresh');const {normalizePage}=require('./core');const {atomicJson}=require('./store');const {waitForNetwork}=require('./network');
async function main(){const dir=path.resolve(process.argv[2]),plan=JSON.parse(fs.readFileSync(path.join(dir,'scope.json'))),pages=new Map(plan.pages.map(u=>{const p=normalizePage(u);return[p.id,p];}));
 const statusFile=path.join(dir,'fetch-status.json');
 for(let pass=1;pass<=3;pass++){
  atomicJson(statusFile,{state:'waiting_for_network',pid:process.pid,pass,at:new Date().toISOString()});await waitForNetwork();
  atomicJson(statusFile,{state:'fetching',pid:process.pid,pass,at:new Date().toISOString()});
  const summary=await refresh({pagesOverride:pages,surveyDir:dir,skipReviewedSeeds:true,seeds:plan.pages.slice(0,9),maxPages:0,maxSeconds:86400,ageDays:365});
  atomicJson(statusFile,{state:pass===3?'finished_pass':'between_passes',pid:process.pid,pass,summary,at:new Date().toISOString()});
  if(summary.selected===0)break;
 }
 atomicJson(statusFile,{state:'finished_pass',pid:process.pid,at:new Date().toISOString()});
}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
