'use strict';
const {originalPage}=require('../origin-provenance');

// Preserve the article-specific terminal translation chain already retrieved by
// the catalog crawler. An origin label without this evidence is not a pointer.
function verifiedCatalogOriginals(row, originsByUrl = new Map()) {
  if(row.classification?.basis!=='interwiki_original_metadata')return [];
  const source=originalPage(row.url),found=new Map();
  if(!source)return [];
  for(const proof of row.classification.evidence||[]){
    if(!proof||proof.status!=='translation'||proof.terminal!==true||proof.schemaVersion!==1||
       originalPage(proof.queryUrl)?.url!==source?.url||!Array.isArray(proof.chain)||!proof.chain.length||
       !Number.isFinite(Date.parse(proof.checkedAt))||!/^[a-f0-9]{64}$/.test(proof.contentSha256||''))continue;
    const original=originalPage(proof.chain.at(-1));
    if(!original||original.url===source.url||
       (original.hostBranch!==row.originBranch&&originsByUrl.get(original.url)!==row.originBranch))continue;
    found.set(original.url,{url:original.url,method:'interwiki_original_metadata',
      checkedAt:proof.checkedAt,contentSha256:proof.contentSha256,chain:proof.chain});
  }
  return [...found.values()];
}

module.exports={verifiedCatalogOriginals};
