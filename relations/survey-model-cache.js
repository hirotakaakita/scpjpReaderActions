"use strict";
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {digest}=require('./core'),{atomicJson}=require('./store'),{prompt}=require('./survey-assessment');
const fileFor=(dir,unit,phase)=>path.join(dir,'assessment-cache',digest(prompt([unit],phase))+'.json');
function readCache(dir,unit,phase){const file=fileFor(dir,unit,phase);return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;}
function writeCache(dir,unit,phase,value){atomicJson(fileFor(dir,unit,phase),value);}
function recoverCache(dir,version){
 const root=path.join(dir,'model-runs');if(!fs.existsSync(root))return 0;let count=0;
 for(const name of fs.readdirSync(root)){const phase=name.includes('-primary-')?'primary':name.includes('-review-')?'review':null;if(!phase)continue;
  const folder=path.join(root,name),resultFile=path.join(folder,'result.json'),promptFile=path.join(folder,'prompt.txt.gz'),eventsFile=path.join(folder,'events.jsonl');
  if(!fs.existsSync(resultFile)||!fs.existsSync(promptFile)||!fs.existsSync(eventsFile))continue;
  try{
   const input=zlib.gunzipSync(fs.readFileSync(promptFile)).toString('utf8'),prefix=prompt([],phase).slice(0,-2);if(!input.startsWith(prefix))continue;
   const units=JSON.parse(input.slice(prefix.length));if(!Array.isArray(units)||units.some(u=>!u.unitId.startsWith('v'+version+':')))continue;
   const events=fs.readFileSync(eventsFile,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
   if(!events.some(e=>e.type==='turn.completed')||events.some(e=>e.item?.type&&!['agent_message','reasoning'].includes(e.item.type)))continue;
   const sessionId=events.find(e=>e.type==='thread.started')?.thread_id;if(!sessionId)continue;
   const answer=JSON.parse(fs.readFileSync(resultFile,'utf8'));if(answer.results?.length!==units.length)continue;
   for(const unit of units){const results=answer.results.filter(r=>r.unitId===unit.unitId);if(results.length!==1||readCache(dir,unit,phase))continue;
    writeCache(dir,unit,phase,{result:results[0],sessionId,usage:events.find(e=>e.type==='turn.completed')?.usage,run:path.relative(dir,folder),promptSha256:digest(input)});count++;
   }
  }catch{}
 }return count;
}
module.exports={fileFor,readCache,writeCache,recoverCache};
