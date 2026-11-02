const{test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {makeRecord,normalizePage}=require('../relations/core');const {extractDocument,saveSource,hasSource,readSourceState,readDocument}=require('../relations/survey-source');
const {splitDocument,validateResult,reconcile,relationKey}=require('../relations/survey-assessment');const {refreshPage}=require('../relations/refresh');const {atomicJson,recordPath}=require('../relations/store');
const url='https://scp-wiki.wikidot.com/scp-079',html='<div id="page-title">SCP-079</div><div id="page-content"><p>SCP-079 talked to <a href="/scp-682">SCP-682</a> in the chamber.</p><div class="licensebox">False enemy SCP-173</div></div>';
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'scp-survey-'));t.after(()=>{assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});});return dir;}
function unit(){return{unitId:'u',documentKey:'hash',url,title:'SCP-079',text:'SCP-079 talked to SCP-682 in the chamber.',links:[{url:'https://scp-wiki.wikidot.com/scp-682',label:'SCP-682'}],totalParts:1,start:0,end:42};}
function relation(type='communicates_with'){return{type,subject:{label:'SCP-079',url,kind:'scp'},target:{label:'SCP-682',url:'https://scp-wiki.wikidot.com/scp-682',kind:'scp'},polarity:'asserted',temporal:'past',certainty:'explicit',canon:null,evidence:['SCP-079 talked to SCP-682 in the chamber.'],note:'',evidence_mode:'event_record',event_status:'occurred'};}
function answer(r=[relation()]){return{results:[{unitId:'u',coverage:'complete',relations:r,notes:''}]};}
test('source archive retains exact response plus excluded-navigation article text',t=>{const dir=temp(t),record=makeRecord(url,html),doc=saveSource(dir,url,html,'html',record),state=readSourceState(dir,url);assert(hasSource(dir,url,record));assert.deepEqual(readDocument(dir,state),doc);assert(!doc.text.includes('False enemy'));assert(doc.text.includes('talked to'));assert.equal(doc.links[0].url,'https://scp-wiki.wikidot.com/scp-682');assert(!hasSource(dir,url,{contentSha256:'changed'}));});
test('survey forces body retrieval when only a normal relation snapshot exists',async t=>{const dir=temp(t),record=makeRecord(url,html,'html',undefined,{etag:'old'});atomicJson(recordPath(dir,url),{record,lastAttempt:{status:'success',at:record.checkedAt}});let headers;const status=await refreshPage(normalizePage(url),dir,async(u,h)=>{headers=h;return{status:200,data:html,headers:{}};},undefined,{surveyDir:path.join(dir,'survey')});assert.equal(status,'success');assert.equal(headers['If-None-Match'],undefined);assert(hasSource(path.join(dir,'survey'),url,record));});
test('split sources cover every character with overlap and valid surrogate boundaries',()=>{const doc={url,title:'x',text:'A🦎B\n'.repeat(200),links:[]};const units=splitDocument(doc,'key',180,20);assert(units.length>1);assert.equal(units[0].start,0);assert.equal(units.at(-1).end,doc.text.length);for(let i=1;i<units.length;i++)assert(units[i].start<units[i-1].end);for(const u of units){assert.equal(u.text,doc.text.slice(u.start,u.end));assert(!/[\uD800-\uDBFF]$/.test(u.text));}});
test('only matching independent explicit claims can be agreed, and hostility keeps direction',()=>{const u=unit(),a=answer(),b=answer();validateResult(a,[u]);const result=reconcile(u,a.results[0],b.results[0],{primarySession:'one',reviewerSession:'two'});assert.equal(result.accepted.length,1);assert.equal(reconcile(u,a.results[0],answer([]).results[0],{primarySession:'a',reviewerSession:'b'}).accepted.length,0);const hypothetical=relation();hypothetical.polarity='hypothetical';assert.equal(reconcile(u,answer([hypothetical]).results[0],answer([hypothetical]).results[0],{primarySession:'a',reviewerSession:'b'}).accepted.length,0);const hostile=relation('hostile_to'),reverse={...hostile,subject:hostile.target,target:hostile.subject};assert.notEqual(relationKey(hostile,url),relationKey(reverse,url));});
test('invented evidence, guessed endpoints and missing units never count as surveyed',()=>{const u=unit();const invented=relation();invented.evidence=['They are bitter enemies.'];assert.throws(()=>validateResult(answer([invented]),[u]),/Evidence/);const guessed=relation();guessed.target={...guessed.target,url:'https://scp-jp.wikidot.com/scp-682'};assert.throws(()=>validateResult(answer([guessed]),[u]),/publisher link/);assert.throws(()=>validateResult({results:[]},[u]),/Missing/);const extra=relation();extra.subject.label='Foundation Director';assert.throws(()=>validateResult(answer([extra]),[u]),/label/);});

