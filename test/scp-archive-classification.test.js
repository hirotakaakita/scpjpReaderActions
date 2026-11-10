'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),zlib=require('node:zlib');
const {articleCategory,reclassifyScpArticle}=require('../article-category');
const {scpIdentity}=require('../merge-catalog-indexes');
const {generateMobileCatalogs}=require('../mobile-catalog');
const date='2026-11-11T00:00:00Z';
function row(slug,tags=[]){return {itemId:'scp-series-'+slug.slice(4),titleJP:slug.toUpperCase(),urlJP:'https://scp-jp.wikidot.com/'+slug,numericItemId:2,pageType:'scp-series',extractedFrom:'scp-series',contentType:'scp',isTranslatedJP:true,lastUpdated:date,createdAt:date,tags};}
test('archive markers outrank SCP-shaped paths while ordinary words do not',()=>{
 for(const url of ['https://scp-jp.wikidot.com/scp-013-arc','https://scp-jp.wikidot.com/archived:some-work']) assert.equal(articleCategory({tags:['scp']},[],url),'archive');
 assert.equal(articleCategory({tags:['アーカイブ済み']}),'archive');
 assert.equal(articleCategory({tags:['tale']},[],'https://scp-jp.wikidot.com/the-archive'),'tale');
});
test('Tales and archives are not classified as numbered SCPs',()=>{
 assert.equal(scpIdentity({slug:'scp-2',url:'https://scp-jp.wikidot.com/scp-2'},{tags:['tale']},'en',new Map()),null);
 assert.equal(scpIdentity({slug:'scp-013-arc',url:'https://scp-jp.wikidot.com/scp-013-arc'},{tags:['scp']},'en',new Map()),null);
 assert.equal(scpIdentity({slug:'scp-002',url:'https://scp-jp.wikidot.com/scp-002'},{tags:['scp']},'en',new Map()).pageType,'scp-series');
 assert.equal(scpIdentity({slug:'scp-002-kz'},{tags:['scp','kz']},'kz',new Map()).pageType,'scp-series-kz');
 assert.equal(scpIdentity({slug:'scp-001',url:'https://scp-jp.wikidot.com/scp-001'},{tags:['hub']},'en',new Map()).pageType,'scp-series');
 assert.equal(reclassifyScpArticle(row('scp-001',[{id:'hub',label:'Hub'}])).pageType,'scp-series');
});
test('reclassification preserves user IDs, timestamps and article URLs',()=>{
 const samples=[[row('scp-2',[{id:'tale',label:'Tale'}]),'tale','related-document-en'],[row('scp-013-arc'),'archive','related-document-en'],[row('scp-002-kz'),'scp','scp-series-kz']];
 for(const [before,category,type] of samples){const after=reclassifyScpArticle(before);assert.equal(after.contentType,category);assert.equal(after.pageType,type);for(const key of ['itemId','createdAt','lastUpdated','urlJP'])assert.equal(after[key],before[key]);}
});
test('published v3 separates archives and Tales while v1/v2 and bookmark IDs stay stable',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'scp-archive-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const input=path.join(root,'local-data');fs.mkdirSync(path.join(input,'jp'),{recursive:true});
 const rows=[row('scp-002'),row('scp-2',[{id:'tale',label:'Tale'}]),row('scp-013-arc'),row('scp-002-kz')];
 fs.writeFileSync(path.join(input,'jp/scp-data.json'),JSON.stringify({language:'jp',timestamp:date,totalCount:rows.length,data:rows}));
 fs.writeFileSync(path.join(input,'jp/meta.json'),JSON.stringify({lastUpdated:date,totalCount:rows.length}));
 generateMobileCatalogs(input);
 function read(channel){const dir=path.join(input,channel,'jp'),m=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir,m.fileName))));}
 const v3=read('mobile-v3');assert.deepEqual(v3.data.map(r=>r.contentType),['scp','tale','archive','scp']);assert.deepEqual(v3.data.map(r=>r.itemId),rows.map(r=>r.itemId));
 assert.deepEqual(v3.data.filter(r=>r.pageType==='scp-series').map(r=>r.itemId),['scp-series-002']);
 for(const channel of ['mobile-v1','mobile-v2'])assert(read(channel).data.every(r=>r.pageType==='scp-series'));
 const stable=fs.readFileSync(path.join(input,'mobile-v3/jp/manifest.json'),'utf8');generateMobileCatalogs(input);assert.equal(fs.readFileSync(path.join(input,'mobile-v3/jp/manifest.json'),'utf8'),stable);
});
