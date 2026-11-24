'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('production crawler and board writers target production without staging environments or credentials',()=>{
 for(const name of ['scp-crawler.yml','research-board-backfill.yml','research-board-body-links.yml']){
  const text=fs.readFileSync(path.join(__dirname,'../.github/workflows',name),'utf8');
  assert.match(text,/github\.repository == 'hirotakaakita\/scpjpReaderActions'/,name);
  assert.doesNotMatch(text,/scpjpReaderActions-stg|environment: stg|STG_FIREBASE|stg_new_scp/,name);
 }
});
