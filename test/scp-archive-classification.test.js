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

test('French archived translations are archives, including missing and localized tags',()=>{
 for(const tags of [['scp','archivé'],[{id:'tag-localized',label:'Archivé'}],['archive\u0301']]) {
  assert.equal(articleCategory({tags},[],'https://fondationscp.wikidot.com/scp-039-t'),'archive');
  assert.equal(articleCategory({tags},[],'https://fondationscp.wikidot.com/old-translation'),'archive');
 }
 for(const slug of ['scp-039-t','scp-007-it-t','scp-fr-039-t','scp-039-j-t']) {
  const url='https://fondationscp.wikidot.com/'+slug+'?utm_source=test#credits';
  assert.equal(articleCategory({tags:['scp']},[],url),'archive');
  assert.equal(scpIdentity({slug,url},{tags:['scp']},'en',new Map()),null);
 }
 for(const url of ['https://scp-jp.wikidot.com/scp-039-t','https://fondationscp.wikidot.com/scp-039','https://fondationscp.wikidot.com/scp-039-th','https://fondationscp.wikidot.com/a-t','https://fondationscp.wikidot.com/local--files/scp-039-t/image.png']) {
  assert.equal(articleCategory({tags:['scp']},[],url),'other');
 }
});

test('French archive correction keeps origin and stable identity when rerun',()=>{
 const samples=[
  {...row('scp-039-t'),urlJP:'https://fondationscp.wikidot.com/scp-039-t'},
  {...row('scp-007-it-t'),urlJP:'https://fondationscp.wikidot.com/scp-007-it-t',pageType:'scp-series-it'},
  {...row('old-translation',['archivé']),urlJP:'https://fondationscp.wikidot.com/old-translation',pageType:'related-document-en'},
 ];
 for(const before of samples) {
  const after=reclassifyScpArticle(before);
  assert.equal(after.contentType,'archive');
  assert.equal(after.pageType,before.pageType.endsWith('-it')?'related-document-it':'related-document-en');
  for(const key of ['itemId','urlJP','createdAt','lastUpdated']) assert.equal(after[key],before[key]);
  assert.deepEqual(reclassifyScpArticle(after),after);
 }
});

test('FR mobile-v3 moves old translations out of series without changing legacy delivery',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'scp-fr-archive-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const input=path.join(root,'local-data');fs.mkdirSync(path.join(input,'fr'),{recursive:true});
 const rows=['scp-039','scp-039-t','scp-007-it-t'].map(slug=>({...row(slug),urlJP:'https://fondationscp.wikidot.com/'+slug}));
 fs.writeFileSync(path.join(input,'fr/scp-data.json'),JSON.stringify({language:'fr',timestamp:date,totalCount:rows.length,data:rows}));
 fs.writeFileSync(path.join(input,'fr/meta.json'),JSON.stringify({lastUpdated:date,totalCount:rows.length}));
 generateMobileCatalogs(input);
 const read=channel=>{const dir=path.join(input,channel,'fr'),m=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir,m.fileName))));};
 const v3=read('mobile-v3');
 assert.deepEqual(v3.data.map(r=>r.contentType),['scp','archive','archive']);
 assert.deepEqual(v3.data.map(r=>r.pageType),['scp-series','related-document-en','related-document-it']);
 assert.deepEqual(v3.data.map(r=>r.itemId),rows.map(r=>r.itemId));
 for(const channel of ['mobile-v1','mobile-v2'])assert(read(channel).data.every(r=>r.pageType==='scp-series'&&r.contentType==='scp'));
 const stable=fs.readFileSync(path.join(input,'mobile-v3/fr/manifest.json'),'utf8');generateMobileCatalogs(input);assert.equal(fs.readFileSync(path.join(input,'mobile-v3/fr/manifest.json'),'utf8'),stable);
});
test('Tales and archives are not classified as numbered SCPs',()=>{
 assert.equal(scpIdentity({slug:'scp-2',url:'https://scp-jp.wikidot.com/scp-2'},{tags:['tale']},'en',new Map()),null);
 assert.equal(scpIdentity({slug:'scp-013-arc',url:'https://scp-jp.wikidot.com/scp-013-arc'},{tags:['scp']},'en',new Map()),null);
 assert.equal(scpIdentity({slug:'scp-002',url:'https://scp-jp.wikidot.com/scp-002'},{tags:['scp']},'en',new Map()).pageType,'scp-series');
 assert.equal(scpIdentity({slug:'scp-002-kz'},{tags:['scp','kz']},'kz',new Map()).pageType,'scp-series-kz');
 assert.equal(scpIdentity({slug:'scp-001',url:'https://scp-jp.wikidot.com/scp-001'},{tags:['hub']},'en',new Map()).pageType,'scp-series');
 assert.equal(reclassifyScpArticle(row('scp-001',[{id:'hub',label:'Hub'}])).pageType,'scp-series');
});