test('questions, cancelled attacks and anonymous identities cannot become agreed story facts',()=>{
 const {strongClaim}=require('../relations/survey-assessment');
 const question=relation('hostile_to');question.evidence_mode='question_presupposition';assert.equal(strongClaim(question),false);
 const cancelled=relation('hostile_to');cancelled.evidence_mode='order';cancelled.event_status='cancelled';assert.equal(strongClaim(cancelled),false);
 cancelled.type='ordered_termination_of';assert.equal(strongClaim(cancelled),true);
 const anonymous=relation();anonymous.subject={label:'Dr. █████',url:null,kind:'person'};assert.equal(strongClaim(anonymous),false);
 assert.throws(()=>reconcile(unit(),answer().results[0],answer().results[0],{primarySession:'same',reviewerSession:'same'}),/distinct/);
});
test('publisher canon breadcrumbs are retained and can be quoted without inferring from tags',t=>{
 const dir=temp(t),body='<div id="breadcrumbs"><a href="/canon-hub">Canon Hub</a> » <a href="/resurrection">Resurrection</a> » Calm</div>'+html;
 const record=makeRecord(url,body),doc=saveSource(dir,url,body,'html',record);assert.match(doc.publisherMetadata[0].text,/Resurrection/);
 const u=splitDocument(doc,'key')[0],r=relation('canon_member');r.target={label:'Resurrection',url:'https://scp-wiki.wikidot.com/resurrection',kind:'canon'};r.evidence=[doc.publisherMetadata[0].text];r.event_status='not_applicable';r.evidence_mode='narrator_fact';u.unitId='u';
 validateResult(answer([r]),[u]);const state=readSourceState(dir,url);state.contentSha256='bad';assert.throws(()=>readDocument(dir,state),/mismatch/);
});

test('exports exclude old source revisions, failed refreshes and out-of-scope results',t=>{
 const dir=temp(t),{exportResults,VERSION,resultFile}=require('../relations/survey-runner');
 const record=makeRecord(url,html),doc=saveSource(dir,url,html,'html',record),state=readSourceState(dir,url),u=splitDocument(doc,state.documentKey)[0];u.unitId='v'+VERSION+':'+u.unitId;
 const a=answer().results[0];a.unitId=u.unitId;const r=reconcile(u,a,a,{primarySession:'one',reviewerSession:'two'});r.assessmentVersion=VERSION;atomicJson(resultFile(dir,u),r);
 assert.equal(exportResults(dir,{pages:[url]}).accepted,1);assert.equal(exportResults(dir,{pages:[]}).accepted,0);
 const changed=html.replace('in the chamber','near the chamber'),newRecord=makeRecord(url,changed);saveSource(dir,url,changed,'html',newRecord);assert.equal(exportResults(dir,{pages:[url]}).accepted,0);
 saveSource(dir,url,html,'html',record);require('../relations/survey-source').sourceFailure(dir,url,'timeout');assert.equal(exportResults(dir,{pages:[url]}).units,0);
});
test('overlap cannot start inside a surrogate pair or prevent split progress',()=>{
 const units=splitDocument({url,title:'x',text:'AB🦎CDEFGHIJKLMNOPQRST',links:[]},'key',5,2);
 assert(units.length<30);for(const u of units)assert(!/^[\uDC00-\uDFFF]/.test(u.text));
 assert.throws(()=>splitDocument({text:'abc',links:[]},'k',4,3),/bounds/);
});

