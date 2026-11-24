'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalizedUrl,fromHtml,fromFtml}=require('./reference');
const {compare,samplePages,allocate,parseArgs,csv}=require('./audit');
const {parseCsv,triage}=require('./triage');

const en='https://scp-wiki.wikidot.com/';
const jp='https://scp-jp.wikidot.com/';
function index(){
  const workByUrl=new Map([[en+'scp-001','work:one'],[jp+'scp-001','work:one'],
    [en+'scp-002','work:two'],[jp+'scp-002','work:two'],
    [en+'scp-003','work:three']]);
  return {workByUrl,supportedHosts:new Set(['scp-wiki.wikidot.com','scp-jp.wikidot.com'])};
}
test('normalization strips fragment / allowed tracking, but blocks query operations and external ports',()=>{
  assert.equal(normalizedUrl('http://scpwiki.com/scp-002#note'),en+'scp-002');
  assert.equal(normalizedUrl('/scp-002?utm_source=test',en),en+'scp-002');
  assert.equal(normalizedUrl('/scp-002?action=edit',en),null);
  assert.equal(normalizedUrl('https://scp-wiki.wikidot.com:8443/scp-002'),null);
});
test('independent HTML parser identifies article references, skipping auxiliary and self-work links',()=>{
  const {workByUrl,supportedHosts}=index();
  const html='<div id="page-title">SCP</div><div id="page-content">'+
    '<p><a href="/scp-002">Two</a><a href="/scp-002#appendix">Again</a></p>'+
    '<nav><a href="/scp-003">next</a></nav>'+
    '<div class="licensebox"><a href="/scp-003">credit</a></div>'+
    '<a class="newpage" href="/scp-003">missing</a>'+
    '<div class="translation-source"><a href="'+jp+'scp-001">translated</a></div>'+
    '<p><a href="'+jp+'scp-001">self work</a></p>'+
    '<p><a href="/uncataloged">missing catalog</a></p>'+
    '<a href="#note">self fragment</a></div>';
  const result=fromHtml(html,en+'scp-001',workByUrl,supportedHosts);
  assert.deepEqual([...result.links.keys()],['work:two']);
  assert.equal(result.links.get('work:two').length,2);
  assert.equal(result.counts.outside_catalog,1);
  assert.equal(result.counts.auxiliary_content,3);
  assert.equal(result.counts.same_work,1);
  assert.equal(result.counts.fragment_or_empty,1);
});
test('non-html code/FTML comments ignored, explicit FTML links detected',()=>{
  const {workByUrl,supportedHosts}=index();
  const ftml=[
    '[[[scp-002|Two]]]',
    '[https://scp-wiki.wikidot.com/scp-003 Third]',
    '[!-- [[[scp-003|hidden]]] --]',
    '[[code]] [[[scp-003|code]]] [[/code]]',
    '[[div class="credit"]] [[[scp-003|credit]]] [[/div]]',
    '[[include page:link]]'
  ].join('\n');
  const result=fromFtml(ftml,en+'scp-001',workByUrl,supportedHosts);
  assert.deepEqual([...result.links.keys()],['work:two','work:three']);
  assert.equal(result.counts.auxiliary_content,1);
  assert(result.warnings.includes('ftml_includes_not_expanded'));
});

test('independent FTML navigation excludes centered chapter bars while retaining narrative references',()=>{
 const {workByUrl,supportedHosts}=index();
 const text='[[=]]\n<< [[[scp-002|Previous]]] | Article | [[[scp-003|Next]]] >>\n[[/=]]\n\n'+
   'The experiment compares [[[scp-002|Two]]] with [[[scp-003|Three]]].';
 const result=fromFtml(text,en+'scp-001',workByUrl,supportedHosts,'Article');
 assert.equal(result.counts.chapter_navigation,2);
 assert.deepEqual([...result.links.keys()],['work:two','work:three']);
 const ordinary=fromFtml('This study mentions [[[scp-002|Previous]]] and [[[scp-003|Next]]] in its narrative.',en+'scp-001',workByUrl,supportedHosts);
 assert.deepEqual([...ordinary.links.keys()],['work:two','work:three']);
});
test('comparison exposes both published-only and missing links',()=>{
  const difference=compare(['work:a','work:b'],['work:b','work:c']);
  assert.deepEqual(difference.tp,['work:b']);
  assert.deepEqual(difference.fp,['work:a']);
  assert.deepEqual(difference.fn,['work:c']);
});

