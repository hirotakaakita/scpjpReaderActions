'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalizedSourceListing:normalize}=require('../series-listing');
test('native and additional index names share one series while ES keeps 100-entry boundaries',()=>{
 for(const [type,source,n,expected]of [
 ['scp-series-es','serie-scp-es',46,'scp-series-es'],
 ['scp-series-es','scp-series-es',46,'scp-series-es'],
 ['scp-series-es','serie-scp-es-2',100,'scp-series-es-2'],
 ['scp-series-es','scp-series-es',199,'scp-series-es-2'],
 ['scp-series-es','serie-scp-es-4',399,'scp-series-es-4'],
 ['scp-series-fr','liste-fr',543,'scp-series-fr'],
 ['scp-series-it','scp-it-serie-i',116,'scp-series-it'],
 ['scp-series-ko','scp-series-ko-1',200,'scp-series-ko'],
 ['scp-series-ko','scp-series-ko',1000,'scp-series-ko-2'],
 ['scp-series-pl','lista-pl',499,'scp-series-pl'],
 ['scp-series','scp-series-1',2,'scp-series'],
 ['related-document-en','related-document-en',2,'related-document-en'],
 ['scp-series','custom',2,'custom'],
 ])assert.equal(normalize({pageType:type,extractedFrom:source,numericItemId:n}),expected);
});
test('normalization preserves distinct article IDs, archive groups and explicit custom sources',()=>{
 const rows=[{itemId:'native',pageType:'scp-series-it',extractedFrom:'scp-it-serie-i',numericItemId:1},{itemId:'variant',pageType:'scp-series-it',extractedFrom:'scp-series-it',numericItemId:1},{itemId:'arc',pageType:'related-document-it',extractedFrom:'related-document-it',contentType:'archive'}];
 const mapped=rows.map(r=>({...r,extractedFrom:normalize(r)}));
 assert.deepEqual(mapped.map(r=>r.itemId),['native','variant','arc']);
 assert.equal(new Set(mapped.slice(0,2).map(r=>r.extractedFrom)).size,1);
 assert.equal(mapped[2].contentType,'archive');
});