test('document consolidation revisits all candidate mentions and validates quotes against the original',()=>{
 const {createPlan,hydrate}=require('../relations/survey-consolidate');
 const text=('unrelated prose. '.repeat(12000))+'SCP-079 talked to SCP-682 in the chamber.'+(' more unrelated text.'.repeat(1000));
 const doc={url,title:'SCP-079',text,links:unit().links,tags:[],publisherMetadata:[],contentSha256:'hash',textSha256:'text'};
 const claim=relation(),plan=createPlan(doc,'doc',[{accepted:[{relation:claim}],disputed:[]}],3);
 assert(plan.units.length);assert.equal(plan.gaps.length,0);const u=hydrate(plan.units[0],doc);assert(u.text.includes(claim.evidence[0]));assert(!JSON.stringify(u).includes('verificationText'));
 const a=answer();a.results[0].unitId=u.unitId;validateResult(a,[u]);
 const gap=relation();gap.evidence=['[SOURCE GAP — separate source spans]'];const b=answer([gap]);b.results[0].unitId=u.unitId;assert.throws(()=>validateResult(b,[u]),/Evidence/);
});
test('localized redaction and ability statements do not become actual-event agreements',()=>{
 const {strongClaim}=require('../relations/survey-assessment');const r=relation('contained_at');r.target={label:'サイト-[編集済]',url:null,kind:'location'};assert.equal(strongClaim(r),false);r.target.label='サイト-［編集済］';assert.equal(strongClaim(r),false);
 const ability=relation('affects');ability.evidence=['SCP teams can cause massive physical damage to SCP-682.'];assert.equal(strongClaim(ability),false);
});

test('multi-part source becomes eligible only after independent document consolidation',t=>{
 const dir=temp(t),{exportResults,VERSION,resultFile}=require('../relations/survey-runner'),{createPlan,hydrate}=require('../relations/survey-consolidate');
 const body='<div id="page-title">SCP-079</div><div id="page-content"><p>'+('x'.repeat(41000))+'</p><p>SCP-079 talked to <a href="/scp-682">SCP-682</a> in the chamber.</p><p>'+('x'.repeat(41000))+'</p></div>';
 const record=makeRecord(url,body),doc=saveSource(dir,url,body,'html',record),state=readSourceState(dir,url),parts=[];
 for(const u of splitDocument(doc,state.documentKey)){
  u.unitId='v'+VERSION+':'+u.unitId;const a=answer(u.text.includes('SCP-079 talked to SCP-682 in the chamber.')?[relation()]:[]).results[0];a.unitId=u.unitId;
  const r=reconcile(u,a,a,{primarySession:'a',reviewerSession:'b'});r.assessmentVersion=VERSION;r.stage='initial';parts.push(r);atomicJson(resultFile(dir,u),r);
 }
 assert(parts.length>1);assert.equal(exportResults(dir,{pages:[url]}).accepted,0);
 const plan=createPlan(doc,state.documentKey,parts,VERSION);atomicJson(path.join(dir,'plans',state.documentKey+'.consolidation.json'),plan);
 for(const raw of plan.units){const u=hydrate(raw,doc),a=answer().results[0];a.unitId=u.unitId;validateResult({results:[a]},[u]);const r=reconcile(u,a,a,{primarySession:'c',reviewerSession:'d'});r.assessmentVersion=VERSION;r.stage='consolidation';atomicJson(resultFile(dir,u),r);}
 const summary=exportResults(dir,{pages:[url]});assert.equal(summary.accepted,1);assert.equal(summary.pagesDoubleAssessed,1);
 plan.units[0].contextCoverage='all_mentions_for_candidate_pairs';atomicJson(path.join(dir,'plans',state.documentKey+'.consolidation.json'),plan);const partial=exportResults(dir,{pages:[url]});assert.equal(partial.accepted,0);assert.equal(partial.pagesDoubleAssessed,0);
});

