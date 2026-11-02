"use strict";
const fs=require('node:fs'),path=require('node:path');
const noai=path.join(__dirname,'output/noai/status.json');
if(!process.argv[2]&&fs.existsSync(noai)){
 const s=JSON.parse(fs.readFileSync(noai));let processAlive=false;try{process.kill(s.pid,0);processAlive=true;}catch{}
 console.log(JSON.stringify({...s,processAlive,publication:'調査用出力。意味関係の候補は未確定。公開相関図には未反映。'},null,2));process.exit(0);
}
const dir=path.resolve(process.argv[2]||path.join(__dirname,'.cache/semantic-survey'));
const file=path.join(dir,'status.json');if(!fs.existsSync(file)){console.log('調査は未開始です');process.exit(0);}
const s=JSON.parse(fs.readFileSync(file));let alive=false;try{process.kill(s.pid,0);alive=true;}catch{}
console.log(JSON.stringify({state:s.state,processAlive:alive,targetPages:s.targetPages,sourceStatesRecorded:s.sourceStatesRecorded||0,sourcesReadyAtLastAssessment:s.sourcesReady,sourceFailuresAtLastAssessment:s.sourcesFailed,reviewPolicy:s.reviewPolicy||'legacy_double_review',unitsFirstAssessed:s.unitsFirstAssessed,unitsDoubleAssessed:s.unitsDoubleAssessed,unitLevelMachineAgreements:s.accepted,relationshipsRequiringReview:s.requiresReview,modelErrors:s.modelErrors,lastModelError:s.lastModelError||null,nextModelRetryAt:s.nextModelRetryAt||null,updatedAt:s.updatedAt,runLog:s.runLog||'run-v4.log',exportSummary:fs.existsSync(path.join(dir,'export/summary.json'))?JSON.parse(fs.readFileSync(path.join(dir,'export/summary.json'))):null,publication:'調査結果は別ファイル。公開相関図には未反映。二重判定の合意は人手の確定判定ではない。'},null,2));
