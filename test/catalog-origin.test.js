'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {resolveOrigin,publisherDefaultOrigin,publisherOriginTags}=require('../catalog-origin');
const {originHint,parseIndex}=require('../catalog-indexes');
const {buildIndexedCatalog}=require('../merge-catalog-indexes');
const unknown={branch:null,basis:'insufficient_origin_evidence',evidence:[]};
const resolve=(tags,evidence,fallback=unknown)=>resolveOrigin({tags},evidence,fallback,originHint);

test('CN original short-story collection supplies origin without treating arbitrary CN pages as originals',()=>{
 const source='https://scp-wiki-cn.wikidot.com/short-stories';
 assert.equal(resolve([], [{source}]).branch,'cn');
 assert.equal(resolve([], [{source:source+'/p/2'}]).branch,'cn');
 assert.equal(resolve([], [{source:'https://scp-jp.wikidot.com/short-stories'}]).branch,null);
 assert.equal(resolve([], [{source:source+'-translations'}]).branch,null);
 assert.equal(resolve(['翻译'],[{source}]).branch,null);
 assert.equal(resolve([], [{source}],{branch:'jp',basis:'publisher_origin_tag'}).branch,'jp');
 assert.equal(resolve([], [{source}],{branch:null,basis:'unresolved_interwiki_origin'}).branch,null);
});
test('article provenance overrides conflicting or incorrect index origins',()=>{
 const fallback={branch:'jp',basis:'publisher_origin_tag',evidence:['jp']};
 assert.equal(resolve(['jp'],[{source:'https://scp-jp.wikidot.com/foundation-tales-jp',origin:'pl'}],fallback).branch,'jp');
 assert.equal(resolve(['jp','en'],[],{branch:null,basis:'conflicting_origin_tags'}).branch,null);
});
test('native English collections do not classify translations by hosting site',()=>{
 const en=[{source:'https://scp-wiki.wikidot.com/foundation-tales',origin:'pl',section:'Other stories'}];
 assert.equal(resolve(['tale'],en).branch,'en');
 assert.equal(resolve(['translated'],en).branch,null);
 assert.equal(resolve(['tale'],[{source:'https://scp-wiki-cn.wikidot.com/foundation-tales'}]).branch,null);
 assert.equal(resolve(['tale'],en,{branch:'jp',basis:'publisher_origin_tag'}).branch,'jp');
 assert.equal(resolve(['tale'],[{source:'https://scp-wiki.wikidot.com/foundation-tales-audio-edition'}]).branch,null);
 assert.equal(resolve(['relato'],[{source:'https://lafundacionscp.wikidot.com/relatos-de-la-fundacion'}]).branch,'en');
 assert.equal(resolve(['relato'],[{source:'https://lafundacionscp.wikidot.com/relatos-de-la-fundacion-hispanoparlante'}]).branch,'es');
 assert.equal(resolve(['relato'],[{source:'https://lafundacionscp.wikidot.com/relatos-de-la-fundacion'}],{branch:'jp',basis:'publisher_origin_tag'}).branch,'jp');
});
test('invalid URL suffixes and inherited heading origins are not branch evidence',()=>{
 assert.equal(originHint('https://scp-wiki-cn.wikidot.com/log-of-anomalous-items-cn'),'cn');
 assert.equal(originHint('https://scp-wiki-cn.wikidot.com/log-of-anomalous-items'),null);
 for(const name of ['foundation-tales-arc','canon-hub','foundation-tales-unofficial'])assert.equal(originHint('https://scpko.wikidot.com/'+name),null);
 assert.equal(resolve([], [{source:'https://scpko.wikidot.com/foundation-tales-arc',origin:'arc'}]).branch,null);
 assert.equal(resolve([], [{source:'https://scp-jp.wikidot.com/a-hub',origin:'pl',section:'Other works'}]).branch,null);
 assert.equal(resolve([], [{source:'https://scp-jp.wikidot.com/a-hub',origin:'pl',section:'SCP-PL'}]).branch,'pl');
});
test('index heading scope resets for sibling sections and is preserved for subsections',()=>{
 const html='<div id="page-content"><h2>SCP-PL</h2><ul><li><a href="/a">a</a></li></ul><h3>More</h3><ul><li><a href="/b">b</a></li></ul><h2>Other stories</h2><ul><li><a href="/c">c</a></li></ul></div>';
 const result=parseIndex(html,{url:'https://scp-jp.wikidot.com/foundation-tales-jp',kind:'tale'},new Set());
 assert.deepEqual(result.members.map(m=>m.origin),['pl','pl','jp']);
});
test('explicit cross-site translation metadata uses already collected records and preserves item IDs',()=>{
 const en='https://scp-wiki.wikidot.com/original',jp='https://scp-jp.wikidot.com/translated';
 const record=(url,tags,translations=[])=>({url,title:'Work',tags,translations,checkedAt:'2026-11-08T00:00:00Z',contentSha256:'a'.repeat(64),availabilityVersion:1,descriptionExcerpt:'Body'});
 const state=(url,rec,source)=>({indexes:{x:{members:[{url,source,kind:'tale'}]}},records:{[url]:rec},attempts:{}});
 const result=buildIndexedCatalog([],{en:state(en,record(en,['_jp']),'https://scp-wiki.wikidot.com/foundation-tales'),jp:state(jp,record(jp,['tale'],[en]),'https://scp-jp.wikidot.com/foundation-tales')},{data:[{url:jp,itemId:'document-existing',language:'jp'}]});
 const row=result.data.find(r=>r.url===jp);assert.equal(row.pageType,'related-document-jp');assert.equal(row.itemId,'document-existing');
});
const {classify}=require('../related-documents');
const infer=(url,tags)=>classify(url,new Map([[url,{url,tags,translations:[]}]]),new Map());
test('publisher native tags are scoped to the actual site, not translated by text similarity',()=>{
 assert.equal(infer('https://scp-wiki-cn.wikidot.com/story',['原创','故事']).branch,'cn');
 assert.equal(infer('https://scp-zh-tr.wikidot.com/story',['原創','故事']).branch,'zh');
 assert.equal(infer('https://scp-jp.wikidot.com/story',['原创']).branch,null);
 assert.equal(infer('https://scp-wiki-cn.wikidot.com/story',['原创','jp','故事']).basis,'conflicting_origin_tags');
 assert.equal(infer('https://scp-pl.wikidot.com/story',['oryginał','opowiadanie']).branch,'pl');
 assert.equal(infer('https://scp-pl.wikidot.com/story',['oryginał','tłumaczenie']).basis,'conflicting_origin_tags');
 assert.equal(infer('https://scp-pl.wikidot.com/story',['tłumaczenie']).branch,null);
 assert.equal(infer('https://scp-jp.wikidot.com/story',['oryginał']).branch,null);
});
test('EN hidden language tags identify the original branch without treating international as INT',()=>{
 assert.equal(infer('https://scp-wiki.wikidot.com/story',['international','_jp','tale']).branch,'jp');
 assert.equal(infer('https://scp-wiki.wikidot.com/story',['international','_ms','tale']).branch,'ms');
 assert.equal(infer('https://scp-wiki.wikidot.com/story',['international','tale']).branch,null);
 assert.equal(infer('https://scp-jp.wikidot.com/story',['_jp']).branch,null);
});

