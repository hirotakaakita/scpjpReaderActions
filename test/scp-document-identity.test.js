'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {reclassifyScpArticle}=require('../article-category');
const {scpIdentity,buildIndexedCatalog}=require('../merge-catalog-indexes');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),z=require('node:zlib');
const {generateMobileCatalogs}=require('../mobile-catalog');

const url='https://scpfoundation.net/scp-la-002';
const original={itemId:'document-ru--scp-la-002',titleJP:'SCP-LA-002 - \u0424\u0440\u0443\u043a\u0442',urlJP:url,pageType:'scp-series-la',extractedFrom:'scp-series-la',contentType:'scp',numericItemId:2,tags:[],imageUrl:'https://example.com/photo.png',lastUpdated:'2026-11-01T00:00:00Z'};

test('cached classified SCP documents receive numeric SCP IDs without changing their titles or content',()=>{
 const result=reclassifyScpArticle(original);
 assert.deepEqual(result,{...original,itemId:'scp-series-la-002'});
 assert.deepEqual(reclassifyScpArticle(result),result);
 for(const kind of ['archive','tale','record','goi']){
  const row={...original,pageType:'related-document-la',contentType:kind};
  assert.deepEqual(reclassifyScpArticle(row),row);
 }
 const archived={...original,tags:['archived']};
 assert.equal(reclassifyScpArticle(archived).itemId,original.itemId);
 assert.equal(reclassifyScpArticle(archived).contentType,'archive');
 const supplement={...original,urlJP:url+'-supplement',tags:['supplement']};
 assert.equal(reclassifyScpArticle(supplement).itemId,original.itemId);
 assert.equal(reclassifyScpArticle(supplement).contentType,'record');
 assert.deepEqual(reclassifyScpArticle(original,new Set(['scp-series-la-002'])),original);
});

test('official-index reruns canonicalize SCP placeholders even when another catalog retained one',()=>{
 const page={url,slug:'scp-la-002'},record={title:original.titleJP,tags:[],checkedAt:original.lastUpdated,status:'success',contentSha256:'a'.repeat(64),descriptionExcerpt:'A valid source description'};
 const ids=new Set([original.itemId]);ids.nativeIds=new Set([original.itemId]);
 assert.equal(scpIdentity(page,record,'la',new Map([['scp-series-la:002',ids]])).itemId,'scp-series-la-002');
 const state={indexes:{x:{members:[{url,kind:'scp',source:'https://scpfoundation.net/scp-international',origin:'la'}]}},records:{[url]:record},attempts:{}};
 const previous={data:[{url,language:'ru',itemId:original.itemId}]};
 const first=buildIndexedCatalog([],{ru:state},previous,original.lastUpdated);
 assert.equal(first.data[0].itemId,'scp-series-la-002');
 assert.equal(first.data[0].title,original.titleJP);
 assert.equal(buildIndexedCatalog([],{ru:state},first,original.lastUpdated).data[0].itemId,'scp-series-la-002');
});

test('delivery normalizes SCP document IDs and translation links without combining distinct same-number works',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'scp-document-id-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const input=path.join(root,'local-data'),date=original.lastUpdated;
 const la={...original,itemId:'scp-series-la-002',urlJP:'https://scp-la.wikidot.com/scp-la-002',titleJP:'SCP-LA-002'};
 const it={...original,itemId:'scp-series-it-003',urlJP:'https://fondazionescp.wikidot.com/scp-003-it',pageType:'scp-series-it',extractedFrom:'scp-series-it',numericItemId:3};
 const other={...it,itemId:'document-it--scp-it-003',urlJP:'https://fondazionescp.wikidot.com/scp-it-003',titleJP:'SCP-IT-003'};
 for(const [language,data] of [['ru',[original]],['la',[la]],['it',[it,other]]]){
  const dir=path.join(input,language);fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'scp-data.json'),JSON.stringify({language,timestamp:date,totalCount:data.length,data:data.map(r=>({...r,isTranslatedJP:true}))}));
  fs.writeFileSync(path.join(dir,'meta.json'),JSON.stringify({lastUpdated:date,totalCount:data.length}));
 }
 generateMobileCatalogs(input);
 function read(channel,language){const dir=path.join(input,channel,language),m=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));return JSON.parse(z.gunzipSync(fs.readFileSync(path.join(dir,m.fileName))));}
 const ru=read('mobile-v3','ru').data[0];assert.equal(ru.itemId,'scp-series-la-002');assert.equal(ru.titleJP,original.titleJP);
 assert.deepEqual(ru.translatedLanguages,['la','ru']);assert.deepEqual(read('mobile-v3','la').data[0].translatedLanguages,['la','ru']);
 assert.equal(read('mobile-v2','ru').data[0].itemId,original.itemId);
 assert.deepEqual(read('mobile-v3','it').data.map(r=>r.itemId),[it.itemId,other.itemId]);
 const manifest=fs.readFileSync(path.join(input,'mobile-v3/ru/manifest.json'),'utf8');generateMobileCatalogs(input);
 assert.equal(fs.readFileSync(path.join(input,'mobile-v3/ru/manifest.json'),'utf8'),manifest);
 const url=other.urlJP,record={title:other.titleJP,tags:[],checkedAt:date,status:'success',contentSha256:'b'.repeat(64),descriptionExcerpt:'Another distinct work'};
 const state={indexes:{x:{members:[{url,kind:'scp',source:'https://fondazionescp.wikidot.com/scp-international',origin:'it'}]}},records:{[url]:record},attempts:{}};
 const result=buildIndexedCatalog([{...it,language:'it'}],{it:state},{data:[{url,language:'it',itemId:other.itemId}]},date);
 assert.equal(result.data[0].itemId,other.itemId);
});
