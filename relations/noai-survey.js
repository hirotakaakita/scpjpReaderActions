"use strict";
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {normalizePage}=require('./core'),{atomicJson,readRecord}=require('./store'),{readSourceState,readDocument}=require('./survey-source'),{structuralFacts,semanticCandidates}=require('./noai-core'),{fileHash}=require('./jsonl'),{pageKind}=require('./semantics');
function writer(file){const fd=fs.openSync(file,'w');let buffer='';return{add(value){buffer+=JSON.stringify(value)+'\n';if(buffer.length>=1048576){fs.writeFileSync(fd,buffer);buffer='';}},close(){if(buffer)fs.writeFileSync(fd,buffer);fs.closeSync(fd);}};}
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function writeReview(file,samples,summary){
 const rows=samples.map(c=>'<article data-branch="'+escape(c.branch)+'"><h3>'+escape(c.branch.toUpperCase()+' / '+normalizePage(c.sourceUrl).slug)+'</h3><p>'+escape(c.hintTypes.join(' · '))+'</p><blockquote>'+escape(c.evidence.excerpt)+'</blockquote><a target="_blank" rel="noopener noreferrer" href="'+escape(c.sourceUrl)+'">原典を確認</a><small>候補のみ・関係は未確定。出典SHA-256: '+escape(c.evidence.contentSha256)+'</small></article>').join('');
 const html='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; base-uri \'none\'"><title>SCP 関係候補の確認</title><style>body{font:15px/1.7 system-ui;background:#0b1219;color:#ddd;max-width:1000px;margin:auto;padding:24px}input{padding:12px;width:90%;background:#18212a;color:white;border:1px solid #8c784f}article{padding:20px 0;border-bottom:1px solid #34414b}h3,a{color:#dfc28a}blockquote{white-space:pre-wrap;margin:12px 0;color:#bfcbd1}small{display:block;color:#86949f;overflow-wrap:anywhere}</style><h1>関係候補の確認</h1><p>AI不使用。本文リンク等の構造確認 '+summary.structuredFacts.toLocaleString()+' 件。意味的な関係の候補 '+summary.semanticCandidates.toLocaleString()+' 件。</p><p>この画面は各支部の先頭40候補の抜粋です。共演・敵対・所属が確定した一覧ではありません。全件は同じフォルダのcandidates.jsonlに保存しています。</p><input id="search" aria-label="この抜粋内を検索" placeholder="この抜粋内を記事番号・語句で検索"><main>'+rows+'</main><footer>出典：各記事リンク / SCP Wiki, CC BY-SA 3.0。調査用抜粋であり記事全文の代替ではありません。</footer><script>document.getElementById("search").addEventListener("input",function(){const q=this.value.toLowerCase();for(const row of document.querySelectorAll("article"))row.hidden=!row.textContent.toLowerCase().includes(q)})</script>';
 fs.writeFileSync(file,html);
}
function run({surveyDir=path.join(__dirname,'.cache/semantic-survey'),outputDir=path.join(__dirname,'output/noai'),recordDir=path.join(__dirname,'.cache/records'),limit=0}={}){
 surveyDir=path.resolve(surveyDir);outputDir=path.resolve(outputDir);fs.mkdirSync(outputDir,{recursive:true});
 const statusFile=path.join(outputDir,'status.json');if(fs.existsSync(statusFile)){const s=JSON.parse(fs.readFileSync(statusFile));if(s.state==='running'){try{process.kill(s.pid,0);throw Error('Model-free survey already running');}catch(e){if(e.code!=='ESRCH')throw e;}}}
 const scope=JSON.parse(fs.readFileSync(path.join(surveyDir,'scope.json'))),pages=limit?scope.pages.slice(0,limit):scope.pages;
 const revision=new Date().toISOString().replace(/[^0-9]/g,'')+'-'+process.pid,dir=path.join(outputDir,'revisions',revision);fs.mkdirSync(dir,{recursive:true});
 const names=['structure','curated','candidates','pages','canon-groups'],writers=Object.fromEntries(names.map(n=>[n,writer(path.join(dir,n+'.jsonl'))]));
 const counts={targetPages:pages.length,checkedPages:0,textsScanned:0,unfetched:0,sourceUnavailable:0,integrityErrors:0,structuredFacts:0,curatedAssertions:0,semanticCandidates:0,byType:{},byBranch:{}};
 const startedAt=new Date().toISOString(),inventory=createHash('sha256'),groups=new Map(),samples=[],sampleCounts=new Map(),targetCache=new Map();
 const save=state=>atomicJson(statusFile,{state,pid:process.pid,mode:'model_free',modelCalls:0,startedAt,updatedAt:new Date().toISOString(),revision,...counts});
 const lookup=url=>{if(targetCache.has(url))return targetCache.get(url);const s=readRecord(recordDir,url),r=s?.record&&['success','not_modified'].includes(s.lastAttempt?.status)?{tags:s.record.tags}:null;if(targetCache.size>2048)targetCache.clear();targetCache.set(url,r);return r;};
 save('running');let closed=false;
 try{
  for(const url of pages){const page=normalizePage(url);if(!page){counts.integrityErrors++;counts.checkedPages++;continue;}const state=readSourceState(surveyDir,url);let status;
   if(!state?.document){status=state?.lastAttempt?.status?'source_unavailable':'unfetched';counts[status==='unfetched'?'unfetched':'sourceUnavailable']++;}
   else if(state.lastAttempt?.status!=='success'){status='source_unavailable';counts.sourceUnavailable++;}
   else try{
    const doc=readDocument(surveyDir,state);if(doc.url!==page.url)throw Error('Scope identity mismatch');const record=readRecord(recordDir,url)?.record;
    inventory.update(doc.pageId+'\0'+doc.contentSha256+'\n');counts.textsScanned++;status='scanned';counts.byBranch[page.branch]||={texts:0,structure:0,candidates:0};counts.byBranch[page.branch].texts++;
    for(const fact of structuralFacts(doc,record,lookup)){const curated=fact.status==='curated_source_assertion';writers[curated?'curated':'structure'].add(fact);counts[curated?'curatedAssertions':'structuredFacts']++;counts.byType[fact.type]=(counts.byType[fact.type]||0)+1;if(!curated)counts.byBranch[page.branch].structure++;
     if(fact.type==='canon_member'){if(!groups.has(fact.target))groups.set(fact.target,{canonUrl:fact.targetUrl,members:new Set()});groups.get(fact.target).members.add(doc.url);}
    }
    for(const candidate of semanticCandidates(doc)){writers.candidates.add(candidate);counts.semanticCandidates++;counts.byBranch[page.branch].candidates++;if((sampleCounts.get(page.branch)||0)<40){samples.push(JSON.parse(JSON.stringify(candidate)));sampleCounts.set(page.branch,(sampleCounts.get(page.branch)||0)+1);}}
    writers.pages.add({url,pageId:doc.pageId,branch:doc.branch,title:doc.title,pageKind:pageKind(page,doc),state:status,contentSha256:doc.contentSha256,textSha256:doc.textSha256,limitations:doc.limitations,semanticClaimsConfirmedByThisScan:false});
   }catch(e){status='integrity_error';counts.integrityErrors++;writers.pages.add({url,state:status,error:e.message});}
   if(status!=='scanned'&&status!=='integrity_error')writers.pages.add({url,state:status,lastAttempt:state?.lastAttempt||null});
   counts.checkedPages++;if(counts.checkedPages%250===0){save('running');console.log(JSON.stringify({at:new Date().toISOString(),checked:counts.checkedPages,total:counts.targetPages,texts:counts.textsScanned,facts:counts.structuredFacts,candidates:counts.semanticCandidates}));}
  }
  for(const group of groups.values())writers['canon-groups'].add({canonUrl:group.canonUrl,members:[...group.members].sort(),meaning:'Shared explicit publisher canon membership, not a claim that every mentioned SCP inherits this canon'});
  for(const w of Object.values(writers))w.close();closed=true;
  const files=Object.fromEntries(names.map(n=>[n,{path:'revisions/'+revision+'/'+n+'.jsonl',bytes:fs.statSync(path.join(dir,n+'.jsonl')).size,sha256:fileHash(path.join(dir,n+'.jsonl'))}]));
  const summary={schemaVersion:1,mode:'model_free',modelCalls:0,generatedAt:new Date().toISOString(),scope:scope.scope,sourceInventorySha256:inventory.digest('hex'),...counts,canonGroups:groups.size,files,limitations:['This is a structural and multilingual keyword/co-mention survey, not full semantic confirmation.','Keyword candidates do not prove co-appearance, hostility, affiliation or family relationships.','No source fetching or model inference occurs in this command. Unavailable pages remain explicit.']};
  writeReview(path.join(dir,'review.html'),samples,summary);summary.reviewPath='revisions/'+revision+'/review.html';atomicJson(path.join(outputDir,'manifest.json'),summary);save('finished_pass');console.log(JSON.stringify(summary,null,2));return summary;
 }catch(e){save('failed');throw e;}finally{if(!closed)for(const w of Object.values(writers))try{w.close();}catch{}}
}
if(require.main===module){const args=process.argv.slice(2),value=k=>args.includes(k)?args[args.indexOf(k)+1]:undefined;run({surveyDir:value('--survey-dir'),outputDir:value('--output'),recordDir:value('--records'),limit:Number(value('--limit')||0)});}
module.exports={run,writeReview};