test('German written-out origin tags take priority over the English translation default',()=>{
 const url='https://scp-wiki-de.wikidot.com/story';
 for(const [tag,branch] of [['deutsch','de'],['französisch','fr'],['japanisch','jp'],['traditionelles-chinesisch','zh'],['lateinisch','la']]) {
   const result=infer(url,[tag,'geschichte',...(branch==='de'?[]:['übersetzt'])]);
   assert.equal(result.branch,branch);
   assert.equal(result.basis,'publisher_origin_tag');
   assert.equal(infer('https://scp-jp.wikidot.com/story',[tag]).branch,null);
 }
 assert.equal(infer(url,['übersetzt','fr','französisch']).branch,'fr');
 assert.equal(infer(url,['übersetzt','französisch','japanisch']).basis,'conflicting_origin_tags');
 assert.equal(infer(url,['deutsch','jp']).basis,'conflicting_origin_tags');
 assert.equal(infer(url,['übersetzt','sh','deutsch']).basis,'conflicting_origin_tags');
 assert.equal(infer(url,['übersetzt','uk','deutsch']).basis,'unsupported_origin_tag');
});

test('Czech and Slovak original tags identify separate branches on the shared publisher',()=>{
 const url='https://scp-cs.wikidot.com/story';
 assert.equal(infer(url,['české','tale']).branch,'cs');
 assert.equal(infer(url,['slovenské','tale']).branch,'sk');
 assert.equal(infer(url,['české','slovenské']).basis,'conflicting_origin_tags');
 assert.equal(infer(url,['české','en']).basis,'conflicting_origin_tags');
 assert.equal(infer('https://scp-jp.wikidot.com/story',['české']).branch,null);
 assert.equal(infer(url,['tale']).branch,null);
});

