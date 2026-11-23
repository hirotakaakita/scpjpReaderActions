'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {publisherOriginTags,publisherDefaultOrigin}=require('../catalog-origin');
const {classify}=require('../related-documents');
test('English subject tags do not become language origins; explicit origin tags remain valid',()=>{
 const url='https://scp-wiki.wikidot.com/scp-509';
 assert.deepEqual(publisherOriginTags(url,{tags:['scp','pig']}).origins,[]);
 for(const branch of ['pig','ru','jp','ko'])assert.deepEqual(publisherOriginTags(url,{tags:['international','_'+branch]}).origins,[branch]);
 assert.equal(classify(url,new Map([[url,{tags:['scp','pig']}]]),new Map()).branch,'en');
 assert.equal(publisherDefaultOrigin(url,{tags:['international','_pig']}),null);
});
test('foreign publisher origin rules remain scoped to the publisher',()=>{
 assert.deepEqual(publisherOriginTags('https://scp-wiki-cn.wikidot.com/example',{tags:['原创']}).origins,['cn']);
 assert.deepEqual(publisherOriginTags('https://scp-wiki-de.wikidot.com/example',{tags:['englisch']}).origins,['en']);
 assert.deepEqual(publisherOriginTags('https://scp-wiki.wikidot.com/example',{tags:['原创']}).origins,[]);
});
