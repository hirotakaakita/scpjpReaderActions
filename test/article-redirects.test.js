'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const axios=require('axios');
const {fetchRecord,articleFetchTarget}=require('../related-documents');
const url='https://scpko.wikidot.com/scp-1047-j';

test('temporary rendering failure falls back to the same owned Wikidot page with the requested timeout',async t=>{
 const calls=[];t.mock.method(axios,'get',async(target,options)=>{
  calls.push(target);assert.equal(options.timeout,40000);
  if(target===url){const error=Error('Timed out');error.code='ECONNABORTED';throw error;}
  assert.equal(target,url+'/noredirect/true');
  return {status:200,data:'<div id="page-title">Original article</div><div id="page-content"><p>The original article body from its own page.</p></div>'};
 });
 const r=await fetchRecord(url,null,{timeoutMs:40000});assert.equal(r.url,url);assert.match(r.descriptionExcerpt,/original article body/);assert.deepEqual(calls,[url,url+'/noredirect/true']);
});

test('permanent HTTP failures do not fall back to another view',async t=>{
 let calls=0;t.mock.method(axios,'get',async()=>{calls++;const e=Error('Not found');e.response={status:404};throw e;});
 await assert.rejects(fetchRecord(url),/Not found/);assert.equal(calls,1);
});
test('a listing redirect reads the owned original page and never borrows the list body',async t=>{
 const calls=[];t.mock.method(axios,'get',async target=>{
  calls.push(target);if(target===url)return {status:301,headers:{location:'http://ko.scp-wiki.net/joke-scps'}};
  assert.equal(target,url+'/noredirect/true');return {status:200,data:'<div id="page-title">SCP-1047-J</div><div id="page-content"><div class="error-block">리다이렉트 모듈입니다.</div><p><span class="printuser">TroyL</span>이 창작하였습니다.</p><div class="ko-footer">댓글 보기</div></div><div class="page-tags"><a>농담</a><a>scp</a></div>'};
 });
 const record=await fetchRecord(url);assert.equal(record.title,'SCP-1047-J');assert.equal(record.descriptionExcerpt,'');assert.equal(record.descriptionStatus,'redirect_only');assert.equal(record.url,url);
 assert.deepEqual(calls,[url,url+'/noredirect/true']);
 assert.equal(articleFetchTarget('https://evil.example/scp-1047-j/noredirect/true'),null);
 assert.equal(articleFetchTarget(url+'/noredirect/true'),url+'/noredirect/true');
});
