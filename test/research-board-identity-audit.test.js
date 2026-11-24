'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {audit}=require('../tool/audit-research-board-identities');
const node=(id,sites)=>[id,0,0,3,'story','Story','https://example.com','fetched','en',0,'','en','related-document-en',
 sites.map(site=>[site,`https://${site}.example.com/story`,'story','Story','fetched']),['work:'+id,'legacy:'+id,['catalog:'+id]]];
test('audit inventories split full paths and records the reasons they were held',()=>{
 const nodes=[node(1,['en']),node(2,['fr'])];
 const r=audit({revision:'x',nodes,identityReview:[{url:nodes[1][13][0][1],reason:'author_conflict'}]},new Map());
 assert.equal(r.splitPathGroupCount,1);assert.equal(r.pageUrlCount,2);assert.equal(r.catalogAliasCount,2);
 assert(r.groups[0].reasons.includes('author_conflict'));
});
test('audit does not label multiple language versions inside one work as duplicate works',()=>{
 const r=audit({revision:'x',nodes:[node(1,['en','fr'])],identityReview:[]},new Map());
 assert.equal(r.splitPathGroupCount,0);assert.equal(r.pageUrlCount,2);
});