test('consolidation uses neutral endpoints and retains later evidence without endpoint mentions',()=>{
 const {createPlan}=require('../relations/survey-consolidate');
 const first='SCP-079 talked to SCP-682 in the chamber.',later='That conversation lasted a total of forty-three minutes.';
 const text=first+' '+('neutral prose. '.repeat(16000))+later+' '+('neutral prose. '.repeat(1000));
 const doc={url,title:'SCP-079',text,links:unit().links,tags:[],publisherMetadata:[],contentSha256:'hash',textSha256:'text'},a=relation(),b={...relation(),evidence:[later],note:'Later evidence'};
 const plan=createPlan(doc,'doc',[{accepted:[{relation:a}],disputed:[]},{accepted:[{relation:b}],disputed:[]}],4);
 assert(plan.units.some(u=>u.text.includes(later)));assert(plan.units.every(u=>!u.candidateRelations));
 for(const u of plan.units){assert(u.endpointHints.every(h=>!h.type&&!h.note&&!h.polarity));assert.equal(u.contextCoverage,'all_mentions_for_candidate_pairs');}
});
test('pending assessment and failed source retrieval have distinct counters',t=>{
 const dir=temp(t),{exportResults}=require('../relations/survey-runner');let s=exportResults(dir,{pages:[url]});assert.equal(s.pagesNotAssessed,1);assert.equal(s.sourcesUnavailable,0);
 require('../relations/survey-source').sourceFailure(dir,url,'timeout');s=exportResults(dir,{pages:[url]});assert.equal(s.pagesNotAssessed,0);assert.equal(s.sourcesUnavailable,1);
});

test('one invalid claim is quarantined without discarding valid independently agreed claims',()=>{
 const u=unit(),bad=relation('hostile_to');bad.evidence=['This sentence was invented.'];const a=answer([relation(),bad]);validateResult(a,[u],{isolateInvalid:true});assert.equal(a.results[0].relations.length,1);assert.equal(a.results[0].invalidRelations.length,1);
 const b=answer();validateResult(b,[u],{isolateInvalid:true});const result=reconcile(u,a.results[0],b.results[0],{primarySession:'a',reviewerSession:'b'});assert.equal(result.accepted.length,1);assert(result.disputed.some(x=>x.status==='invalid_model_claim'));
 const {fromCache}=require('../relations/survey-model');const cached=new Map([['u',{result:a.results[0],sessionId:'a',run:'test',promptSha256:'hash'}]]);const again=fromCache([u],cached,'primary');assert.equal(again.answer.results[0].invalidRelations.length,1);
});
test('completed cached primary work is recoverable without inventing reviewer sessions',t=>{
 const dir=temp(t),zlib=require('node:zlib'),{prompt}=require('../relations/survey-assessment'),{recoverCache,readCache}=require('../relations/survey-model-cache');
 const u={...unit(),unitId:'v4:hash:0'},a=answer();a.results[0].unitId=u.unitId;
 const folder=path.join(dir,'model-runs','1-primary-test');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'prompt.txt.gz'),zlib.gzipSync(prompt([u],'primary')));fs.writeFileSync(path.join(folder,'result.json'),JSON.stringify(a));fs.writeFileSync(path.join(folder,'events.jsonl'),[{type:'thread.started',thread_id:'real-primary'},{type:'turn.completed',usage:{}}].map(x=>JSON.stringify(x)).join('\n'));
 assert.equal(recoverCache(dir,4),1);assert.equal(readCache(dir,u,'primary').sessionId,'real-primary');assert.equal(readCache(dir,u,'review'),null);assert.equal(readCache(dir,{...u,text:u.text+' changed'},'primary'),null);
 const rejected=path.join(dir,'model-runs','2-review-tool');fs.mkdirSync(rejected,{recursive:true});fs.writeFileSync(path.join(rejected,'prompt.txt.gz'),zlib.gzipSync(prompt([u],'review')));fs.writeFileSync(path.join(rejected,'result.json'),JSON.stringify(a));fs.writeFileSync(path.join(rejected,'events.jsonl'),[{type:'thread.started',thread_id:'bad-review'},{type:'item.started',item:{type:'command_execution'}},{type:'turn.completed'}].map(x=>JSON.stringify(x)).join('\n'));assert.equal(recoverCache(dir,4),0);assert.equal(readCache(dir,u,'review'),null);
});
