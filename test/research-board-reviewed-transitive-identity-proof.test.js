'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {validateIdentityProofs}=require('../research-board/validate-identity-proofs');
const {normalizePage}=require('../research-board/extract');
const A='https://scp-wiki.wikidot.com/scp-2222';
const B='https://scp-wiki-cn.wikidot.com/scp-2222';
const C='https://scpfoundation.net/scp-2222';
const V=(site,url)=>[site,url,'scp-2222','Review sample','fetched'];
const node=(index,versions)=>{
 const row=Array(15).fill(null);row[0]=index;row[3]=0;row[8]='en';row[12]='scp-series';row[13]=versions;return row;
};
const proof={source:A,target:C,method:'explicit_transitive_scp_original_credit',chain:[A,B,C]};
const source=(url,target)=>({
 record:{url,originalSources:target?[{url:target,method:'credit_original_label'}]:[]},
 lastAttempt:{status:'success'}
});
function fixture(bad=false){
 return {
  board:{nodes:[node(0,[V('en',A),V('cn',B),V('ru',C)])],workIdentityProofs:[proof]},
  sources:new Map([
   [normalizePage(A).id,source(A,B)],
   [normalizePage(B).id,source(B,bad?'https://scp-wiki.wikidot.com/scp-1234':C)],
   [normalizePage(C).id,source(C,null)]
  ])
 };
}
test('published transitive credit chain remains valid after node display branch changes',()=>{
 const {board,sources}=fixture();
 assert.doesNotThrow(()=>validateIdentityProofs(board,sources));
});
test('an incorrect middle credit fails independently of node display metadata',()=>{
 const {board,sources}=fixture(true);
 assert.throws(()=>validateIdentityProofs(board,sources),/Unproven transitive original SCP credit/);
});
test('an original credit is insufficient if the source and terminal are in different works',()=>{
 const {board,sources}=fixture();
 board.nodes=[node(0,[V('en',A),V('cn',B)]),node(1,[V('ru',C)])];
 assert.throws(()=>validateIdentityProofs(board,sources),/Unproven transitive original SCP credit/);
});
