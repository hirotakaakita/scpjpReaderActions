"use strict";
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {normalizePage,digest}=require('./core'),{catalogIndex}=require('./build'),{lines}=require('./jsonl'),{atomicJson}=require('./store');
const {readDocument,readSourceState}=require('./survey-source'),{splitDocument,reconcile}=require('./survey-assessment'),{invoke}=require('./survey-model');
const {createPlan,hydrate}=require('./survey-consolidate');
const {POLICY,selectReview,firstPass}=require('./survey-review-policy');
const VERSION=4;
const mergeFile=(dir,key)=>path.join(dir,'plans',key+'.consolidation.json');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function scope(root,limit){
 const pages=new Map(catalogIndex(path.join(root,'local-data')).pages);
 const manifestFile=path.join(root,'relations/output/manifest.json');
 if(fs.existsSync(manifestFile)){const m=JSON.parse(fs.readFileSync(manifestFile));for(const l of lines(path.join(root,'relations/output',m.files.nodes.path))){const n=JSON.parse(l);if(n.kind==='page'){const p=normalizePage(n.url);if(p)pages.set(p.id,p);}}}
 const priority=['https://scp-wiki.wikidot.com/scp-079','https://scp-wiki.wikidot.com/scp-682','https://scp-wiki.wikidot.com/scp-105','https://scp-wiki.wikidot.com/follow-the-keter','https://scp-wiki.wikidot.com/calm','https://scp-wiki.wikidot.com/immediate-actions','https://scp-jp.wikidot.com/scp-682','https://scp-jp.wikidot.com/scp-079','https://scpfoundation.net/scp-682'];
 const urls=[...new Set([...priority,...[...pages.values()].map(p=>p.url)])];return{schemaVersion:1,createdAt:new Date().toISOString(),scope:'Frozen catalog plus currently known referenced pages; not an assertion that every wiki page exists in this scope',pages:limit?urls.slice(0,limit):urls};
}
function resultFile(dir,unit){return path.join(dir,'results',digest(unit.unitId)+'.json');}
function exportResults(dir,plan){
 const destination=path.join(dir,'export');fs.mkdirSync(destination,{recursive:true});
 const descriptors=Object.fromEntries(['accepted','candidates','observations','requires-review','units','pages'].map(k=>[k,fs.openSync(path.join(destination,k+'.jsonl.tmp'),'w')]));
 const counts={accepted:0,candidates:0,observations:0,requiresReview:0,units:0,unitsDoubleAssessed:0,pagesFirstAssessed:0,reviewPendingUnits:0,pagesDoubleAssessed:0,pagesWithContextGaps:0,sourcesUnavailable:0,pagesNotAssessed:0};
 const seen=new Set(),perPage=new Map(),allowed=new Set(plan.pages),expected=new Map(),baseParts=new Map(),merges=new Map();
 try{for(const name of fs.existsSync(path.join(dir,'results'))?fs.readdirSync(path.join(dir,'results')):[]){if(!name.endsWith('.json'))continue;const r=JSON.parse(fs.readFileSync(path.join(dir,'results',name)));if(r.assessmentVersion!==VERSION||!allowed.has(r.sourceUrl))continue;
   const current=readSourceState(dir,r.sourceUrl);if(current?.lastAttempt?.status!=='success'||current.documentKey!==r.documentKey)continue;
   if(!expected.has(r.documentKey)){const doc=readDocument(dir,current),initial=splitDocument(doc,r.documentKey),map=new Map(initial.map(u=>['v'+VERSION+':'+u.unitId,u]));baseParts.set(r.documentKey,initial.length);
    const planFile=mergeFile(dir,r.documentKey);let merge=null;
    if(fs.existsSync(planFile)){const candidate=JSON.parse(fs.readFileSync(planFile));if(candidate.assessmentVersion===VERSION&&candidate.planVersion===2&&candidate.documentKey===r.documentKey&&candidate.sourceContentSha256===current.contentSha256){merge=candidate;for(const u of merge.units)map.set(u.unitId,u);}}
    const mergeReady=merge&&merge.units.length&&!merge.gaps.length&&merge.units.every(u=>u.contextCoverage==='complete_text')&&merge.units.every(u=>{const f=resultFile(dir,u);if(!fs.existsSync(f))return false;const x=JSON.parse(fs.readFileSync(f));return x.assessmentVersion===VERSION&&x.documentKey===r.documentKey&&x.coverage==='double_assessed';});
    merges.set(r.documentKey,{ready:!!mergeReady,plan:merge});expected.set(r.documentKey,map);
   }
   const unit=expected.get(r.documentKey).get(r.unitId);if(!unit||unit.start!==r.start||unit.end!==r.end||unit.totalParts!==r.sourceParts||seen.has('unit:'+r.unitId))continue;seen.add('unit:'+r.unitId);

   const p=perPage.get(r.sourceUrl)||{url:r.sourceUrl,documentKey:r.documentKey,parts:baseParts.get(r.documentKey),assessedParts:0,reviewedParts:0,pendingReviews:0,contextGaps:0,consolidationReady:merges.get(r.documentKey)?.ready||false,accepted:0,requiresReview:0};const reviewed=!!r.review?.reviewerSession;if(reviewed)counts.unitsDoubleAssessed++;if(r.reviewStatus==='pending'){counts.reviewPendingUnits++;p.pendingReviews++;}if(r.stage!=='consolidation'){p.assessedParts++;if(reviewed)p.reviewedParts++;if(r.coverage==='needs_context')p.contextGaps++;}
   fs.writeFileSync(descriptors.units,JSON.stringify(r)+'\n');counts.units++;
   const multi=baseParts.get(r.documentKey)>1,mergeReady=merges.get(r.documentKey)?.ready;
   if(multi&&r.stage!=='consolidation'&&mergeReady){perPage.set(r.sourceUrl,p);continue;}
   for(const x of r.observations||[]){fs.writeFileSync(descriptors.observations,JSON.stringify(x)+'\n');counts.observations++;}
   for(const x of r.candidates||[]){const key='candidate:'+r.sourceUrl+'\0'+x.id;if(seen.has(key))continue;seen.add(key);fs.writeFileSync(descriptors.candidates,JSON.stringify(x)+'\n');counts.candidates++;}
   for(const x of r.accepted){if(multi&&!mergeReady){fs.writeFileSync(descriptors['requires-review'],JSON.stringify({...x,status:'requires_full_document_consolidation'})+'\n');counts.requiresReview++;p.requiresReview++;continue;}const key=r.sourceUrl+'\0'+x.id;if(seen.has(key))continue;seen.add(key);fs.writeFileSync(descriptors.accepted,JSON.stringify(x)+'\n');counts.accepted++;p.accepted++;}
   for(const x of r.disputed){fs.writeFileSync(descriptors['requires-review'],JSON.stringify(x)+'\n');counts.requiresReview++;p.requiresReview++;}
   perPage.set(r.sourceUrl,p);
  }
  for(const url of plan.pages){const p=perPage.get(url);if(p){const firstDone=p.assessedParts===p.parts;if(firstDone)counts.pagesFirstAssessed++;p.state=firstDone&&((p.parts===1&&!p.contextGaps&&p.reviewedParts===p.parts)||(p.parts>1&&p.consolidationReady))?'double_assessed':p.contextGaps||p.parts>1?'context_review_required':p.pendingReviews?'review_pending':'first_assessed';if(p.state==='double_assessed')counts.pagesDoubleAssessed++;else if(p.state==='context_review_required')counts.pagesWithContextGaps++;fs.writeFileSync(descriptors.pages,JSON.stringify(p)+'\n');}else{const source=readSourceState(dir,url),unavailable=source?.lastAttempt?.status&&source.lastAttempt.status!=='success';if(unavailable)counts.sourcesUnavailable++;else counts.pagesNotAssessed++;fs.writeFileSync(descriptors.pages,JSON.stringify({url,state:unavailable?'source_unavailable':'not_assessed'})+'\n');}}
 }finally{for(const fd of Object.values(descriptors))fs.closeSync(fd);}
 for(const key of Object.keys(descriptors))fs.renameSync(path.join(destination,key+'.jsonl.tmp'),path.join(destination,key+'.jsonl'));
 atomicJson(path.join(destination,'summary.json'),{generatedAt:new Date().toISOString(),assessmentVersion:VERSION,targetPages:plan.pages.length,...counts,reviewPolicy:POLICY,qualitySamplePercent:5,method:'Primary assessment of every source; independent review of ambiguous/important claims and deterministic 5% quality sample. Single-pass candidates are not independently reviewed agreements.',scope:plan.scope});return counts;
}
async function run({dir,limit=0,maxBatches=0,workers=2,assess=invoke,startFetcher=spawn}={}){
 if(!Number.isInteger(workers)||workers<1||workers>2||!Number.isInteger(limit)||limit<0||!Number.isInteger(maxBatches)||maxBatches<0)throw Error('Invalid survey limits');
 const root=path.join(__dirname,'..');dir=path.resolve(dir||path.join(__dirname,'.cache/semantic-survey'));
 fs.mkdirSync(dir,{recursive:true});if(fs.existsSync(path.join(dir,'ai-disabled.json')))throw Error('AI survey is disabled by user preference; run relations/noai-survey.js instead');fs.mkdirSync(path.join(dir,'results'),{recursive:true});
 const priorFile=path.join(dir,'status.json');if(fs.existsSync(priorFile)){const old=JSON.parse(fs.readFileSync(priorFile));if(['running','paused_model'].includes(old.state)){try{process.kill(old.pid,0);throw Error('Survey already running');}catch(e){if(e.code!=='ESRCH')throw e;}}}
 const planFile=path.join(dir,'scope.json'),plan=fs.existsSync(planFile)?JSON.parse(fs.readFileSync(planFile)):scope(root,limit);if(!fs.existsSync(planFile))atomicJson(planFile,plan);
 const allowed=new Set(plan.pages),priority=new Map(plan.pages.map((u,i)=>[u,i]));
 const priorCooldown=fs.existsSync(priorFile)?Date.parse(JSON.parse(fs.readFileSync(priorFile)).nextModelRetryAt)||0:0;
 const state={state:'running',pid:process.pid,startedAt:new Date().toISOString(),targetPages:plan.pages.length,reviewPolicy:POLICY,method:'primary-first source assessment; selective independent review plus 5% quality sample',sourcesReady:0,sourcesFailed:0,unitsDoubleAssessed:0,accepted:0,requiresReview:0,batches:0,modelErrors:0,logs:'model-runs/',runLog:process.env.SURVEY_RUN_LOG||'run-v4.log',unavailableSourcesAreNotNoRelationship:true};
 state.recoveredAssessments=require('./survey-model-cache').recoverCache(dir,VERSION);
 const baseline=exportResults(dir,plan);state.unitsFirstAssessed=baseline.units;state.unitsDoubleAssessed=baseline.unitsDoubleAssessed;state.accepted=baseline.accepted;state.requiresReview=baseline.requiresReview;
 const save=()=>atomicJson(priorFile,{...state,updatedAt:new Date().toISOString()});save();
 const fetchLog=fs.openSync(path.join(dir,'fetch.log'),'a'),fetchErrors=fs.openSync(path.join(dir,'fetch-error.log'),'a');
 const heartbeat=setInterval(()=>{const sources=path.join(dir,'sources');state.sourceStatesRecorded=fs.existsSync(sources)?fs.readdirSync(sources).filter(n=>n.endsWith('.json')).length:0;save();},15000);
 const fetch=startFetcher(process.execPath,[path.join(__dirname,'survey-fetch.js'),dir],{cwd:root,windowsHide:true,stdio:['ignore',fetchLog,fetchErrors]});state.fetchPid=fetch.pid;
 let fetchDone=false;fetch.once('close',code=>{fetchDone=true;state.fetchExitCode=code;save();});fetch.once('error',e=>{fetchDone=true;state.fetchError=e.message;save();});
 const leased=new Set(),finished=new Map(),errors=new Map(),singletons=new Set(),pendingReviews=new Map();let modelPausedUntil=Math.max(0,priorCooldown),totalErrors=0,stopping=false,lastExport=0;
 const stop=()=>{stopping=true;fetch.kill();};process.once('SIGINT',stop);
 function pick(){
  const sourceDir=path.join(dir,'sources');if(!fs.existsSync(sourceDir))return[];
  const sources=[];let bad=0;for(const name of fs.readdirSync(sourceDir)){if(!name.endsWith('.json'))continue;const s=JSON.parse(fs.readFileSync(path.join(sourceDir,name)));if(!allowed.has(s.url))continue;if(!s.document||s.lastAttempt?.status!=='success'){bad++;continue;}sources.push(s);}
  state.sourcesReady=sources.length;state.sourcesFailed=bad;sources.sort((a,b)=>(priority.get(a.url)||0)-(priority.get(b.url)||0));
  const batch=[];let chars=0,packetChars=6000;
  for(const s of sources){if(finished.get(s.url)===s.documentKey)continue;
   const doc=readDocument(dir,s),units=splitDocument(doc,s.documentKey);let pending=false,needsReview=false;
   for(const u of units){u.unitId='v'+VERSION+':'+u.unitId;const file=resultFile(dir,u);if(fs.existsSync(file)){const old=JSON.parse(fs.readFileSync(file));if(old.assessmentVersion===VERSION){if(old.reviewStatus==='pending'){needsReview=true;pendingReviews.set(u.unitId,{unitId:u.unitId,url:u.url,documentKey:u.documentKey});}continue;}}
    pending=true;if(leased.has(u.unitId)||(errors.get(u.unitId)||0)>=3)continue;
    if(batch.length&&(chars+u.text.length>100000||packetChars+JSON.stringify(u).length>700000||batch.length>=6||singletons.has(u.unitId)))return batch;
    if(JSON.stringify(u).length>700000){errors.set(u.unitId,3);atomicJson(path.join(dir,'assessment-errors',digest(u.unitId)+'.json'),{unitId:u.unitId,sourceUrl:u.url,status:'requires_manual_review',reason:'source packet too large'});continue;}
    leased.add(u.unitId);batch.push(u);chars+=u.text.length;packetChars+=JSON.stringify(u).length;if(chars>=100000||batch.length>=6||singletons.has(u.unitId))return batch;
   }
   if(!pending&&!needsReview&&units.length>1){
    const planFile=mergeFile(dir,s.documentKey);let consolidation=fs.existsSync(planFile)?JSON.parse(fs.readFileSync(planFile)):null;
    if(!consolidation||consolidation.assessmentVersion!==VERSION||consolidation.planVersion!==2){const parts=units.map(u=>JSON.parse(fs.readFileSync(resultFile(dir,u))));consolidation=createPlan(doc,s.documentKey,parts,VERSION);atomicJson(planFile,consolidation);}
    for(const raw of consolidation.units){const u=hydrate(raw,doc),file=resultFile(dir,u);if(fs.existsSync(file)){const old=JSON.parse(fs.readFileSync(file));if(old.assessmentVersion===VERSION){if(old.reviewStatus==='pending'){needsReview=true;pendingReviews.set(u.unitId,{unitId:u.unitId,url:u.url,documentKey:u.documentKey});}continue;}}pending=true;if(leased.has(u.unitId)||(errors.get(u.unitId)||0)>=3)continue;
     const bytes=JSON.stringify(u).length;if(bytes>700000){errors.set(u.unitId,3);atomicJson(path.join(dir,'assessment-errors',digest(u.unitId)+'.json'),{unitId:u.unitId,status:'requires_manual_review',reason:'consolidation packet too large'});continue;}
     if(batch.length&&(packetChars+bytes>700000||chars+u.text.length>100000||batch.length>=6))return batch;
     leased.add(u.unitId);batch.push(u);chars+=u.text.length;packetChars+=bytes;if(chars>=100000||batch.length>=6)return batch;
    }
   }
   if(!pending)finished.set(s.url,s.documentKey);
  }
  if(!batch.length){for(const meta of pendingReviews.values()){
   if(leased.has(meta.unitId)||(errors.get(meta.unitId)||0)>=3)continue;
   const source=readSourceState(dir,meta.url);if(source?.lastAttempt?.status!=='success'||source.documentKey!==meta.documentKey){pendingReviews.delete(meta.unitId);finished.delete(meta.url);continue;}
   const doc=readDocument(dir,source);let u;
   if(meta.unitId.includes(':merge:')){const plan=JSON.parse(fs.readFileSync(mergeFile(dir,source.documentKey)));const raw=plan.units.find(x=>x.unitId===meta.unitId);if(raw)u=hydrate(raw,doc);}
   else{u=splitDocument(doc,source.documentKey).map(x=>({...x,unitId:'v'+VERSION+':'+x.unitId})).find(x=>x.unitId===meta.unitId);}
   if(!u){pendingReviews.delete(meta.unitId);continue;}
   const bytes=JSON.stringify(u).length;if(batch.length&&(packetChars+bytes>700000||chars+u.text.length>100000||batch.length>=6))break;
   Object.defineProperty(u,'surveyTask',{value:'review',enumerable:false});leased.add(u.unitId);batch.push(u);chars+=u.text.length;packetChars+=bytes;
  }}
  return batch;
 }
 async function worker(){while(!stopping){
   if(maxBatches&&state.batches>=maxBatches)return;
   if(Date.now()<modelPausedUntil){state.state='paused_model';state.nextModelRetryAt=new Date(modelPausedUntil).toISOString();save();await pause(Math.min(15000,Math.max(1,modelPausedUntil-Date.now())));continue;}
   state.state='running';delete state.nextModelRetryAt;const batch=pick();save();
   if(!batch.length){if(fetchDone)return;await pause(5000);continue;}
   try{
    const primary=await assess(batch,'primary',dir);
    const a=new Map(primary.answer.results.map(r=>[r.unitId,r]));
    if(batch[0].surveyTask!=='review'){
     for(const u of batch){const result=firstPass(u,a.get(u.unitId),primary);result.assessmentVersion=VERSION;result.stage=u.stage||'initial';result.contextCoverage=u.contextCoverage||'source_part';atomicJson(resultFile(dir,u),result);state.unitsFirstAssessed++;state.requiresReview+=result.disputed.length;}
    }else{
     const reviewer=await assess(batch,'review',dir);const b=new Map(reviewer.answer.results.map(r=>[r.unitId,r]));
     for(const u of batch){const result=reconcile(u,a.get(u.unitId),b.get(u.unitId),{mode:'independent_review',primarySession:primary.unitSessions?.[u.unitId]||primary.sessionId,reviewerSession:reviewer.unitSessions?.[u.unitId]||reviewer.sessionId,primaryRun:primary.unitRuns?.[u.unitId]||primary.run,reviewerRun:reviewer.unitRuns?.[u.unitId]||reviewer.run,usage:[primary.usage,reviewer.usage],promptHashes:[primary.unitPrompts?.[u.unitId]||primary.promptSha256,reviewer.unitPrompts?.[u.unitId]||reviewer.promptSha256]});result.assessmentVersion=VERSION;result.stage=u.stage||'initial';result.contextCoverage=u.contextCoverage||'source_part';result.reviewSelection=selectReview(u,a.get(u.unitId));result.reviewStatus='completed';pendingReviews.delete(u.unitId);finished.delete(u.url);atomicJson(resultFile(dir,u),result);state.unitsDoubleAssessed++;state.accepted+=result.accepted.length;state.requiresReview+=result.disputed.length;}
    }
    state.batches++;totalErrors=0;if(Date.now()-lastExport>300000){exportResults(dir,plan);lastExport=Date.now();}console.log(JSON.stringify({at:new Date().toISOString(),batch:state.batches,sourcesReady:state.sourcesReady,unitsFirstAssessed:state.unitsFirstAssessed,unitsDoubleAssessed:state.unitsDoubleAssessed,accepted:state.accepted,requiresReview:state.requiresReview}));
   }catch(e){state.modelErrors++;state.lastModelError=e.message;for(const u of batch){singletons.add(u.unitId);if(e.validation&&batch.length===1)errors.set(u.unitId,(errors.get(u.unitId)||0)+1);atomicJson(path.join(dir,'assessment-errors',digest(u.unitId)+'.json'),{unitId:u.unitId,sourceUrl:u.url,documentKey:u.documentKey,attempts:errors.get(u.unitId),error:e.message,at:new Date().toISOString()});}if(!e.validation||++totalErrors>=3){modelPausedUntil=Math.max(modelPausedUntil,Date.now()+(e.usageLimited?1800000:!e.validation?60000:900000));totalErrors=0;}}
   finally{for(const u of batch)leased.delete(u.unitId);save();}
  }}
 try{await Promise.all(Array.from({length:workers},worker));
  if(maxBatches&&!fetchDone){fetch.kill();await pause(1000);}
  state.summary=exportResults(dir,plan);state.state=stopping?'interrupted':maxBatches?'checkpoint':state.summary.pagesFirstAssessed===plan.pages.length&&!state.summary.reviewPendingUnits&&!state.summary.requiresReview&&!state.summary.pagesWithContextGaps?'finished_pass':'finished_with_unresolved';state.finishedAt=new Date().toISOString();save();
 }finally{stopping=true;if(!fetchDone)fetch.kill();clearInterval(heartbeat);process.removeListener('SIGINT',stop);fs.closeSync(fetchLog);fs.closeSync(fetchErrors);}
 return state;
}
if(require.main===module){const args=process.argv.slice(2),value=k=>args.includes(k)?args[args.indexOf(k)+1]:undefined;run({dir:value('--dir'),limit:Number(value('--scope-limit')||0),maxBatches:Number(value('--max-batches')||0),workers:Number(value('--workers')||2)}).catch(e=>{const dir=path.resolve(value('--dir')||path.join(__dirname,'.cache/semantic-survey')),file=path.join(dir,'status.json');if(fs.existsSync(file)){const s=JSON.parse(fs.readFileSync(file));if(s.pid===process.pid)atomicJson(file,{...s,state:'failed',error:e.message,updatedAt:new Date().toISOString()});}console.error(e.stack);process.exitCode=1;});}
module.exports={VERSION,scope,resultFile,exportResults,run};
