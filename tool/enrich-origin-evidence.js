'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {readState,writeState}=require('../catalog-indexes');
const {lookupOriginals,ENDPOINT}=require('../origin-interwiki');
const {normalize}=require('../related-documents');
async function enrich({root=path.join(__dirname,'..'),language=null,targets=null,maxPages=150,maxDurationMs=180000,
 intervalMs=500,writeLocal=false,lookup=lookupOriginals}={}){
 if(!Number.isInteger(maxPages)||maxPages<0||maxPages>10000||maxDurationMs<=0||intervalMs<0)throw Error('Invalid evidence limits');
 if(!targets){const c=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root,'local-data/related-documents/catalog.json.gz'))));
  targets=c.data.filter(r=>r.pageType==='related-document-unclassified'||r.classification?.basis==='interwiki_original_metadata')
   .sort((a,b)=>Number(b.classification?.basis==='interwiki_original_metadata')-Number(a.classification?.basis==='interwiki_original_metadata'))
   .map(r=>({url:r.url,site:r.language,publishedOriginEvidence:r.classification?.basis==='interwiki_original_metadata'?
     r.classification.evidence?.find(e=>e.schemaVersion===1&&e.queryUrl===r.url):null}));}
 const files=new Map(),states=new Map();
 for(const t of targets){const lang=t.site||t.language;if(language&&lang!==language)continue;
  if(normalize(t.url)?.language!==lang)throw Error('Invalid evidence target');
  if(states.has(lang))continue;
  const local=path.join(root,'local-data/catalog-indexes',lang+'.json.gz'),partial=path.join(root,'partial-data/catalog-indexes',lang+'.json.gz');
  if(!fs.existsSync(local)&&!fs.existsSync(partial))continue;
  files.set(lang,{local,partial});states.set(lang,readState(writeLocal&&fs.existsSync(local)?local:fs.existsSync(partial)?partial:local));
 }
 const queue=[...new Map(targets.map(t=>[t.url,t])).values()].filter(t=>{
  const r=states.get(t.site||t.language)?.records[t.url],e=r?.interwikiOrigin;
  return r&&(!e||e.schemaVersion!==1||e.contentSha256!==r.contentSha256||!Number.isFinite(Date.parse(e.checkedAt))||Date.now()-Date.parse(e.checkedAt)>28*86400000);
 }).slice(0,maxPages);
 const cache=path.join(root,'partial-data/origin-evidence/interwiki');fs.mkdirSync(cache,{recursive:true});
 const started=Date.now(),report={targeted:queue.length,processed:0,translations:0,notIndexed:0,noTranslation:0,requests:0,failures:[]};
 const dirty=new Map();
 function flush(){for(const [lang,urls]of dirty){const state=states.get(lang),f=files.get(lang);
   if(writeLocal){writeState(f.local,state);if(fs.existsSync(f.partial)){const partial=readState(f.partial);
    for(const url of urls)if(partial.records[url]?.contentSha256===state.records[url].contentSha256)partial.records[url].interwikiOrigin=state.records[url].interwikiOrigin;
    writeState(f.partial,partial);}}
   else writeState(f.partial,state);
  }dirty.clear();}
 try{for(let i=0;i<queue.length&&Date.now()-started<maxDurationMs;i+=25){
  const batch=queue.slice(i,i+25),missing=[],observations=new Map();
  for(const t of batch){const file=path.join(cache,crypto.createHash('sha256').update(t.url).digest('hex')+'.json');
   if(fs.existsSync(file)){const e=JSON.parse(fs.readFileSync(file));if(e.schemaVersion===1&&e.queryUrl===t.url&&Date.now()-Date.parse(e.checkedAt)<28*86400000)observations.set(t.url,e);}
   // Captured page bytes can change due to ratings/templates. Retain the
   // independently published relation within the same 28-day refresh window
   // instead of losing origin merely because a local sidecar cache is absent.
   const previous=t.publishedOriginEvidence;
   if(!observations.has(t.url)&&previous?.schemaVersion===1&&previous.queryUrl===t.url&&
      previous.status==='translation'&&previous.terminal&&Date.now()-Date.parse(previous.checkedAt)<28*86400000)observations.set(t.url,previous);
   if(!observations.has(t.url))missing.push(t.url);}
  if(missing.length){if(report.requests)await new Promise(r=>setTimeout(r,intervalMs));
   try{report.requests++;const results=await lookup(missing);
    if(results.length!==missing.length||new Set(results.map(e=>e.queryUrl)).size!==missing.length||results.some(e=>!missing.includes(e.queryUrl)))throw Error('Interwiki batch member mismatch');
    for(const e of results){if(!missing.includes(e.queryUrl))throw Error('Unexpected interwiki member');
     if(e.validationError){report.failures.push({urls:[e.queryUrl],reason:e.validationError});continue;}
     const saved={...e,schemaVersion:1,checkedAt:new Date().toISOString(),endpoint:ENDPOINT};
     const file=path.join(cache,crypto.createHash('sha256').update(e.queryUrl).digest('hex')+'.json');
     fs.writeFileSync(file+'.tmp',JSON.stringify(saved));fs.renameSync(file+'.tmp',file);observations.set(e.queryUrl,saved);}
   }catch(e){report.failures.push({urls:missing,reason:e.message});continue;}}
  for(const t of batch){const e=observations.get(t.url);if(!e)continue;const lang=t.site||t.language,r=states.get(lang).records[t.url];
   r.interwikiOrigin={...e,contentSha256:r.contentSha256};
   if(!dirty.has(lang))dirty.set(lang,new Set());dirty.get(lang).add(t.url);
   report.processed++;if(e.status==='translation')report.translations++;else if(e.status==='not_indexed')report.notIndexed++;else if(e.status==='no_translation')report.noTranslation++;}
  if(report.processed%250===0){flush();console.log(JSON.stringify(report));}
 }}finally{flush();}
 report.complete=report.processed===queue.length;
 const reportFile=path.join(root,'relations/origin-interwiki-enrichment.json');if(writeLocal){fs.mkdirSync(path.dirname(reportFile),{recursive:true});fs.writeFileSync(reportFile,JSON.stringify(report,null,2));}
 console.log(JSON.stringify(report));return report;
}
if(require.main===module)enrich({language:process.argv[2]||null,maxPages:Number(process.env.ORIGIN_EVIDENCE_MAX_PAGES||150),maxDurationMs:Number(process.env.ORIGIN_EVIDENCE_MAX_DURATION_MS||180000)}).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={enrich};
