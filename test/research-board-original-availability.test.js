'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {hiddenOriginalUnavailableNodeIds}=require('../research-board/original-availability');
const mk=url=>({record:{url,originalSources:[]}});
function source(url,target){
 const s=mk(url);s.record.originalSources=target?[{url:target,method:'credit_original_label'}]:[];
 return s;
}
function fixture(){
 const a='https://scp-jp.wikidot.com/missing-story';
 const b='https://scp-ko.wikidot.com/missing-story';
 const native='https://scp-wiki.wikidot.com/present-story';
 const jp='https://scp-jp.wikidot.com/present-story';
 return {a,b,native,jp,nodes:[
  [0,null,null,null,null,null,null,null,null,null,null,null,null,[['jp',a],['ko',b]]],
  [1,null,null,null,null,null,null,null,null,null,null,null,null,[['en',native],['jp',jp]]]],
  sources:new Map([['a',source(a,'https://scp-wiki.wikidot.com/missing-story')],
   ['b',source(b,'https://scp-wiki.wikidot.com/missing-story')],
   ['native',source(native,null)],['jp',source(jp,native)]])};
}
test('hide only nodes whose explicit original is absent, not all catalog pages',()=>{
 const f=fixture(),out=hiddenOriginalUnavailableNodeIds(f.nodes,f.sources);
 assert.deepEqual(out.nodeIds,[0]);assert.equal(out.evidence.length,2);
 assert.deepEqual(out.evidence.map(x=>x.source).sort(),[f.a,f.b].sort());
});
test('an ambiguous publisher original never suppresses a work automatically',()=>{
 const f=fixture();
 const record=f.sources.get('a').record;
 record.originalSources.push({url:'https://scp-wiki.wikidot.com/another-story',
  method:'credit_original_label'});
 f.sources.delete('b');
 assert.deepEqual(hiddenOriginalUnavailableNodeIds(f.nodes,f.sources).nodeIds,[]);
});
test('catalog original is recognized through a credited translation chain',()=>{
 const f=fixture(),a=f.sources.get('a').record;
 a.originalSources=[{url:f.jp,method:'credit_original_label'}];f.sources.delete('b');
 assert.deepEqual(hiddenOriginalUnavailableNodeIds(f.nodes,f.sources).nodeIds,[]);
});
