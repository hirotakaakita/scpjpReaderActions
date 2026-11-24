'use strict';
// Read-only compatibility audit for the Flutter app's user_data.articleId ->
// articles.itemId primary-key mapping. Never rewrite itemIds or user records.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {loadCatalogs}=require('../research-board/catalog'),{normalizePage}=require('../research-board/extract');
const {csvRead,csvWrite}=require('./review-research-board-origin-diff');
function audit(catalogs,board,moved){
 const owners=new Map();
 for(const node of board.nodes)for(const v of node[13]){
  assert(!owners.has(v[1]),'Duplicate URL in board');
  owners.set(v[1],node[14][0]);
 }
 const byId=new Map(),byUrl=new Map();
 for(const c of catalogs)for(const row of c.data){
  if(!row.itemId)continue;
  const url=normalizePage(row.isTranslatedJP!==false&&row.urlJP?row.urlJP:row.urlEN)?.url;
  if(!url||!owners.has(url))continue;
  const item={url,language:c.language,rawItemId:row.itemId,pageType:row.pageType,
   workId:owners.get(url),title:row.titleJP||row.titleEN||''};
  if(!byId.has(item.rawItemId))byId.set(item.rawItemId,[]);
  byId.get(item.rawItemId).push(item);
  if(!byUrl.has(url))byUrl.set(url,[]);
  byUrl.get(url).push(item);
 }
 const collisions=[];
 for(const [id,rows] of byId){
  const works=[...new Set(rows.map(r=>r.workId))];
  if(works.length<=1)continue;
  collisions.push({itemId:id,workCount:works.length,catalogRows:rows.length,
   workIds:works.sort().join(' | '),
   samplePages:rows.map(r=>r.language+':'+r.url).slice(0,15).join(' | ')});
 }
 const movedIds=[],unknown=[];
 for(const change of moved){
  const rows=byUrl.get(change.url)||[];
  if(!rows.length){unknown.push(change.url);continue;}
  for(const row of rows){
   const all=byId.get(row.rawItemId)||[],works=[...new Set(all.map(x=>x.workId))];
   movedIds.push({...row,previousWork:change.previousWork,nextWork:change.nextWork,
    workCountForItemId:works.length,rawItemIdIsAmbiguous:works.length>1,
    conflictingWorks:works.filter(w=>w!==row.workId).join(' | '),
    otherCatalogPages:all.filter(x=>x.workId!==row.workId)
     .map(x=>x.language+':'+x.url).slice(0,15).join(' | ')});
  }
 }
 const impactedRawIds=[...new Set(movedIds.map(r=>r.rawItemId))];
 return {summary:{boardRevision:board.revision,knownArticleUrls:owners.size,
   globalRawItemIds:byId.size,globalAmbiguousItemIds:collisions.length,
   movedUrlCount:moved.length,foundMovedUrls:moved.length-unknown.length,
   movedCatalogRows:movedIds.length,affectedRawItemIds:impactedRawIds.length,
   ambiguousAffectedRawItemIds:impactedRawIds.filter(id=>
     new Set((byId.get(id)||[]).map(x=>x.workId)).size>1).length,
   movedRowsWithAmbiguousItemId:movedIds.filter(x=>x.rawItemIdIsAmbiguous).length,
   missingMovedUrls:unknown},moved:movedIds,collisions};
}
function run(input,out){
 const board=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(input,'preview-board.json.gz'))));
 const moved=csvRead(fs.readFileSync(path.join(input,'moved-page-owners.csv'),'utf8'));
 const catalogs=loadCatalogs(path.resolve(__dirname,'../local-data'));
 const result=audit(catalogs,board,moved);
 const {board:published}=require('./preview-research-board-origin-fix')
  .loadPublished(path.resolve(__dirname,'../local-data'));
 const baseline=audit(catalogs,published,[]);
 const oldCollisions=new Set(baseline.collisions.map(x=>x.itemId));
 const nowCollisions=new Set(result.collisions.map(x=>x.itemId));
 const introduced=result.collisions.filter(x=>!oldCollisions.has(x.itemId));
 const resolved=baseline.collisions.filter(x=>!nowCollisions.has(x.itemId));
 result.summary.publishedRawItemIdCollisions=baseline.summary.globalAmbiguousItemIds;
 result.summary.newlyAmbiguousRawItemIds=introduced.length;
 result.summary.resolvedAmbiguousRawItemIds=resolved.length;
 assert.equal(result.summary.foundMovedUrls,moved.length,
  'Moved source article missing from the same catalog snapshot');
 fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'ITEMID_SUMMARY.json'),JSON.stringify(result.summary,null,2)+'\n');
 fs.writeFileSync(path.join(out,'MOVED_ITEMID_COMPAT.csv'),csvWrite(result.moved,
  ['url','language','rawItemId','pageType','title','previousWork','nextWork',
   'rawItemIdIsAmbiguous','workCountForItemId','conflictingWorks','otherCatalogPages']));
 fs.writeFileSync(path.join(out,'AMBIGUOUS_ITEMIDS_ALL.csv'),csvWrite(result.collisions,
  ['itemId','workCount','catalogRows','workIds','samplePages']));
 fs.writeFileSync(path.join(out,'NEWLY_AMBIGUOUS_ITEMIDS.csv'),csvWrite(introduced,
  ['itemId','workCount','catalogRows','workIds','samplePages']));
 fs.writeFileSync(path.join(out,'RESOLVED_AMBIGUOUS_ITEMIDS.csv'),csvWrite(resolved,
  ['itemId','workCount','catalogRows','workIds','samplePages']));
 const s=result.summary;
 fs.writeFileSync(path.join(out,'ITEMID_COMPAT.md'),[
  '# Flutter itemId compatibility with research board work nodes','',
  'The Flutter app stores user progress in user_data.articleId keyed to catalog articles.itemId.',
  'The work graph uses a separate opaque node work ID. Do not equate them.','',
  '| Inventory | Count |','| --- | ---: |',
  '| Catalog page URLs | '+s.knownArticleUrls+' |',
  '| Distinct raw itemIds | '+s.globalRawItemIds+' |',
  '| Raw itemIds associated with multiple graph works | '+s.globalAmbiguousItemIds+' |',
  '| Previous published raw itemIds spanning multiple works | '+s.publishedRawItemIdCollisions+' |',
  '| Newly ambiguous raw itemIds in this fix | '+s.newlyAmbiguousRawItemIds+' |',
  '| Previously ambiguous raw itemIds resolved by this fix | '+s.resolvedAmbiguousRawItemIds+' |',
  '| Moved graph page URLs analyzed | '+s.foundMovedUrls+' |',
  '| Catalog rows associated with these moved pages | '+s.movedCatalogRows+' |',
  '| Distinct itemIds on moved pages | '+s.affectedRawItemIds+' |',
  '| Moved-page itemIds shared by distinct works | '+s.ambiguousAffectedRawItemIds+' |',
  '','Do not migrate user_data by numeric SCP identifier or graph work ID.',
  'For future graph navigation, prefer exact normalized page URL lookup.',
  'An itemId collision is a potential cross-language state conflation, not proof',
  'that any particular user record has already changed. The current patch does',
  'not modify mobile catalog itemIds or Flutter user_data.'
 ].join('\n')+'\n');
 console.log(JSON.stringify(s,null,2));return result;
}
if(require.main===module)try{run(path.resolve(process.argv[2]),path.resolve(process.argv[3]));}
catch(e){console.error(e);process.exitCode=1;}
module.exports={audit,run};
