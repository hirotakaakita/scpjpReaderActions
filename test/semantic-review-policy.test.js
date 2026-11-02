const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const{selectReview,firstPass,POLICY}=require('../relations/survey-review-policy');const{reconcile,splitDocument,validateResult}=require('../relations/survey-assessment');
const{makeRecord}=require('../relations/core'),{saveSource,readSourceState}=require('../relations/survey-source'),{atomicJson}=require('../relations/store'),{VERSION,resultFile,exportResults}=require('../relations/survey-runner');
const url='https://scp-wiki.wikidot.com/scp-079';
const claim=(type='co_appearance')=>({type,subject:{label:'SCP-079',url,kind:'scp'},target:{label:'SCP-682',url:'https://scp-wiki.wikidot.com/scp-682',kind:'scp'},polarity:'asserted',temporal:'past',certainty:'explicit',canon:null,evidence:['SCP-079 attacked SCP-682 in the chamber.'],note:'',evidence_mode:'event_record',event_status:'occurred'});
const answer=(relations=[])=>({unitId:'u',coverage:'complete',relations,notes:''});
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'scp-review-policy-'));t.after(()=>{assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});});const body='<div id="page-title">SCP-079</div><div id="page-content">SCP-079 attacked <a href="/scp-682">SCP-682</a> in the chamber.</div>',record=makeRecord(url,body),doc=saveSource(dir,url,body,'html',record),state=readSourceState(dir,url),u=splitDocument(doc,state.documentKey)[0];u.unitId='v'+VERSION+':'+u.unitId;return{dir,u};}
test('clean routine claims and empty results need only one pass unless sampled',()=>{const u={url,totalParts:1};assert.equal(selectReview(u,answer([claim()]),{samplePercent:0}).required,false);assert.equal(selectReview(u,answer(),{samplePercent:0}).required,false);assert.equal(selectReview(u,answer(),{samplePercent:100}).required,true);});
test('important, ambiguous, invalid and long-context claims are selected for review',()=>{const u={url,totalParts:1};for(const r of [answer([claim('hostile_to')]),{...answer(),coverage:'needs_context'},{...answer(),invalidRelations:[{error:'bad evidence'}]},answer([{...claim(),certainty:'uncertain'}])])assert(selectReview(u,r,{samplePercent:0}).required);assert(selectReview({...u,totalParts:2},answer(),{samplePercent:0}).required);});
test('quality sample is deterministic by page and close to five percent',()=>{let sampled=0;for(let i=0;i<1000;i++){const u={url:'https://scp-wiki.wikidot.com/scp-'+i,totalParts:1};const a=selectReview(u,answer());assert.equal(a.required,selectReview({...u,unitId:'different-part'},answer()).required);if(a.required)sampled++;}assert(sampled>=30&&sampled<=80);});
test('single-pass candidates are counted as surveyed but never as independent agreements',t=>{const{dir,u}=fixture(t),a={...answer([claim()]),unitId:u.unitId};validateResult({results:[a]},[u]);const selected=selectReview(u,a,{samplePercent:0}),r=firstPass(u,a,{sessionId:'primary'},selected);r.assessmentVersion=VERSION;r.stage='initial';atomicJson(resultFile(dir,u),r);const s=exportResults(dir,{pages:[url]});assert.equal(s.pagesFirstAssessed,1);assert.equal(s.pagesDoubleAssessed,0);assert.equal(s.accepted,0);assert.equal(s.candidates,1);assert.equal(s.reviewPendingUnits,0);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'export/summary.json'))).reviewPolicy,POLICY);});
test('required reviews retain first-pass progress and replace rather than duplicate candidates',t=>{const{dir,u}=fixture(t),a={...answer([claim('hostile_to')]),unitId:u.unitId},r=firstPass(u,a,{sessionId:'primary'},selectReview(u,a,{samplePercent:0}));r.assessmentVersion=VERSION;r.stage='initial';atomicJson(resultFile(dir,u),r);let s=exportResults(dir,{pages:[url]});assert.equal(s.reviewPendingUnits,1);assert.equal(s.pagesFirstAssessed,1);assert.equal(s.accepted,0);const reviewed=reconcile(u,a,a,{primarySession:'primary',reviewerSession:'reviewer'});reviewed.assessmentVersion=VERSION;reviewed.stage='initial';reviewed.reviewStatus='completed';atomicJson(resultFile(dir,u),reviewed);s=exportResults(dir,{pages:[url]});assert.equal(s.reviewPendingUnits,0);assert.equal(s.candidates,0);assert.equal(s.accepted,1);assert.equal(s.pagesFirstAssessed,1);assert.equal(s.pagesDoubleAssessed,1);});

