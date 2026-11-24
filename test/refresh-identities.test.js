'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const {selectTargets,refresh,freshCapture}=require('../research-board/refresh-identities');
const {digest,makeRecord}=require('../research-board/extract');
const node=(origin,site,slug)=>{const n=[];n[8]=origin;n[13]=[[site,`https://${site==='cn'?'scp-wiki-cn.wikidot.com':site==='jp'?'scp-jp.wikidot.com':'lafundacionscp.wikidot.com'}/${slug}`,slug]];return n;};
test('fresh FTML evidence uses the full response hash independently of the catalog source hash',()=>{
 const current={url:'https://scpfoundation.net/story',format:'ftml',contentSha256:'source-hash'},record={...current,contentSha256:'response-hash',checkedAt:'2026-11-08T12:00:00Z'};
 assert.equal(freshCapture(record,current,Date.parse('2026-11-08T11:59:59Z')),true);
 assert.equal(freshCapture(record,current,Date.parse('2026-11-08T12:00:01Z')),false);
 assert.equal(freshCapture({...record,format:'html'},{...current,format:'html'},0),false);
 assert.equal(freshCapture({...record,url:'https://scpfoundation.net/other'},current,0),false);
});
test('identity backfill is limited to collected unresolved versions and never follows an original URL',async t=>{
 const board={nodes:[node('jp','cn','translated'),node('jp','es','translated'),node('jp','jp','unrelated'),node('jp','cn','isolated')]};
 const targets=selectTargets(board);assert.equal(targets.candidateNodes,2);assert.equal(targets.pages.length,2);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'identity-refresh-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'local-data/mobile-v3/research-board');fs.mkdirSync(dir,{recursive:true});const bytes=zlib.gzipSync(JSON.stringify(board)),fileName='board-'+digest(bytes)+'.json.gz';
 fs.writeFileSync(path.join(dir,fileName),bytes);fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({sha256:digest(bytes),fileName}));
 const calls=[],request=async url=>{calls.push(url);return makeRecord(url,'<title>Tale</title><div id="page-content"><p>'+('Story text. '.repeat(20))+'</p><div class="credit"><p>元記事: <a href="https://scp-jp.wikidot.com/uncollected">original</a></p></div></div>');};
 const a=await refresh({root,request,maxRequests:1,intervalMs:0});assert.equal(a.updated,1);assert.equal(a.complete,false);
 const b=await refresh({root,request,maxRequests:10,intervalMs:0});assert.equal(b.updated,1);assert.equal(b.complete,true);
 assert.equal(calls.length,2);assert(calls.every(url=>url.endsWith('/translated')));
});
