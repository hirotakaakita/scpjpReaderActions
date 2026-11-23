'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {preservePublishedIds}=require('../catalog-delivery-identity');
test('type repairs retain the prior published identity by exact publisher page',()=>{
 const url='https://scp-wiki.wikidot.com/scp-000';
 const prior=[{itemId:'document-en--scp-000',urlJP:url,isTranslatedJP:true}];
 const rows=[{itemId:'scp-series-000',urlJP:url,isTranslatedJP:true,pageType:'related-document-en'}];
 preservePublishedIds(rows,prior);
 assert.equal(rows[0].itemId,'document-en--scp-000');
 assert.equal(rows[0].pageType,'related-document-en');
 assert.throws(()=>preservePublishedIds([...rows,{itemId:rows[0].itemId,urlJP:'https://scp-wiki.wikidot.com/scp-001'}],prior),/ID collision/);
});
