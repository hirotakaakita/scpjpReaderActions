'use strict';
// Upgrade old crawl artifacts which predate stable publisher body fingerprints.
// Only the 67 independently reviewed URLs may be fetched, once per URL. A new
// capture must match the old audit; this tool never updates the audit baseline.
const fs=require('node:fs'),path=require('node:path');
const plan=require('../research-board/reviewed-original-67.json');
const {normalizePage,makeRecord,digest}=require('../research-board/extract');
const {matchesReviewedEvidence}=require('../research-board/reviewed-identity-evidence');
const {readSources,importDirectory,merge}=require('../research-board/source-store');

async function fetchReviewedRecord(url,{fetchImpl=fetch,delayMs=1000}={}){
 const rule=plan.rules.find(r=>r.source===url);
 if(!rule)throw Error('Unreviewed publisher URL: '+url);
 const allowed=new Set([rule.source,rule.auditedFinalUrl||rule.source]);
 let endpoint=url;
 for(let hop=0;hop<4;hop++){
  await new Promise(resolve=>setTimeout(resolve,delayMs));
  const res=await fetchImpl(endpoint,{signal:AbortSignal.timeout(20000),redirect:'manual',
   headers:{'User-Agent':'SCPReaderSourceVerification/1.0','Accept':'text/html'}});
  if([301,302,303,307,308].includes(res.status)){
   const location=res.headers.get('location');
   const next=location&&normalizePage(new URL(location,endpoint).href);
   if(!next||!allowed.has(next.url))throw Error('Unreviewed publisher redirect: '+url);
   endpoint=next.url;continue; // Upgrade audited HTTP aliases to HTTPS.
  }
  if(!res.ok)throw Error('Reviewed publisher HTTP '+res.status+': '+url);
  const body=await res.text();
  if(body.length>1200000)throw Error('Reviewed publisher exceeds audit size limit: '+url);
  return makeRecord(url,body);
 }
 throw Error('Reviewed publisher redirect limit: '+url);
}

async function refresh(sources,{fetchRecord,fetchImage,writeRecord,rules=plan.rules}){
 const report={reviewed:rules.length,unchanged:0,stable:0,fetched:0,imagesChecked:0};
 for(const rule of rules){
  const id=normalizePage(rule.source).id,state=sources.get(id);
  if(!state?.record||['not_found','not_article','unavailable'].includes(state.lastAttempt?.status))
   throw Error('Missing or unavailable reviewed publisher: '+rule.source);
  let record=state.record;
  if(!rule.imageEvidence&&record.contentSha256===rule.sourceSha256){report.unchanged++;continue;}
  if(rule.imageEvidence){
   if(!record.reviewedIdentityEvidence?.imageUrls){record=await fetchRecord(rule.source);report.fetched++;}
   // Verify the mutable image bytes on every publication, even at the same URL.
   const image=await fetchImage(rule.imageEvidence.url);report.imagesChecked++;
   record={...record,reviewedIdentityEvidence:{...record.reviewedIdentityEvidence,imageSha256:digest(image)}};
   if(!matchesReviewedEvidence(record,rule))throw Error('Reviewed publisher image or identity changed: '+rule.source);
   const updated={record,lastAttempt:{status:'success',at:record.checkedAt}};
   await writeRecord(id,updated);merge(sources,updated);report.stable++;continue;
  }
  if(!matchesReviewedEvidence(record,rule)){
   if(record.reviewedIdentityEvidence?.version===1&&
      record.reviewedIdentityEvidence.contentSha256===record.contentSha256)
    throw Error('Reviewed publisher body or identity changed: '+rule.source);
   record=await fetchRecord(rule.source);report.fetched++;
   if(!matchesReviewedEvidence(record,rule))
    throw Error('Reviewed publisher body or identity changed: '+rule.source);
   const updated={record,lastAttempt:{status:'success',at:record.checkedAt}};
   await writeRecord(id,updated);merge(sources,updated);
  }
  report.stable++;
 }
 return report;
}
async function run(root=path.resolve(__dirname,'..')){
 const input=path.join(root,'local-data'),incoming=path.join(root,'partial-data/related-documents/research-board');
 const sources=readSources(path.join(input,'research-board-sources'));
 importDirectory(sources,incoming);
 require('../research-board/catalog-sources').importCatalogSources(sources,input,require('../research-board/catalog').loadCatalogs(input));
 const report=await refresh(sources,{
  fetchImage:async url=>{
   const res=await fetch(url,{signal:AbortSignal.timeout(20000),redirect:'error'});
   if(!res.ok)throw Error('Reviewed publisher image HTTP '+res.status+': '+url);
   const bytes=Buffer.from(await res.arrayBuffer());
   if(bytes.length>5000000)throw Error('Reviewed publisher image exceeds size limit');
   return bytes;
  },
  fetchRecord:fetchReviewedRecord,
  writeRecord:async(id,state)=>{
   fs.mkdirSync(incoming,{recursive:true});
   const file=path.join(incoming,digest(id)+'.json');
   fs.writeFileSync(file+'.tmp',JSON.stringify(state));fs.renameSync(file+'.tmp',file);
  }
 });
 console.log(JSON.stringify(report));return report;
}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={refresh,run,fetchReviewedRecord};
