'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),z=require('node:zlib');
const {refresh,checked,retryAfter}=require('../research-board/refresh-links');
const {audit}=require('../tool/research-board-body-link-coverage');
const {normalizePage,digest,EXTRACTOR_VERSION}=require('../research-board/extract');
const {saveSources}=require('../research-board/source-store');
const {generateResearchBoard}=require('../research-board/catalog');
const base='https://scp-wiki.wikidot.com/',stamp='2026-11-19T00:00:00Z';
function fixture(t,count){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'board-completion-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const data=Array.from({length:count},(_,i)=>({itemId:'scp-'+i,pageType:'scp-series',urlEN:base+'scp-'+i,isTranslatedJP:false}));
  const dir=path.join(root,'local-data/mobile-v3/en');fs.mkdirSync(dir,{recursive:true});
  const bytes=z.gzipSync(JSON.stringify({language:'en',timestamp:stamp,totalCount:data.length,data}));
  const fileName='catalog-'+digest(bytes)+'.json.gz';fs.writeFileSync(path.join(dir,fileName),bytes);
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({fileName,sha256:digest(bytes),bytes:bytes.length}));
  return root;
}
function record(url){return {schemaVersion:1,url,pageId:normalizePage(url).id,format:'html',contentSha256:digest(url),
  checkedAt:stamp,linkExtractionVersion:EXTRACTOR_VERSION,links:[],limitations:['legacy_unchecked_links']};}
test('default refresh exceeds 600 pages and five minutes, counts zero links and resumes without requests',async t=>{
  const root=fixture(t,601);let time=Date.parse(stamp),calls=0;
  const options={root,language:'en',intervalMs:1000,now:stamp,clock:()=>time,
    sleep:async ms=>{time+=ms;},request:async url=>{calls++;time+=1000;return record(url);}};
  const first=await refresh(options);
  assert.equal(first.updated,601);assert.equal(first.remaining,0);assert.equal(first.interrupted,false);
  assert.ok(time-Date.parse(stamp)>300000);assert.equal(audit(root).checkedPages,601);
  const second=await refresh(options);assert.equal(second.attempted,0);assert.equal(calls,601);
});
test('transient retry respects Retry-After and request spacing',async t=>{
  const root=fixture(t,2),times=[],delays=[];let time=Date.parse(stamp),attempt=0;
  const report=await refresh({root,language:'en',now:stamp,clock:()=>time,intervalMs:1000,
    sleep:async ms=>{delays.push(ms);time+=ms;},request:async url=>{
      times.push(time);if(++attempt===1)throw Object.assign(Error('rate limit'),{response:{status:429,headers:{'retry-after':'120'}}});
      return record(url);
    }});
  assert.equal(report.updated,2);assert.equal(report.retries,1);assert.ok(delays.includes(120000));
  for(let i=1;i<times.length;i++)assert.ok(times[i]-times[i-1]>=1000);
  assert.equal(retryAfter({response:{headers:{'retry-after':'Thu, 19 Nov 2026 00:02:00 GMT'}}},Date.parse(stamp)),120000);
});
test('runner checkpoints resume unvisited pages; unavailable pages retain their reason and cooldown',async t=>{
  const root=fixture(t,3);let time=Date.parse(stamp),calls=0;
  const options={root,language:'en',now:stamp,intervalMs:0,checkpointAfterMs:1,clock:()=>time,request:async url=>{calls++;time++;return record(url);}};
  const first=await refresh(options);assert.equal(first.updated,1);assert.equal(first.stopReason,'checkpoint');
  const second=await refresh({...options,checkpointAfterMs:0});assert.equal(second.updated,2);assert.equal(calls,3);
  const bad=fixture(t,1),url=base+'scp-0';
  saveSources(new Map([[normalizePage(url).id,{url,record:null,lastAttempt:{status:'unavailable',at:stamp,retryAfter:'2099-01-01T00:00:00Z'}}]]),path.join(bad,'local-data/research-board-sources'));
  const result=await refresh({root:bad,language:'en',now:stamp,uncheckedOnly:true,request:async()=>{throw Error('must not request');}});
  assert.equal(result.deferred,1);assert.equal(result.attempted,0);assert.equal(result.remaining,1);
  const report=audit(bad);assert.equal(report.unresolved[0].reason,'unavailable');assert.equal(report.groups[0].eligible,0);
});
test('repeated publisher failures stop politely and never become checked',async t=>{
  const root=fixture(t,10);let calls=0;
  const report=await refresh({root,language:'en',now:stamp,intervalMs:0,request:async()=>{
    calls++;throw Object.assign(Error('forbidden'),{response:{status:403}});
  }});
  assert.equal(calls,5);assert.equal(report.stopReason,'publisher_unavailable');
  assert.equal(audit(root).checkedPages,0);assert.equal(report.remaining,10);
  assert.equal(checked({record:record(base+'scp-0'),lastAttempt:{status:'success'}}),false);
});
test('HTTP 429 is not bypassed through an immediate alternate page request',async t=>{
  const axios=require('axios'),original=axios.get;let calls=0,gates=0;
  t.after(()=>{axios.get=original;});
  axios.get=async()=>{calls++;throw Object.assign(Error('busy'),{response:{status:429}});};
  await assert.rejects(require('../related-documents').fetchRecord(base+'scp-0',null,{beforeRequest:async()=>{gates++;},expandDescriptions:false}));
  assert.equal(calls,1);assert.equal(gates,1);
});

test('publication and independent inventory use the same current catalog/source coverage',t=>{
 const root=fixture(t,2),input=path.join(root,'local-data');
 const url=base+'scp-0',r={...record(url),limitations:[]};
 saveSources(new Map([[r.pageId,{record:r,lastAttempt:{status:'success',at:stamp}}]]),path.join(input,'research-board-sources'));
 const stale=path.join(input,'research-board-body-link-coverage.json.gz');
 fs.writeFileSync(stale,z.gzipSync(JSON.stringify({totalPages:99,pendingPages:0,unresolved:[]})));
 generateResearchBoard(input,path.join(input,'mobile-v3'));
 const published=JSON.parse(z.gunzipSync(fs.readFileSync(stale)));
 assert.equal(published.totalPages,2);assert.equal(published.checkedPages,1);assert.equal(published.pendingPages,1);
 fs.writeFileSync(stale,z.gzipSync(JSON.stringify({totalPages:99,pendingPages:0,unresolved:[]})));
 const current=require('../research-board/verification/audit').loadCoverage(root);
 assert.equal(current.totalPages,2);assert.equal(current.pendingPages,1);
 assert.equal(current.unresolved[0].url,base+'scp-1');
});
