'use strict';
// Pure, read-only lookup contract for UI callers that combine mobile catalog
// itemIds and the board's opaque work IDs. Does not alter existing user data.
// Source URL is authoritative: a reused catalog alias can belong to another work.
const {normalizePage}=require('./extract');
function buildArticleWorkResolver(board,{catalogs=null}={}){
  if(!board||board.schemaVersion!==3||!Array.isArray(board.nodes))
    throw Error('Unsupported board schema');
  const byUrl=new Map(),byRawItemId=new Map();
  for(const [index,node] of board.nodes.entries()){
    const workId=node[14]?.[0];if(!workId)throw Error('Work missing key '+index);
    for(const version of node[13]||[]){
      const canonical=normalizePage(version[1])?.url;
      if(!canonical)throw Error('Invalid source URL '+version[1]);
      if(byUrl.has(canonical))throw Error('Duplicate source URL '+canonical);
      byUrl.set(canonical,{workId,index,sourceUrl:canonical});
    }
  }
  // Work aliases are not sufficient to disambiguate raw mobile itemIds: a
  // moved article can retain a catalog itemId while its historical alias
  // belongs to an unrelated native work. Build raw-ID mapping from the exact
  // mobile catalogs, never infer it from board workKeys.
  if(catalogs)for(const c of catalogs)for(const row of c.data||[]){
    if(!row.itemId)continue;
    const url=normalizePage(row.isTranslatedJP!==false&&row.urlJP?row.urlJP:row.urlEN)?.url;
    const match=byUrl.get(url);
    if(!match)continue;
    if(!byRawItemId.has(row.itemId))byRawItemId.set(row.itemId,new Set());
    byRawItemId.get(row.itemId).add(match.index);
  }
  function resolve({articleUrl,itemId}={}){
    // Never guess a version from a numeric identifier; exact source wins.
    if(articleUrl){
      const normalized=normalizePage(articleUrl)?.url;
      if(!normalized)return {status:'invalid_source_url',workId:null};
      const match=byUrl.get(normalized);
      if(match)return {...match,status:'matched_source_url'};
      return {status:'source_not_in_catalog',workId:null};
    }
    if(!itemId||typeof itemId!=='string')return {status:'missing_article_identity',workId:null};
    if(!catalogs)return {status:'item_id_requires_catalog_context',workId:null};
    const candidates=byRawItemId.get(itemId);
    if(!candidates?.size)return {status:'unknown_item_id',workId:null};
    if(candidates.size>1)return {status:'ambiguous_item_id',workId:null,
      candidateCount:candidates.size};
    const index=candidates.values().next().value;
    return {status:'matched_unambiguous_item_id',workId:board.nodes[index][14][0],index};
  }
  return {resolve,sourceUrlCount:byUrl.size,rawItemIdCount:byRawItemId.size};
}
module.exports={buildArticleWorkResolver};
