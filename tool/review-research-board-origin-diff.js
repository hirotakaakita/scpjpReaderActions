'use strict';
// Deterministic semantic guards over the immutable, already-validated dry run.
// This never publishes, recrawls, or edits the board.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {readSources}=require('../research-board/source-store');
const {originalPage}=require('../origin-provenance');
function csvRead(s){
 const rows=[];let row=[],v='',quoted=false;
 for(let i=0;i<s.length;i++){const c=s[i];
  if(quoted){if(c==='"'&&s[i+1]==='"'){v+='"';i++;}else if(c==='"')quoted=false;else v+=c;}
  else if(c==='"')quoted=true;else if(c===','){row.push(v);v='';}
  else if(c==='\n'){row.push(v);rows.push(row);row=[];v='';}
  else if(c!=='\r')v+=c;
 }
 if(quoted)throw Error('CSV unterminated quote');
 if(row.length||v)rows.push([...row,v]);
 const fields=rows.shift();
 return rows.filter(row=>row.some(Boolean)).map(r=>Object.fromEntries(fields.map((k,i)=>[k,r[i]||''])));
}
function csvWrite(rows,fields){
 const q=x=>'"'+String(x??'').replace(/"/g,'""')+'"';
 return [fields.map(q).join(','),...rows.map(r=>fields.map(k=>q(r[k])).join(','))].join('\n')+'\n';
}
function review(root,out){
 const read=(name)=>fs.readFileSync(path.join(root,name));
 const summary=JSON.parse(read('SUMMARY.json')),credits=JSON.parse(read('original-credit-review.json'));
 const board=JSON.parse(zlib.gunzipSync(read('preview-board.json.gz')));
 const moves=csvRead(read('moved-page-owners.csv').toString('utf8')),
  edges=csvRead(read('rewired-edges.csv').toString('utf8'));
 const owners=new Map();
 for(const node of board.nodes)for(const version of node[13]){
  if(owners.has(version[1]))throw Error('Duplicate owner: '+version[1]);
  owners.set(version[1],node);
 }
 const aliases=new Map();
 for(const node of board.nodes)for(const a of node[14][2]){
  assert(!aliases.has(a),'Duplicate catalog alias '+a);
  aliases.set(a,node[14][0]);
 }
 const metadata=new Map(credits.results.map(r=>[r.source,r]));
 const inspected=moves.map(move=>{
  const r=metadata.get(move.url);
  assert(r,'No explicit-credit evidence: '+move.url);
  const mine=owners.get(move.url),target=owners.get(r.resolvedOriginal);
  assert(mine&&target,'Source or original not in rebuilt board');
  assert.equal(mine[14][0],move.nextWork);
  const sibling=target[13].map(v=>v[1]).filter(u=>
   new URL(u).hostname===new URL(move.url).hostname&&u!==move.url);
  const attached=mine[14][0]===target[14][0];
  if(attached)assert.equal(sibling.length,0,'Unexpected same-host collision on merged work');
  else assert(sibling.length>0,'Work split lacks same-host collision: '+move.url);
  return {url:move.url,reviewLabel:attached?'native_original_merged':'same_host_collision_isolated',
   oldWorkAliasOwnerAfter:aliases.get(move.previousWork)||null,
   oldWorkAliasMatchesMovedPage:aliases.get(move.previousWork)===move.nextWork,
   original:r.resolvedOriginal,sourceCredit:r.creditedOriginal,
   previousWork:move.previousWork,nextWork:move.nextWork,
   conflictingPage:sibling.join(' | '),chain:r.path};
 });
 assert.equal(inspected.length,summary.movedPages);
 const old=new Set(moves.map(x=>x.previousWork)),newKeys=new Set(moves.map(x=>x.nextWork));
 const unexpected=edges.filter(e=>e.direction==='removed'?!(old.has(e.source)||old.has(e.target)):
  e.direction==='added'?!(newKeys.has(e.source)||newKeys.has(e.target)):true);
 assert.equal(unexpected.length,0,'Unrelated edge changes');
 assert.equal(edges.filter(e=>e.direction==='removed').length,summary.removedEdges);
 assert.equal(edges.filter(e=>e.direction==='added').length,summary.addedEdges);
 const outstanding=credits.results.filter(x=>x.after!=='same_work');
 const notice=outstanding.filter(r=>r.creditedOriginal==='https://scp-wiki.wikidot.com/bright-works-message');
 const transitive=outstanding.filter(r=>r.path.split(' > ').length>=3&&r.creditedOriginal!==r.resolvedOriginal)
  .map(r=>{const orig=owners.get(r.resolvedOriginal);
   const siblings=(orig?.[13]||[]).filter(v=>new URL(v[1]).hostname===new URL(r.source).hostname);
   return {source:r.source,firstOriginal:r.creditedOriginal,ultimateOriginal:r.resolvedOriginal,
    after:r.after,siteCollision:siblings.length>0,
    category:siblings.length?'needs_collision_review':'transitive_credit_candidate',
    firstWork:r.newWork,ultimateWork:r.originalNewWork,chain:r.path};});
 const unresolved=credits.results.filter(x=>x.after==='split_work'||x.after==='conflicting_native_work');
 const prioritized=unresolved.map(item=>{
  const u=new URL(item.source),origin=owners.get(item.resolvedOriginal);
  const siteSiblings=(origin?.[13]||[]).filter(v=>new URL(v[1]).hostname===u.hostname);
  const category=item.creditedOriginal==='https://scp-wiki.wikidot.com/bright-works-message'?
    'retired_redirect_notice':
    u.hostname==='scp-nd.wikidot.com'&&u.pathname.includes(':')?
    'nordic_namespaced_legacy':
    item.path.split(' > ').length>=3?'transitive_original_chain':
    siteSiblings.length>0?'same_host_collision':'manual_content_or_identity_review';
  return {...item,priorityCategory:category,siteCollisionCount:siteSiblings.length};
 });
 const reviewCounts={};
 for(const r of prioritized)reviewCounts[r.priorityCategory]=(reviewCounts[r.priorityCategory]||0)+1;
 const originalsOutsideCatalog=credits.results.filter(x=>x.after==='original_not_cataloged');
 // Every historic assertion is reattached to the actual stored capture.
 // This is stronger than a normalized URL alone; never promote a claim
 // without knowing its exact source hash, time and surrounding attribution.
 const sourceStates=readSources(path.join(__dirname,'../local-data/research-board-sources'));
 const sourceRecords=new Map([...sourceStates.values()].filter(s=>s.record?.url)
  .map(s=>[s.record.url,s]));
 const allCreditClaims=[...prioritized,...originalsOutsideCatalog];
 const originalCreditEvidence=allCreditClaims.map(x=>{
  const state=sourceRecords.get(x.source),r=state?.record;
  const canonical=originalPage(x.creditedOriginal)?.url;
  const originalClaims=(r?.originalSources||[]).filter(c=>c.method==='credit_original_label');
  const matched=originalClaims.filter(c=>originalPage(c.url)?.url===canonical);
  return {source:x.source,creditedOriginal:x.creditedOriginal,after:x.after,
   category:x.priorityCategory||'original_not_cataloged',
   checkedAt:r?.checkedAt||'',captureHash:r?.contentSha256||'',
   lastStatus:state?.lastAttempt?.status||'',claimCount:originalClaims.length,
   exactCreditInCapturedRecord:matched.length>0,
   creditQuote:matched.map(c=>c.quote||'').join(' | ').slice(0,500),
   originalAuthors:(r?.originalAuthors||[]).map(a=>a.name||a.id).join(' | ').slice(0,500),
   nativeCatalogBasis:r?.catalogIdentity?.basis||'',
   title:r?.title||''};
 });
 const evidenceWithHash=originalCreditEvidence.filter(e=>e.captureHash&&e.exactCreditInCapturedRecord).length;
 const categories=Object.fromEntries([...new Set(inspected.map(x=>x.reviewLabel))].map(k=>
  [k,inspected.filter(x=>x.reviewLabel===k).length]));
 const result={revision:summary.revisionAfter,inspectedMoves:inspected.length,categories,
  oldWorkAliasesDifferentFromMovedPage:inspected.filter(x=>!x.oldWorkAliasMatchesMovedPage).length,
  inspectedEdges:edges.length,unrelatedEdges:unexpected.length,remainingCreditReview:outstanding.length,
  noticeRedirects:notice.length,transitiveCandidates:transitive.length,
  transitiveWithoutSameSiteCollision:transitive.filter(x=>!x.siteCollision).length,
  priorityReviewCounts:reviewCounts,originalNotCataloged:originalsOutsideCatalog.length,
  creditClaimsWithCapturedHash:evidenceWithHash,creditClaimsReviewed:originalCreditEvidence.length};
 fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'SEMANTIC_SUMMARY.json'),JSON.stringify(result,null,2)+'\n');
 fs.writeFileSync(path.join(out,'SEMANTIC_REVIEW.csv'),csvWrite(inspected,
  ['url','reviewLabel','sourceCredit','original','previousWork','nextWork','conflictingPage','chain']));
 fs.writeFileSync(path.join(out,'WORK_ID_LOOKUP_RISKS.csv'),csvWrite(inspected,
   ['url','previousWork','nextWork','oldWorkAliasOwnerAfter','oldWorkAliasMatchesMovedPage']));
 fs.writeFileSync(path.join(out,'TRANSITIVE_REVIEW.csv'),csvWrite(transitive,
  ['source','firstOriginal','ultimateOriginal','after','siteCollision','category','firstWork','ultimateWork','chain']));
 fs.writeFileSync(path.join(out,'REMAINING_307_PRIORITIZED.csv'),csvWrite(prioritized,
  ['source','creditedOriginal','resolvedOriginal','before','after','priorityCategory',
   'siteCollisionCount','oldWork','newWork','originalOldWork','originalNewWork','path']));
 fs.writeFileSync(path.join(out,'ORIGINAL_NOT_CATALOGED.csv'),csvWrite(originalsOutsideCatalog,
  ['source','creditedOriginal','resolvedOriginal','before','after','oldWork','newWork','path']));
 fs.writeFileSync(path.join(out,'CREDIT_EVIDENCE.csv'),csvWrite(originalCreditEvidence,
  ['source','creditedOriginal','category','checkedAt','captureHash','lastStatus',
   'exactCreditInCapturedRecord','claimCount','creditQuote','title','nativeCatalogBasis','originalAuthors']));
 fs.writeFileSync(path.join(out,'REVIEW.md'),[
  '# Original-work semantic difference review','',
  'Evidence: immutable research-board-original-preview artifact, revision '+result.revision,
  '', '| Invariant | Result |','| --- | ---: |',
  '| Moved pages inspected | '+result.inspectedMoves+' |',
  '| Verified original merges | '+(categories.native_original_merged||0)+' |',
  '| Same-host protected splits | '+(categories.same_host_collision_isolated||0)+' |',
  '| Changed edges tied to impacted works | '+result.inspectedEdges+' |',
  '| Unrelated changes | '+result.unrelatedEdges+' |',
  '| Old work aliases still resolving away from moved page | '+result.oldWorkAliasesDifferentFromMovedPage+' |',
  '| Original-credit review records not yet fully explained | '+result.remainingCreditReview+' |',
  '| Deletion-notice redirect pseudo-originals | '+result.noticeRedirects+' |',
  '| Transitive origin chains to review | '+result.transitiveCandidates+' |',
  '| Without site collisions | '+result.transitiveWithoutSameSiteCollision+' |',
  '| Nordic namespace review | '+(reviewCounts.nordic_namespaced_legacy||0)+' |',
  '| Deleted-page notice redirects | '+(reviewCounts.retired_redirect_notice||0)+' |',
  '| Transitive identity review | '+(reviewCounts.transitive_original_chain||0)+' |',
  '| Same-site identity review | '+(reviewCounts.same_host_collision||0)+' |',
  '| Remaining manual content/identity review | '+(reviewCounts.manual_content_or_identity_review||0)+' |',
  '| Original credits with catalog absent | '+originalsOutsideCatalog.length+' |',
  '| Claims carrying exact stored capture evidence | '+evidenceWithHash+'/'+originalCreditEvidence.length+' |',
  '',
  'Caution: site-conflict protection is mechanically verified. The historical legitimacy',
  'of each original credit or the links of a deleted page requires independent publisher evidence.',
  'The notice page must not be treated as one original shared by redirected works.',
  'Transitive credits are flagged, NOT automatically merged; validate each source and intermediate credit.',
  'The Flutter app stores bookmarks/read status by catalog itemId, not the board workId.',
  'Work-ID-only board navigation still needs a URL-scoped resolution contract before release.','',
  '## All changed source pages','',
  ...inspected.map(x=>'- '+x.url+' — '+x.reviewLabel+'; original '+x.original+
     (x.conflictingPage?'; site sibling '+x.conflictingPage:'')),
 ].join('\n')+'\n');
 console.log(JSON.stringify(result,null,2));return result;
}
if(require.main===module)try{review(path.resolve(process.argv[2]),path.resolve(process.argv[3]));}
catch(e){console.error(e);process.exitCode=1;}
module.exports={csvRead,csvWrite,review};
