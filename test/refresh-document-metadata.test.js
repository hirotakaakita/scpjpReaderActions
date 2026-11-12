'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {refresh}=require('../tool/refresh-document-metadata');
const {readState,writeState}=require('../catalog-indexes');
const {loadCache,saveCache}=require('../related-documents');

test('metadata refresh repairs retained indexes and caches; failed fetches leave all records intact',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'document-metadata-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const urls=['https://scp-jp.wikidot.com/proposition-de-projet-2019-319','https://scp-jp.wikidot.com/example-story'];
 const records=Object.fromEntries(urls.map(url=>[url,{url,language:'jp',title:'Article',descriptionExcerpt:'rating: +15+-x Old body',checkedAt:'2026-11-01T00:00:00Z',contentSha256:'a'.repeat(64),availabilityVersion:1}]));
 const file=path.join(root,'local-data/catalog-indexes/jp.json.gz');
 writeState(file,{schemaVersion:1,language:'jp',records,indexes:{},attempts:{}});
 const cache=path.join(root,'local-data/related-document-cache');saveCache(cache,new Map(Object.entries(records)),new Map());
 const before=fs.readFileSync(file);
 await assert.rejects(()=>refresh({root,urls,request:async url=>{if(url===urls[1])throw Error('Temporary failure');return {...records[url],descriptionExcerpt:'Name: Actual body'};}}),/Temporary failure/);
 assert.deepEqual(fs.readFileSync(file),before);assert.deepEqual(Object.fromEntries(loadCache(cache).records),records);
 await refresh({root,urls,request:async url=>({...records[url],descriptionExcerpt:'Name: Actual body',checkedAt:'2026-11-12T00:00:00Z'})});
 for(const url of urls){assert.equal(readState(file).records[url].descriptionExcerpt,'Name: Actual body');assert.equal(loadCache(cache).records.get(url).descriptionExcerpt,'Name: Actual body');}
 await assert.rejects(()=>refresh({root,urls:['https://example.com/invalid']}),/Unsupported/);
});
