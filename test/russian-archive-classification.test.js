'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),os=require('os'),z=require('zlib');
const {articleCategory,reclassifyScpArticle}=require('../article-category');
const {scpIdentity}=require('../merge-catalog-indexes');
const {generateMobileCatalogs}=require('../mobile-catalog');
const dictionary=require('../tag-dictionary.json');
const archiveId=Object.keys(dictionary.tags).find(id=>dictionary.tags[id].aliases.includes('тип:архив'));
const versionId=Object.keys(dictionary.tags).find(id=>dictionary.tags[id].aliases.includes('тип:-v'));
const base='https://scpfoundation.net/',date='2026-11-12T00:00:00Z';

test('Russian archive markers cover source tags, localized labels, hashed IDs and numbered old versions',()=>{
 assert(archiveId&&versionId);
 for(const tags of [['тип:архив'],['тип:-v'],[{id:'localized',label:'Тип:Архив'}],[archiveId],[versionId]])
  assert.equal(articleCategory({tags},[],base+'old-story'),'archive');
 for(const slug of ['scp-009-v','scp-500-j-v','scp-031-v-1','roget-s-proposal-v'])
  assert.equal(articleCategory({tags:[]},[],base+slug+'?utm_source=test#credits'),'archive');
 assert.equal(articleCategory({tags:[]},[],'https://scp-jp.wikidot.com/scp-009-v'),'other');
 assert.equal(articleCategory({tags:[]},[],base+'scp-009'),'other');
 assert.equal(articleCategory({tags:[]},[],base+'scp-123-d'),'other');
});

test('Russian archive classification outranks Joke identity and retains regular live versions',()=>{
 for(const slug of ['scp-500-j-v','scp-1121-ru-j-v','scp-3112-ru-j-d']){
  const url=base+slug,tags=['тип:шуточный',archiveId];
  assert.equal(articleCategory({tags},[],url),'archive');
  assert.equal(scpIdentity({slug,url},{tags},'ru',new Map()),null);
  const before={itemId:'joke-scps-ru-'+slug.slice(4),urlJP:url,pageType:'joke-scps-ru',extractedFrom:'joke-scps-ru',contentType:'scp',tags,createdAt:date,lastUpdated:date};
  const after=reclassifyScpArticle(before);assert.equal(after.contentType,'archive');assert.equal(after.pageType,'related-document-ru');
  for(const key of ['itemId','urlJP','createdAt','lastUpdated'])assert.equal(after[key],before[key]);
  assert.deepEqual(reclassifyScpArticle(after),after);
 }
 assert.equal(scpIdentity({slug:'scp-008-de-j',url:base+'scp-008-de-j'},{tags:['тип:шуточный']},'de',new Map()).pageType,'joke-scps-de');
});

test('v3 repairs retained Russian archives without changing old delivery contracts or live articles',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ru-archive-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const input=path.join(root,'local-data'),dir=path.join(input,'ru');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(root,'tag-dictionary.json'),JSON.stringify({version:1,tags:{[archiveId]:dictionary.tags[archiveId]}}));
 const data=['scp-009','scp-009-v','scp-031-v-1','scp-500-j-v','scp-123-d'].map((slug,n)=>({itemId:'scp-series-'+slug.slice(4),titleJP:slug.toUpperCase(),urlJP:base+slug,isTranslatedJP:true,pageType:'scp-series',extractedFrom:'scp-series',contentType:'scp',numericItemId:n,createdAt:date,lastUpdated:date,tags:slug==='scp-123-d'?[archiveId]:[]}));
 const saved=JSON.stringify({language:'ru',timestamp:date,totalCount:data.length,data});
 fs.writeFileSync(path.join(dir,'scp-data.json'),saved);fs.writeFileSync(path.join(dir,'meta.json'),JSON.stringify({lastUpdated:date,totalCount:data.length}));
 generateMobileCatalogs(input);
 const read=c=>{const p=path.join(input,c,'ru'),m=JSON.parse(fs.readFileSync(path.join(p,'manifest.json')));return JSON.parse(z.gunzipSync(fs.readFileSync(path.join(p,m.fileName))));};
 assert.deepEqual(read('mobile-v3').data.map(r=>r.contentType),['scp','archive','archive','archive','archive']);
 assert.deepEqual(read('mobile-v3').data.map(r=>r.itemId),data.map(r=>r.itemId));
 assert.equal(read('mobile-v3').data.at(-1).tags[0].label,'тип:архив');
 for(const c of ['mobile-v1','mobile-v2'])assert(read(c).data.every(r=>r.contentType==='scp'));
 assert.equal(fs.readFileSync(path.join(dir,'scp-data.json'),'utf8'),saved);
 const manifest=fs.readFileSync(path.join(input,'mobile-v3/ru/manifest.json'),'utf8');generateMobileCatalogs(input);
 assert.equal(fs.readFileSync(path.join(input,'mobile-v3/ru/manifest.json'),'utf8'),manifest);
});