test('plain-text chapter hubs and author collections are UI, with narrative links preserved',()=>{
 const {workByUrl,supportedHosts}=index();
 const html='<div id="page-title">Article</div><div id="page-content">'+
   '<p>« <a href="/scp-002">Previous</a> | Plain hub title | <a href="/scp-003">Next</a> »</p>'+
   '<div class="collection"><a class="collapsible-block-link">More&nbsp;From&nbsp;This&nbsp;Author</a>'+
   '<p><a href="/scp-003">Other work</a></p></div>'+
   '<div class="collection"><p>A narrative collection mentions <a href="/scp-002">Two</a>.</p></div></div>';
 const result=fromHtml(html,en+'scp-001',workByUrl,supportedHosts);
 assert.deepEqual([...result.links.keys()],['work:two']);
 assert.equal(result.counts.chapter_navigation,2);
 assert.equal(result.counts.author_collection,1);
});

test('asset source links in an explicit attribution record are excluded, inline references survive',()=>{
 const {workByUrl,supportedHosts}=index();
 const html='<div id="page-content"><blockquote><p>Filename: image.png Name: Picture '+
   'Author: Artist License: CC BY-SA 3.0 Source Link: <a href="/scp-003">Three</a></p></blockquote>'+
   '<p>The source link for this experiment is <a href="/scp-002">Two</a>.</p></div>';
 const result=fromHtml(html,en+'scp-001',workByUrl,supportedHosts);
 assert.deepEqual([...result.links.keys()],['work:two']);
 assert.equal(result.counts.source_credit_metadata,1);
});
test('deterministic selection, fixed allocation, holdout exclusion and branch coverage',()=>{
  const pages=[];
  for(const [language,n] of [['jp',55],['en',55],['ru',55],['fr',55]]){
    for(let i=0;i<n;i++)pages.push({url:'https://'+language+'.example.com/scp-'+i,
      language,kind:0,workId:language+':'+i,slug:'scp-'+i,versions:i%4===0?2:1,
      expected:new Set(i%3===0?['x','y','z']:[]),review:i%5===0});
  }
  const a=samplePages({pages},{limit:100,seed:'seed'});
  const b=samplePages({pages},{limit:100,seed:'seed'});
  assert.deepEqual(a.pages.map(x=>x.url),b.pages.map(x=>x.url));
  assert.equal(new Set(a.pages.map(x=>x.url)).size,100);
  for(const lang of ['jp','en','fr','ru'])assert(a.pages.some(p=>p.language===lang));
  const excluded=samplePages({pages},{limit:100,seed:'seed',excludedLanguages:new Set(['ru'])});
  assert(!excluded.pages.some(p=>p.language==='ru'),'explicit language exclusion');
  const c=samplePages({pages},{limit:30,seed:'different',excluded:new Set(a.pages.map(x=>x.url))});
  assert.equal(c.pages.length,30);
  assert(c.pages.every(p=>!a.pages.some(o=>o.url===p.url)));
  assert.equal(Object.values(allocate(500)).reduce((x,y)=>x+y,0),500);
});
test('CLI includes RU API/FTML by default, with an explicit opt-out',()=>{
  assert.equal(parseArgs([]).includeRu,true);
  assert.equal(parseArgs(['--include-ru','--limit','25']).includeRu,true);
  assert.equal(parseArgs(['--exclude-ru']).includeRu,false);
});
test('image-only international directory gallery excluded, but prose reference preserved',()=>{
  const {workByUrl,supportedHosts}=index();
  const nav=Array.from({length:10},(_,i)=>
    '<div><a href="/groups-of-interest-'+i+'"><img alt="flag" src="/flag'+i+'.svg"></a></div>').join('');
  for(let i=0;i<10;i++)workByUrl.set(jp+'groups-of-interest-'+i,'dir:'+i);
  const html='<div id="page-title">Article</div><div id="page-content">'+
    '<div class="directory-grid">'+nav+'</div>'+
    '<p>See <a href="/groups-of-interest-1">this directory</a> in the story.</p>'+
    '<p>Also see <a href="/scp-002">SCP-002</a>.</p></div>';
  const out=fromHtml(html,jp+'scp-001',workByUrl,supportedHosts);
  assert.equal(out.counts.image_directory_navigation,10);
  assert.deepEqual([...out.links.keys()],['dir:1','work:two']);
});
test('small illustrated narrative references must NOT be dropped as navigation',()=>{
  const {workByUrl,supportedHosts}=index();
  workByUrl.set(jp+'groups-of-interest-1','dir:1');
  const html='<div id="page-title">Article</div><div id="page-content">'+
    '<a href="/groups-of-interest-1"><img src="/illustration.png"></a></div>';
  const out=fromHtml(html,jp+'scp-001',workByUrl,supportedHosts);
  assert.deepEqual([...out.links.keys()],['dir:1']);
});
test('recognizes named shared navigation components while preserving narrative',()=>{
  const {workByUrl,supportedHosts}=index();
  const html='<div id="page-title">Article</div><div id="page-content">'+
    '<div class="multibranch-wrapper"><a href="/scp-003">nav</a></div>'+
    '<div class="earthworm"><a href="/scp-003">nav</a></div>'+
    '<p>See <a href="/scp-002">Two</a></p></div>';
  const out=fromHtml(html,en+'scp-001',workByUrl,supportedHosts);
  assert.deepEqual([...out.links.keys()],['work:two']);
  assert.equal(out.counts.auxiliary_content,2);
});
test('CSV discrepancy triage classifies repeated image-directory links conservatively',()=>{
  const sample={sourceUrl:jp+'scp-001',language:'zh-tr',result:'changed_since_capture',
    href:'/groups-of-interest-zh',quote:'',targetWork:'some:work',
    selector:'div > a',sourceElement:'<a href="/groups-of-interest-zh"><img src="logo.svg"></a>'};
  const diffs=Array.from({length:9},(_,i)=>({...sample,sourceUrl:'https://scp-zh-tr.wikidot.com/page-'+i}));
  diffs.push({...sample,sourceUrl:'https://scp-zh-tr.wikidot.com/narrative',
    href:'/scp-179',quote:'SCP-179',sourceElement:'<a href="/scp-179">SCP-179</a>'});
  const audit={samples:diffs.map(x=>({url:x.sourceUrl,status:'content_changed',warning:[],expectedCount:0,actualCount:1}))};
  const t=triage(audit,diffs);
  assert.equal(t.counts.verifier_noise_global_image_menu,9);
  assert.equal(t.counts.individual_content_review,1);
  const original=csv([{quote:'embedded,"quote"\nline'}],['quote']);
  assert.deepEqual(parseCsv(original),[{quote:'embedded,"quote"\nline'}]);
});
test('CLI accepts targeted catalog URLs',()=>{
  assert.deepEqual(parseArgs(['--url',jp+'scp-001','--url',jp+'scp-002']).urls,[jp+'scp-001',jp+'scp-002']);
});
test('same-snapshot 3-way comparison distinguishes published-only vs verifier-only',()=>{
  const {compareThree}=require('./same-snapshot');
  const graph=new Set(['a','b','c','d']);
  const primary=new Map([['a',[]],['b',[]],['e',[]],['f',[]]]);
  const independent={links:new Map([['a',[]],['c',[]],['e',[]],['g',[]]])};
  const r=compareThree(graph,primary,independent);
  assert.deepEqual(r.totals,{
    independent_parser_omission:1,primary_parser_exclusion_conflict:1,
    published_only_both_absent:1,both_current_only:1,
    primary_only_candidate:1,independent_only_candidate:1});
});
test('recursive source-credit tracing detects terminal roots and cycles',()=>{
  const {traceRoot}=require('./identity-provenance');
  const x=new Map([['a','b'],['b','c']]);
  assert.deepEqual(traceRoot('a',x),{status:'terminal',root:'c',path:['a','b','c']});
  x.set('c','b');
  assert.equal(traceRoot('a',x).status,'cycle');
});

