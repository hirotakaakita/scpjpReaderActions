'use strict';
// Read-only inventory of every split full path and explicit original pointer.
// A report entry is a review candidate, not permission to merge by title/slug.
const fs=require('node:fs'),path=require('node:path'),z=require('node:zlib');
const {readSources}=require('../research-board/source-store');
const {originalPage}=require('../origin-provenance');
const generic=/^(?:main|index|home|start|about|groups-of-interest|foundation-tales|canon-hub|series-archive|personnel-and-character-dossier|task-forces|secure-facilities-locations|goi-formats)(?:-[a-z]{2})?$/;

function audit(board,sources){
 const records=new Map([...sources.values()].filter(s=>s.record).map(s=>[s.record.url,s.record]));
 const owners=new Map(),paths=new Map(),originals=new Map(),reviews=new Map();
 for(const r of board.identityReview||[])for(const url of [r.url,r.original].filter(Boolean)){
   if(!reviews.has(url))reviews.set(url,new Set());reviews.get(url).add(r.reason);
 }
 const add=(groups,key,node)=>{if(!groups.has(key))groups.set(key,new Map());groups.get(key).set(node[0],node);};
 for(const n of board.nodes)for(const p of n[13]){
   if(owners.has(p[1])&&owners.get(p[1])[0]!==n[0])throw Error('Page URL has multiple work owners: '+p[1]);
   owners.set(p[1],n);add(paths,n[8]+'\0'+p[2],n);
 }
 for(const n of board.nodes)for(const p of n[13]){
   const r=records.get(p[1]);
   const credits=(r?.originalSources||[]).filter(s=>s.method==='credit_original_label');
   const claims=credits.length?credits:(r?.catalogIdentity?.originalSources||[]).filter(s=>s.method==='interwiki_original_metadata');
   const targets=[...new Set(claims.map(s=>originalPage(s.url)?.url).filter(Boolean))];
   if(targets.length!==1)continue;
   add(originals,targets[0],n);
   const native=owners.get(targets[0]);if(native)add(originals,targets[0],native);
 }
 const collect=(groups,basis)=>[...groups].filter(([,works])=>works.size>1).map(([key,works])=>{
   const nodes=[...works.values()],reasons=new Set();
   const versions=nodes.flatMap(n=>n[13]);
   for(const p of versions)for(const reason of reviews.get(p[1])||[])reasons.add(reason);
   if(nodes.some(n=>n[8]==='other'))reasons.add('unclassified_origin');
   if(new Set(nodes.map(n=>n[8]).filter(b=>b!=='other')).size>1)reasons.add('conflicting_original_branches');
   if(basis==='full_original_path'&&generic.test(key.split('\0')[1]))reasons.add('generic_resource_path');
   const sites=new Map();for(const p of versions){if(!sites.has(p[0]))sites.set(p[0],new Set());sites.get(p[0]).add(p[1]);}
   if([...sites.values()].some(urls=>urls.size>1))reasons.add('same_site_identity_collision');
   if(!reasons.size)reasons.add('insufficient_independent_identity_evidence');
   return {basis,key,reasons:[...reasons].sort(),works:nodes.map(n=>({workId:n[14][0],origin:n[8],pageType:n[12],pages:n[13].map(p=>({site:p[0],url:p[1],slug:p[2]}))}))};
 }).sort((a,b)=>a.key.localeCompare(b.key,'en'));
 const pathGroups=collect(paths,'full_original_path'),pointerGroups=collect(originals,'explicit_original_pointer');
 const reasonCounts={};for(const group of [...pathGroups,...pointerGroups])for(const reason of group.reasons)reasonCounts[reason]=(reasonCounts[reason]||0)+1;
 const aliases=new Set(board.nodes.flatMap(n=>n[14][2]));
 return {revision:board.revision,nodeCount:board.nodes.length,pageUrlCount:owners.size,catalogAliasCount:aliases.size,
   splitPathGroupCount:pathGroups.length,splitOriginalPointerGroupCount:pointerGroups.length,
   identityReviewCount:board.identityReview?.length||0,reasonCounts,groups:[...pathGroups,...pointerGroups]};
}

if(require.main===module){
 const args=process.argv.slice(2),option=name=>args.includes(name)?args[args.indexOf(name)+1]:null;
 const root=option('--root')||path.join(__dirname,'..'),file=option('--board');
 const board=file?JSON.parse(z.gunzipSync(fs.readFileSync(file))):require('../research-board/runtime-delivery').loadAudit(path.join(root,'local-data'));
 const result=audit(board,readSources(path.join(root,'local-data/research-board-sources')));
 if(option('--output'))fs.writeFileSync(option('--output'),JSON.stringify(result,null,2)+'\n');
 const {groups,...summary}=result;console.log(JSON.stringify(summary,null,2));
}
module.exports={audit};
