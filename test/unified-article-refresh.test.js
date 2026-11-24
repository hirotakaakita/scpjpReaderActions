'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {refreshArticleText}=require('../tool/refresh-article-text');
const {VERSION}=require('../article-excerpts');

test('new native articles are refreshed before publication and observed empty bodies pass the audit',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'incoming-native-text-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const partial=path.join(root,'partial-data');fs.mkdirSync(partial,{recursive:true});
 const {partialFileName}=require('../partial-file'),{LANGUAGES}=require('../languages');
 const urls=['https://scpfoundation.net/scp-new-image-j','https://scpfoundation.net/scp-new-text-j'];
 const rows=urls.map((url,i)=>({itemId:'new-'+i,urlJP:url,titleJP:'New article',descriptionExcerpt:'',isTranslatedJP:true}));
 fs.writeFileSync(path.join(partial,partialFileName('ru',LANGUAGES.ru.pages[0].path)),JSON.stringify({data:rows}));
 const calls=[];const report=await refreshArticleText({root,language:'ru',intervalMs:0,request:async url=>{calls.push(url);return {url,title:'New article',descriptionExcerpt:url===urls[0]?'':'A newly discovered narrative.'};}});
 assert.deepEqual(calls,urls);assert.equal(report.edits.length,2);assert.equal(report.edits[0].descriptionStatus,'no_prose');
 // Simulate the native merge followed by the normal apply and delivery stages.
 const local=path.join(root,'local-data/ru');fs.mkdirSync(local,{recursive:true});fs.writeFileSync(path.join(local,'scp-data.json'),JSON.stringify({data:rows}));fs.writeFileSync(path.join(local,'meta.json'),'{}');
 require('../tool/apply-excerpt-repairs').apply({root});
 const updated=JSON.parse(fs.readFileSync(path.join(local,'scp-data.json'))).data;
 assert.equal(updated[0].descriptionStatus,'no_prose');assert.equal(updated[1].descriptionExcerpt,'A newly discovered narrative.');
 const mobile=path.join(root,'local-data/mobile-v3/ru');fs.mkdirSync(mobile,{recursive:true});fs.writeFileSync(path.join(mobile,'manifest.json'),JSON.stringify({fileName:'catalog.json'}));fs.writeFileSync(path.join(mobile,'catalog.json'),JSON.stringify({data:updated}));
 const audit=require('../tool/audit-article-text').audit({root,strict:true,writeReport:false});assert.equal(audit.problems.length,0);assert.equal(audit.emptySourceBodies.length,1);
});

