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

test('all previously published keys for a shared URL survive a classification repair',()=>{
 const url='https://scp-wiki.wikidot.com/scp-000';
 const prior=['document-en--scp-000','scp-series-000'].map(itemId=>({itemId,urlJP:url,isTranslatedJP:true}));
 const rows=[{itemId:'scp-series-000',urlJP:url,isTranslatedJP:true,contentType:'tale'}];
 preservePublishedIds(rows,prior);
 assert.deepEqual(new Set(rows.map(r=>r.itemId)),new Set(prior.map(r=>r.itemId)));
 assert(rows.every(r=>r.contentType==='tale'));
 preservePublishedIds(rows,prior);
 assert.equal(rows.length,2);
});

test('removed pages are not resurrected and their published keys cannot be reused by another page',()=>{
 const prior=[{itemId:'old-key',urlJP:'https://scp-wiki.wikidot.com/scp-000',isTranslatedJP:true}];
 const rows=[{itemId:'new-key',urlJP:'https://scp-wiki.wikidot.com/scp-001',isTranslatedJP:true}];
 preservePublishedIds(rows,prior);
 assert.equal(rows.length,1);
 assert.equal(rows[0].itemId,'new-key');
 assert.throws(()=>preservePublishedIds([{...rows[0],itemId:'old-key'}],prior),/ID collision/);
});
