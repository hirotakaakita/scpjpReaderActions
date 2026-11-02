"use strict";
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {schema,prompt,validateResult}=require('./survey-assessment');
const {readCache,writeCache}=require('./survey-model-cache');
async function invoke(units,phase,dir,{binary=process.env.SURVEY_CODEX_BIN||'codex',timeoutMs=900000}={}){
 const originalUnits=units,cached=new Map(units.map(u=>[u.unitId,readCache(dir,u,phase)]));
 units=units.filter(u=>!cached.get(u.unitId));
 if(!units.length)return fromCache(originalUnits,cached,phase);
 if(fs.existsSync(path.join(dir,'ai-disabled.json')))throw Error('AI calls are disabled by user preference');
 const run=path.join(dir,'model-runs',Date.now()+'-'+phase+'-'+Math.random().toString(16).slice(2));fs.mkdirSync(run,{recursive:true});
 const schemaFile=path.resolve(dir,'schema-'+require('./core').digest(JSON.stringify(schema))+'.json');if(!fs.existsSync(schemaFile))fs.writeFileSync(schemaFile,JSON.stringify(schema));
 const cwd=path.resolve(dir,'isolated');fs.mkdirSync(cwd,{recursive:true});
 const output=path.resolve(run,'result.json'),log=fs.createWriteStream(path.join(run,'events.jsonl')),errors=fs.createWriteStream(path.join(run,'stderr.log'));
 const input=prompt(units,phase);const promptSha256=require('./core').digest(input);fs.writeFileSync(path.join(run,'prompt.txt.gz'),require('zlib').gzipSync(input));if(input.length>900000)throw Error('Prompt exceeds bounded model packet; manual source review required');
 let sessionId=null,usage=null,pending='',toolUsed=false,usageLimited=false;
 const child=spawn(binary,['exec','--ephemeral','--ignore-user-config','--disable','shell_tool','--disable','unified_exec','--disable','multi_agent','--config','web_search="disabled"','--sandbox','read-only','--skip-git-repo-check','--cd',cwd,'--output-schema',schemaFile,'--output-last-message',output,'--json','-'],{cwd,windowsHide:true,stdio:['pipe','pipe','pipe']});
 const timer=setTimeout(()=>child.kill(),timeoutMs);
 child.stdout.pipe(log);child.stderr.pipe(errors);
 child.stdout.on('data',chunk=>{pending+=chunk.toString('utf8');let i;while((i=pending.indexOf('\n'))>=0){const line=pending.slice(0,i);pending=pending.slice(i+1);try{const e=JSON.parse(line);if((e.type==='error'||e.type==='turn.failed')&&/usage limit|rate.?limit|quota/i.test(e.message||e.error?.message||''))usageLimited=true;if(e.item?.type&&!['agent_message','reasoning'].includes(e.item.type)){toolUsed=true;child.kill();}if(e.type==='thread.started')sessionId=e.thread_id;if(e.type==='turn.completed')usage=e.usage;}catch{}}});
 try{await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Object.assign(Error('Model invocation failed ('+code+'); inspect '+run),{usageLimited})));child.stdin.on('error',()=>{});child.stdin.end(input,'utf8');});}
 finally{clearTimeout(timer);log.end();errors.end();}
 if(!sessionId||!fs.existsSync(output))throw Error('Model did not return a completed independent session');
 if(toolUsed)throw Error('Tool use detected in text-only assessment');
 const answer=JSON.parse(fs.readFileSync(output,'utf8'));try{validateResult(answer,units,{isolateInvalid:true});}catch(e){e.validation=true;throw e;}
 for(const unit of units){const result=answer.results.find(r=>r.unitId===unit.unitId),value={result,sessionId,usage,promptSha256,run:path.relative(dir,run)};writeCache(dir,unit,phase,value);cached.set(unit.unitId,value);}
 return fromCache(originalUnits,cached,phase);

}
function fromCache(units,cached,phase){
 const unitSessions={},unitRuns={},unitPrompts={};const answer={results:units.map(u=>{const c=cached.get(u.unitId);unitSessions[u.unitId]=c.sessionId;unitRuns[u.unitId]=c.run;unitPrompts[u.unitId]=c.promptSha256;return structuredClone(c.result);})};
 validateResult(answer,units,{isolateInvalid:true});return{answer,sessionId:[...new Set(Object.values(unitSessions))].join(','),unitSessions,unitRuns,unitPrompts,usage:null,phase,engine:'codex exec; source- and prompt-keyed cached independent sessions'};
}
module.exports={invoke,fromCache};