test('every unresolved original credit retains a disposition and captured evidence',()=>{
 const {classify}=require('./identity-provenance');
 const source=en+'scp-001',target=en+'missing-original';
 const record={contentSha256:'a'.repeat(64),checkedAt:'2026-11-23T00:00:00Z',
   originalSources:[{url:target,method:'credit_original_label'}]};
 const idx={pages:[{url:source,workId:'source'}],workByUrl:new Map([[source,'source']])};
 const result=classify(idx,new Map([[source,target]]),new Map([[source,record]]));
 assert.equal(result.review.length,1);
 assert.equal(result.review[0].disposition,'hold_outside_catalog');
 assert.equal(result.review[0].contentSha256,record.contentSha256);
 assert.deepEqual(result.review[0].claims,record.originalSources);
 assert.deepEqual(result.review[0].chain,[source,target]);
});
test('independent validator ignores chapter bars and credit links, not inline narrative',()=>{
  const {workByUrl,supportedHosts}=index();
  const html='<div id="page-title">Testing</div><div id="page-content">'+
    '<p>« <a href="/scp-002">Previous</a> | <a href="/scp-003">Hub</a> | <a href="/scp-002">Next</a> »</p>'+
    '<p>原文來源：<a href="/scp-003">http://scpwiki.com/</a>。授權方式為 CC-BY-SA。</p>'+
    '<p>The story mentions <a href="/scp-002">SCP-002</a>.</p></div>';
  const v=fromHtml(html,en+'scp-001',workByUrl,supportedHosts);
  assert.equal(v.counts.chapter_navigation,3);
  assert.equal(v.counts.source_credit_metadata,1);
  assert.deepEqual([...v.links.keys()],['work:two']);
});
test('chapter-like prose without arrow-and-divider structure is kept',()=>{
  const {workByUrl,supportedHosts}=index();
  const html='<div id="page-title">Testing</div><div id="page-content">'+
    '<p>« In this study, <a href="/scp-002">SCP-002</a> is explained in relation to '+
    '<a href="/scp-003">SCP-003</a> »</p></div>';
  const v=fromHtml(html,en+'scp-001',workByUrl,supportedHosts);
  assert.deepEqual([...v.links.keys()],['work:two','work:three']);
});
test('one-link title breadcrumb is excluded but unrelated single links survive',()=>{
  const {workByUrl,supportedHosts}=index();
  const html='<div id="page-title">Testing</div><div id="page-content">'+
    '<p><a href="/scp-002">SCP-002</a> » Testing</p>'+
    '<p>Refer to <a href="/scp-003">SCP-003</a> instead.</p></div>';
  const v=fromHtml(html,en+'scp-001',workByUrl,supportedHosts);
  assert.equal(v.counts.breadcrumb_navigation,1);
  assert.deepEqual([...v.links.keys()],['work:three']);
});
test('CSV output preserves quotes and embedded delimiters',()=>{
  assert.equal(csv([{url:'a,b',note:'"quoted"'}],['url','note']),'"url","note"\n"a,b","""quoted"""\n');
});
