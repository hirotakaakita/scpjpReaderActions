'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {refresh,targets}=require('../tool/refresh-joke-metadata');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'scp-joke-repair-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'local-data/jp');fs.mkdirSync(dir,{recursive:true});
 const stamp='2026-11-10T00:00:00Z',data=targets.map(([itemId,slug,listing])=>({itemId,urlJP:'http://scp-jp.wikidot.com/'+slug,titleJP:'',imageUrl:'https://example.com/wrong.jpg',pageType:listing,extractedFrom:listing,createdAt:stamp,lastUpdated:stamp}));
 const file=path.join(dir,'scp-data.json');fs.writeFileSync(file,JSON.stringify({language:'jp',timestamp:stamp,totalCount:data.length,data}));
 fs.writeFileSync(path.join(dir,'meta.json'),JSON.stringify({totalCount:data.length,lastUpdated:stamp}));
 const request=async url=>{
  const slug=new URL(url).pathname.slice(1);
  if(slug==='joke-scps'||slug==='joke-scps-jp')return '<ul>'+targets.filter(t=>t[2]===slug).map(([id,s])=>'<li><a href="/'+s+'">'+id+'</a> - Fixed '+id+'</li>').join('')+'</ul>';
  return '<div id="page-title">Article</div><div id="page-content"><p>Real article body.</p><img src="https://scp-jp.wdfiles.com/local--files/'+slug+'/own.jpg"></div>';
 };
 return {root,file,request,data};
}
test('targeted repair preserves IDs and creation times, updates metadata and is repeatable',async t=>{
 const f=fixture(t);
 const changed=await refresh({...f,captureSources:false,now:'2026-11-11T00:00:00Z'});
 assert.equal(changed.length,5);
 const source=JSON.parse(fs.readFileSync(f.file));
 for(let i=0;i<source.data.length;i++){
  const row=source.data[i];assert.equal(row.itemId,f.data[i].itemId);assert.equal(row.createdAt,f.data[i].createdAt);
  assert.equal(row.urlJP,f.data[i].urlJP);assert(row.titleJP.startsWith('Fixed '));assert(row.imageUrl.includes('/'+targets[i][1]+'/own.jpg'));
 }
 const before=fs.readFileSync(f.file,'utf8');
 assert.equal((await refresh({...f,captureSources:false,now:'2026-11-12T00:00:00Z'})).length,0);
 assert.equal(fs.readFileSync(f.file,'utf8'),before);
});
test('a failed target leaves all published source files unchanged',async t=>{
 const f=fixture(t),before=fs.readFileSync(f.file,'utf8');
 await assert.rejects(refresh({...f,captureSources:false,request:async url=>{
  if(url.endsWith('/scp-3482-jp-j'))throw Error('Request failed');return f.request(url);
 }}),/Request failed/);
 assert.equal(fs.readFileSync(f.file,'utf8'),before);
 assert(!fs.existsSync(path.join(f.root,'local-data/scp-data.json')));
});