test('runner completes primary work before selectively reviewing only the flagged page',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'scp-policy-run-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const docs=[];let n=20;
 while(docs.length<2){const page='https://scp-wiki.wikidot.com/scp-'+n++,label='SCP-'+(n-1),text=label+(docs.length?' attacked ':' talked to ')+'SCP-682 in the chamber.';
  const body='<div id="page-title">'+label+'</div><div id="page-content">'+text.replace('SCP-682','<a href="/scp-682">SCP-682</a>')+'</div>',record=makeRecord(page,body),doc=saveSource(dir,page,body,'html',record),state=readSourceState(dir,page),u=splitDocument(doc,state.documentKey)[0];
  const r={...claim(docs.length?'hostile_to':'co_appearance'),subject:{label,url:page,kind:'scp'},evidence:[text]};
  if(!docs.length&&selectReview(u,answer([r])).required)continue;
  docs.push({page,doc,r});
 }
 atomicJson(path.join(dir,'scope.json'),{scope:'test',pages:docs.map(x=>x.page)});
 const calls=[],cache=new Map();let serial=0;
 const assess=async(units,phase)=>{const sessions={};const results=units.map(u=>{const key=phase+u.unitId;let c=cache.get(key);if(!c){const d=docs.find(d=>d.page===u.url);c={result:{unitId:u.unitId,coverage:'complete',relations:[d.r],notes:''},session:phase+'-'+(++serial)};cache.set(key,c);calls.push({phase,url:u.url});}sessions[u.unitId]=c.session;return structuredClone(c.result);});validateResult({results},units);return{answer:{results},sessionId:Object.values(sessions).join(','),unitSessions:sessions};};
 const startFetcher=()=>{const e=new(require('node:events').EventEmitter)();e.pid=999999;e.kill=()=>{};setImmediate(()=>e.emit('close',0));return e;};
 const state=await require('../relations/survey-runner').run({dir,workers:1,assess,startFetcher});
 assert.equal(state.summary.pagesFirstAssessed,2);assert.equal(state.summary.pagesDoubleAssessed,1);assert.equal(state.summary.candidates,1);assert.equal(state.summary.accepted,1);assert.equal(state.summary.reviewPendingUnits,0);
 assert.equal(calls.filter(c=>c.phase==='primary').length,2);assert.equal(calls.filter(c=>c.phase==='review').length,1);assert.equal(calls.at(-1).url,docs[1].page);assert.equal(calls.at(-1).phase,'review');
});

test('empty but unresolved context cannot be reported as a finished investigation',async t=>{
 const{dir,u}=fixture(t);atomicJson(path.join(dir,'scope.json'),{scope:'test',pages:[u.url]});
 const assess=async(units,phase)=>({answer:{results:units.map(x=>({unitId:x.unitId,coverage:'needs_context',relations:[],notes:'Unknown referent'}))},sessionId:phase+'-session'});
 const startFetcher=()=>{const e=new(require('node:events').EventEmitter)();e.pid=999999;e.kill=()=>{};queueMicrotask(()=>e.emit('close',0));return e;};
 const state=await require('../relations/survey-runner').run({dir,workers:1,assess,startFetcher});assert.equal(state.summary.pagesFirstAssessed,1);assert.equal(state.summary.reviewPendingUnits,0);assert.equal(state.summary.pagesWithContextGaps,1);assert.equal(state.state,'finished_with_unresolved');
});

test('explicit non-important hypotheses are non-affirmative observations, not orphaned review tasks',()=>{
 const r={...claim('experiment'),polarity:'hypothetical',temporal:'proposed',event_status:'proposed',evidence_mode:'proposal'},u={unitId:'u',url,totalParts:1,documentKey:'hash',start:0,end:10};
 const a=answer([r]),selection=selectReview(u,a,{samplePercent:0});assert.equal(selection.required,false);
 const result=firstPass(u,a,{sessionId:'primary'},selection);assert.equal(result.reviewStatus,'not_selected');assert.equal(result.accepted.length,0);assert.equal(result.candidates.length,0);assert.equal(result.disputed.length,0);assert.equal(result.observations.length,1);assert.equal(result.observations[0].status,'single_pass_non_affirmative_observation');
});
