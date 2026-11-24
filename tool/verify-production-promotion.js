'use strict';
// Read-only comparison with the previously published production checkpoint.
const fs=require('node:fs'),path=require('node:path'),z=require('node:zlib');
const cp=require('node:child_process'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {LANGUAGES}=require('../languages');
const root=path.resolve(__dirname,'..');
function verify(base='origin/master'){
 const old=file=>cp.execFileSync('git',['show',base+':'+file],{cwd:root,maxBuffer:40*1024*1024});
 const load=dir=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,dir,'manifest.json')));
  const bytes=fs.readFileSync(path.join(root,dir,manifest.fileName));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),manifest.sha256);
  assert.equal(bytes.length,manifest.bytes);
  const decoded=z.gunzipSync(bytes);assert.equal(decoded.length,manifest.decodedBytes);
  return {manifest,data:JSON.parse(decoded)};
 };
 let articleRows=0;const changedFields={};
 const page=r=>r.isTranslatedJP!==false&&r.urlJP?r.urlJP:r.urlEN;
 for(const language of Object.keys(LANGUAGES)){
  const dir='local-data/mobile-v3/'+language;
  const previous=JSON.parse(old(dir+'/manifest.json'));
  const prior=JSON.parse(z.gunzipSync(old(dir+'/'+previous.fileName)));
  const {manifest,data:next}=load(dir),byId=new Map(next.data.map(r=>[r.itemId,r]));
  assert.equal(next.data.length,prior.data.length,language+': published row count changed');
  assert.equal(byId.size,next.data.length,language+': duplicate reader key');
  assert.equal(manifest.totalCount,next.data.length);
  assert.deepEqual(fs.readFileSync(path.join(root,dir,previous.fileName)),old(dir+'/'+previous.fileName),'Cached catalog pointer lost its payload');
  for(const row of prior.data){
   const current=byId.get(row.itemId);assert(current,language+': lost '+row.itemId);
   assert.equal(page(current),page(row),language+': remapped '+row.itemId);
   for(const key of ['createdAt','lastUpdated','descriptionExcerpt','imageUrl','rating'])assert.deepEqual(current[key],row[key],language+'/'+row.itemId+': changed '+key);
   for(const key of new Set([...Object.keys(row),...Object.keys(current)]))if(JSON.stringify(row[key])!==JSON.stringify(current[key]))changedFields[key]=(changedFields[key]||0)+1;
  }
  if(JSON.stringify(prior.data)!==JSON.stringify(next.data))assert(Date.parse(next.timestamp)>Date.parse(prior.timestamp),language+': clients would miss the repair');
  articleRows+=next.data.length;
 }
 const {manifest:boardManifest,data:runtime}=load('local-data/mobile-v3/research-board');
 const board=boardManifest.schemaVersion===4
  ? require('../research-board/runtime-delivery').loadAudit(path.join(root,'local-data')) : runtime;
 const retired=new Set(board.hiddenRetiredPageUrls),hidden=new Set(board.hiddenRetiredNodeIds);
 assert.equal(retired.size,board.overview.hiddenRetiredPageCount);
 assert.equal(hidden.size,board.overview.hiddenRetiredWorkCount);
 for(const n of board.nodes)assert.equal(n[13].every(p=>retired.has(p[1])),hidden.has(n[0]),'Retired work index mismatch');
 assert.equal(board.overview.publisherReviewedIdentityCount,67);
 const owners=new Map(board.nodes.flatMap(n=>n[13].map(p=>[p[1],n[0]])));
 for(const rule of require('../research-board/reviewed-original-67.json').rules){
  assert(owners.has(rule.source)&&owners.has(rule.target),'Missing reviewed catalog page');
  assert.equal(owners.get(rule.source),owners.get(rule.target),'Reviewed split remains: '+rule.source);
 }
 const report={base,languages:Object.keys(LANGUAGES).length,articleRows,readerKeysPreserved:true,
  changedFields,boardRevision:runtime.revision,workNodes:board.nodes.length,edges:runtime.edges.length,
  retiredPages:retired.size,retiredWorks:hidden.size,reviewedIdentityCases:67};
 console.log(JSON.stringify(report,null,2));return report;
}
if(require.main===module)verify(process.argv[2]);
module.exports={verify};