test('Spanish VO versions are archives across article kinds and tag representations',()=>{
 for(const slug of ['scp-es-046-vo','scp-986-vo','scp-173-j-vo','decomm:scp-083-d-vo','a-night-at-the-movies-vo','2722tech-vo']) {
  const url='https://lafundacionscp.wikidot.com/'+slug+'?utm_source=test#credits';
  assert.equal(articleCategory({tags:[]},[],url),'archive');
  assert.equal(scpIdentity({slug,url},{tags:[]},'en',new Map()),null);
 }
 for(const tags of [['vo','relato'],[{id:'tag-localized',label:'VO'}],['hub','vo']]) {
  assert.equal(articleCategory({tags},[],'https://lafundacionscp.wikidot.com/alerta'),'archive');
 }
 assert.equal(articleCategory({tags:['vo','tale']},[],'https://scp-int.wikidot.com/unofficial:vo:scp-173'),'tale');
 for(const url of ['https://scp-int.wikidot.com/scp-173-vo','https://lafundacionscp.wikidot.com/scp-es-046','https://lafundacionscp.wikidot.com/scp-173-voiced','https://lafundacionscp.wikidot.com/local--files/scp-173-vo/image.png']) {
  assert.equal(articleCategory({tags:[]},[],url),'other');
 }
});

test('Spanish VO reclassification preserves branches and user identity on rerun',()=>{
 for(const slug of ['scp-es-046-vo','scp-986-vo','scp-173-j-vo','decomm:scp-083-d-vo']) {
  const before={...row(slug),urlJP:'https://lafundacionscp.wikidot.com/'+slug};
  const after=reclassifyScpArticle(before);
  assert.equal(after.contentType,'archive');
  assert.equal(after.pageType,slug==='scp-es-046-vo'?'related-document-es':'related-document-en');
  for(const key of ['itemId','urlJP','createdAt','lastUpdated'])assert.equal(after[key],before[key]);
  assert.deepEqual(reclassifyScpArticle(after),after);
 }
 const doc={...row('alerta',['vo','relato']),urlJP:'https://lafundacionscp.wikidot.com/alerta',pageType:'related-document-en',contentType:'tale'};
 assert.equal(reclassifyScpArticle(doc).contentType,'archive');
});

test('ES mobile-v3 publishes VO as archives while keeping live versions and legacy delivery',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'scp-es-archive-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const input=path.join(root,'local-data');fs.mkdirSync(path.join(input,'es'),{recursive:true});
 const rows=['scp-es-046','scp-es-046-vo','scp-986-vo'].map(slug=>({...row(slug),urlJP:'https://lafundacionscp.wikidot.com/'+slug}));
 fs.writeFileSync(path.join(input,'es/scp-data.json'),JSON.stringify({language:'es',timestamp:date,totalCount:rows.length,data:rows}));
 fs.writeFileSync(path.join(input,'es/meta.json'),JSON.stringify({lastUpdated:date,totalCount:rows.length}));
 generateMobileCatalogs(input);
 const read=channel=>{const dir=path.join(input,channel,'es'),m=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir,m.fileName))));};
 const v3=read('mobile-v3');
 assert.deepEqual(v3.data.map(r=>r.contentType),['scp','archive','archive']);
 assert.deepEqual(v3.data.map(r=>r.pageType),['scp-series-es','related-document-es','related-document-en']);
 assert.deepEqual(v3.data.map(r=>r.itemId),rows.map(r=>r.itemId));
 for(const channel of ['mobile-v1','mobile-v2'])assert(read(channel).data.every(r=>r.pageType==='scp-series'&&r.contentType==='scp'));
 const stable=fs.readFileSync(path.join(input,'mobile-v3/es/manifest.json'),'utf8');generateMobileCatalogs(input);assert.equal(fs.readFileSync(path.join(input,'mobile-v3/es/manifest.json'),'utf8'),stable);
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