test('a resumed full refresh fetches only unfinished articles and retains successful source edits',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'article-resume-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'local-data/jp');fs.mkdirSync(dir,{recursive:true});
 const urls=['https://scp-jp.wikidot.com/scp-173','https://scp-jp.wikidot.com/scp-174'];
 fs.writeFileSync(path.join(dir,'scp-data.json'),JSON.stringify({data:urls.map(url=>({urlJP:url,titleJP:'A title',descriptionExcerpt:'The old body.'}))}));
 const {repair}=require('../tool/repair-catalog-excerpts');
 const first=await repair({root,language:'jp',force:true,maxRequests:1,intervalMs:0,request:async url=>({url,title:'Source title',descriptionExcerpt:'First observed source body.'})});
 assert.equal(first.edits.length,1);assert.equal(first.pending.length,1);
 const calls=[];
 const report=await refreshArticleText({root,language:'jp',intervalMs:0,previousFile:path.join(root,'partial-data/excerpt-repairs/jp.json.gz'),request:async url=>{calls.push(url);return {url,title:'Second source title',descriptionExcerpt:'Second observed source body.'};}});
 assert.deepEqual(calls,[urls[1]]);assert.equal(report.edits.length,2);assert.equal(report.edits[0].text,'First observed source body.');assert.equal(report.failed.length,0);assert.equal(report.pending.length,0);
});
test('SCP, Joke, EX, Tale and GoI all refetch even when their cached text is healthy',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'all-article-refresh-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'local-data/jp');fs.mkdirSync(dir,{recursive:true});
 const types=['scp-series','joke-scps','scp-ex','related-document-jp','related-document-jp'];
 const paths=['scp-001','scp-002-j','scp-003-ex','a-tale','a-goi-format'];
 const rows=paths.map((p,i)=>({itemId:p,pageType:types[i],urlJP:'https://scp-jp.wikidot.com/'+p,titleJP:'Current title',descriptionExcerpt:'An already cached, otherwise healthy description.',descriptionVersion:VERSION}));
 fs.writeFileSync(path.join(dir,'scp-data.json'),JSON.stringify({data:rows}));
 const calls=[];const report=await refreshArticleText({root,language:'jp',intervalMs:0,request:async url=>{calls.push(url);return {url,title:'Source title',descriptionExcerpt:'A freshly retrieved description for '+url};}});
 assert.deepEqual(new Set(calls),new Set(rows.map(r=>r.urlJP)));assert.equal(report.force,true);assert.equal(report.uniqueTargets,5);assert.equal(report.edits.length,5);
});
test('only a current invocation capture can satisfy a full refresh without a second network request',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'article-current-capture-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'local-data/jp'),captures=path.join(root,'partial-data/related-documents');fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(captures,{recursive:true});
 const url='https://scp-jp.wikidot.com/scp-173';fs.writeFileSync(path.join(dir,'scp-data.json'),JSON.stringify({data:[{urlJP:url,titleJP:'A valid title',descriptionExcerpt:'A cached description that must not skip this run.'}]}));
 const fresh={url,title:'SCP-173',descriptionVersion:VERSION,descriptionExcerpt:'The actual text fetched during this invocation.',contentSha256:'a'.repeat(64)};
 fs.writeFileSync(path.join(captures,crypto.createHash('sha256').update(url).digest('hex')+'.json'),JSON.stringify(fresh));
 const report=await refreshArticleText({root,language:'jp',intervalMs:0,request:async()=>{throw Error('Already fetched in this invocation');}});
 assert.equal(report.freshCaptures,1);assert.equal(report.requests,0);assert.equal(report.edits[0].text,fresh.descriptionExcerpt);
});


test('temporary source failures wait before retrying and share the result across cache variants',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'article-transient-retry-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'local-data/jp');fs.mkdirSync(dir,{recursive:true});
 const url='https://scp-jp.wikidot.com/scp-173';fs.writeFileSync(path.join(dir,'scp-data.json'),JSON.stringify({data:[{urlJP:url,titleJP:'An article',descriptionExcerpt:'First cached body.'},{urlJP:url,titleJP:'An article',descriptionExcerpt:'Another cached body.'}]}));
 let calls=0;const waits=[],timeouts=[];
 const report=await refreshArticleText({root,language:'jp',intervalMs:0,wait:async ms=>waits.push(ms),request:async(url,captureDirectory,options)=>{
  timeouts.push(options.timeoutMs);
  calls++;if(calls<3){const error=Error('Service unavailable');error.response={status:503,headers:{}};throw error;}
  return {url,title:'SCP-173',descriptionExcerpt:'Actual source prose after recovery.'};
 }});
 assert.equal(calls,3);assert.deepEqual(waits,[5000,15000]);assert.deepEqual(timeouts,[20000,40000,60000]);assert.equal(report.failed.length,0);assert.equal(report.edits.length,2);assert.ok(report.edits.every(e=>e.text==='Actual source prose after recovery.'));
});

test('retry delays respect bounded server guidance and do not retry permanent errors with backoff',()=>{
 const {retryDelayMs}=require('../tool/repair-catalog-excerpts');
 const error=(status,value)=>({response:{status,headers:{'retry-after':value}}});
 assert.equal(retryDelayMs(error(503,'30'),0),30000);
 assert.equal(retryDelayMs(error(429,'600'),1),60000);
 const now=Date.parse('2026-11-13T00:00:00Z');assert.equal(retryDelayMs(error(503,'Fri, 13 Nov 2026 00:00:40 GMT'),0,now),40000);
 assert.equal(retryDelayMs(error(503,'invalid'),1),15000);
 assert.equal(retryDelayMs(error(404,'30'),0),0);
 assert.equal(retryDelayMs(Error('Unsupported redirect'),0),0);
});
