'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalizePage}=require('../research-board/extract');
const {validateIdentityProofs}=require('../research-board/validate-identity-proofs');
function fixture(){
 const urls=['https://scp-jp.wikidot.com/some-story','https://scp-int.wikidot.com/some-story'];
 const node=Array(15).fill(null);node[8]='other';node[12]='related-document-unclassified';node[13]=urls.map(url=>['jp',url]);
 const board={nodes:[node],workIdentityProofs:[{source:urls[0],target:urls[1],method:'explicit_origin_and_translation_path'}]};
 const sources=new Map(urls.map(url=>[normalizePage(url).id,{record:{url,tags:['en']}}]));
 return {urls,node,board,sources};
}
test('matching publisher origin evidence remains valid with an unclassified representative catalog',()=>{
 const {board,sources}=fixture();assert.doesNotThrow(()=>validateIdentityProofs(board,sources));
});
test('translation path proofs reject conflicting publisher origins and separate work owners',()=>{
 const {board,sources,urls,node}=fixture();
 sources.get(normalizePage(urls[1]).id).record.tags=['fr'];
 assert.throws(()=>validateIdentityProofs(board,sources),/Unproven translated origin/);
 sources.get(normalizePage(urls[1]).id).record.tags=['en'];
 board.nodes=[{...node,13:[node[13][0]]},{...node,13:[node[13][1]]}];
 assert.throws(()=>validateIdentityProofs(board,sources),/Unproven translated path/);
});
