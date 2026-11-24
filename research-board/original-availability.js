'use strict';
// Visibility policy only. Full catalog, ownership, work IDs, aliases, and proofs
// are retained. The client omits these nodes from map tiles and search.
const {normalizePage}=require('./extract');
const {originalPage}=require('../origin-provenance');
function hiddenOriginalUnavailableNodeIds(nodes,sources){
 const owner=new Map();
 for(const node of nodes)for(const version of node[13])owner.set(version[1],node[0]);
 const pointers=new Map(),ambiguous=new Set();
 for(const state of sources.values()){
  const r=state?.record;if(!r||!owner.has(r.url))continue;
  const credits=(r.originalSources||[]).filter(x=>x.method==='credit_original_label');
  const targets=[...new Set(credits.map(x=>originalPage(x.url)?.url).filter(Boolean))];
  if(credits.length&&(!targets.length||targets.length>1||credits.some(x=>!originalPage(x.url)))){
   ambiguous.add(r.url);continue;
  }
  if(targets.length===1&&targets[0]!==r.url)pointers.set(r.url,targets[0]);
 }
 function root(source){
  const seen=new Set();let cursor=source;
  for(let i=0;i<32;i++){
   if(seen.has(cursor)||ambiguous.has(cursor))return null;
   seen.add(cursor);
   if(!pointers.has(cursor))return cursor;
   cursor=pointers.get(cursor);
  }
  return null;
 }
 const hidden=new Set(),evidence=[];
 for(const [source,original] of pointers){
  const terminal=root(source);
  if(!terminal||owner.has(terminal))continue;
  const id=owner.get(source);
  if(id===undefined)continue;
  hidden.add(id);
  evidence.push({source,original,terminal,nodeId:id});
 }
 return {nodeIds:[...hidden].sort((a,b)=>a-b),evidence};
}
module.exports={hiddenOriginalUnavailableNodeIds};