test('localized origin tags flow into the catalog without changing article IDs or membership',()=>{
 const languages=[['de','scp-wiki-de','deutsch'],['cs','scp-cs','české']];
 const states={},previous={data:[]};
 for(const [language,host,tag] of languages){
   const url=`https://${host}.wikidot.com/story`,source=`https://${host}.wikidot.com/foundation-tales`;
   states[language]={indexes:{[source]:{members:[{url,source,kind:'tale'}]}},records:{[url]:{url,title:'Story',tags:[tag,'tale'],availabilityVersion:1,contentSha256:'a'.repeat(64),checkedAt:'2026-11-09T00:00:00Z'}},attempts:{}};
   previous.data.push({url,language,itemId:`document-${language}--story`,pageType:'related-document-unclassified'});
 }
 const result=buildIndexedCatalog([],states,previous);
 assert.equal(result.data.length,previous.data.length);
 for(const row of result.data){
   assert.equal(row.itemId,previous.data.find(r=>r.url===row.url).itemId);
   assert.equal(row.pageType,`related-document-${row.language}`);
   assert.equal(row.classification.basis,'publisher_origin_tag');
 }
});

test('incubator source catalog fixes origin while retaining the published document identity',()=>{
 const source='https://scp-wiki.wikidot.com/scp-682',url='https://scp-int.wikidot.com/unofficial:ca:scp-682';
 const index='https://scp-int.wikidot.com/unofficial:language-incubator-hub';
 const seed={language:'en',itemId:'scp-series-682',pageType:'scp-series',urlJP:source,isTranslatedJP:true};
 const previous={data:[{url,language:'int',itemId:'document-existing-incubator',pageType:'related-document-unclassified'}]};
 const state={indexes:{[index]:{members:[{url,source:index,kind:'scp'}]}},records:{[url]:{url,title:'SCP-682 (Catalan)',tags:['language-incubator','catalan','scp'],availabilityVersion:1,contentSha256:'a'.repeat(64),checkedAt:'2026-11-09T00:00:00Z'}},attempts:{}};
 const result=buildIndexedCatalog([seed],{int:state},previous);
 assert.equal(result.data.length,1);
 assert.equal(result.data[0].url,url);
 assert.equal(result.data[0].itemId,'document-existing-incubator');
 assert.equal(result.data[0].pageType,'related-document-en');
 assert.equal(result.data[0].classification.basis,'incubator_source_catalog');
});
test('documented publisher defaults require fiction tags and do not apply to unsupported or secondary translations',()=>{
 const url='https://scp-wiki-cn.wikidot.com/story';
 assert.equal(infer(url,['故事']).branch,'en');
 assert.equal(infer(url,['故事']).basis,'publisher_default_origin');
 for(const tags of [[],['fragment'],['故事','二次翻译'],['故事','uk']])assert.equal(infer(url,tags).branch,null);
 assert.equal(infer(url,['故事','sh']).branch,'sh');
 assert.equal(infer(url,['故事','tr']).branch,'tr');
 assert.equal(infer('https://scp-vn.wikidot.com/story',['tale']).branch,null);
 assert.equal(infer('https://scp-wiki.wikidot.com/026-exploration-logs',['supplement']).branch,'en');
 assert.equal(infer('https://scp-wiki-de.wikidot.com/story',['übersetzt','geschichte']).branch,'en');
 assert.equal(infer('https://scp-wiki-de.wikidot.com/story',['übersetzt','fr']).branch,'fr');
 assert.equal(infer('https://scp-wiki-de.wikidot.com/story',['geschichte']).branch,null);
 assert.equal(publisherDefaultOrigin(url,{tags:['故事'],translations:['https://scp-int.wikidot.com/unknown']}),null);
});


test('EN publisher language tags require underscore; pig subject matter cannot become Pig Latin original',()=>{
 const url='https://scp-wiki.wikidot.com/scp-509';
 for(const tags of [['scp','pig','safe'],['scp','pig','humanoid'],['pig'],['scp','fr','it','ko']]){
  assert.deepEqual(publisherOriginTags(url,{tags}).origins,[]);
 }
 assert.deepEqual(publisherOriginTags(url,{tags:['scp','pig','_pig']}).origins,['pig']);
 assert.deepEqual(publisherOriginTags(url,{tags:['international','_ru','scp']}).origins,['ru']);
 assert.deepEqual(publisherOriginTags(url,{tags:['international','_ko','scp']}).origins,['ko']);
 assert.deepEqual(publisherOriginTags(url,{tags:['scp','pig','_ru']}).origins,['ru']);
});
