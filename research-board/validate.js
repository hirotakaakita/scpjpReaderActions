'use strict';
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const { digest, normalizePage } = require('./extract');
const { buildBoard, loadCatalogs } = require('./catalog');
const { readSources } = require('./source-store');
const { branchForPageType } = require('./classification');
const {CATEGORY_ORDER, KIND_BY_CATEGORY, homeCategory} = require('./article-categories');
const {scpIdentityKey}=require('./translation-identities');
const {verifiedScpOriginal}=require('./explicit-scp-origin');
const {isRussianBook1138,marker:russianBook1138Marker}=require('./russian-english-mainlist-originals');
function validateScpIdentities(board, sources) {
  const pages = new Map(), owners = new Map();
  for (const node of board.nodes) for (const version of node[13]) {
    const p = normalizePage(version[1]);
    if (!p || pages.has(p.id)) throw Error('Invalid or duplicate source page: '+version[1]);
    pages.set(p.id, {...p, siteBranch:version[0], branch:node[8], pageType:node[12], kindIndex:node[3],
      ...(isRussianBook1138(p.url)?{historicalOriginalReview:russianBook1138Marker}:{})});
    owners.set(p.id, node);
  }
  const proven = new Set((board.workIdentityProofs||[])
    .filter(p=>['explicit_scp_original_credit','explicit_transitive_scp_original_credit',
      'reviewed_primary_publisher_content_20261124'].includes(p.method)).map(p=>p.source+'\0'+p.target));
  const scpOwners = new Map();
  for (const page of pages.values()) if ([0,8,9].includes(page.kindIndex) && page.pageType) {
    const node = owners.get(page.id), original = verifiedScpOriginal(page, pages, sources);
    let key = scpIdentityKey(page);
    if (original && scpIdentityKey(original)!==key) {
      const target = owners.get(original.id);
      if (node===target) {
        if (!proven.has(page.url+'\0'+original.url)) throw Error('Missing exact original SCP proof: '+page.url);
        key = scpIdentityKey(original);
      } else {
        // A conflicting page already occupies the same publisher site in the
        // original's component. The generator deliberately keeps this claim
        // separate; it is not an accepted work-equivalence assertion.
        const collision = target[13].some(v=>v[0]===page.siteBranch && normalizePage(v[1])?.id!==page.id);
        if (!collision) throw Error('Verified original SCP left in another work: '+page.url);
        key = 'protected_original_split\0'+page.id;
      }
    }
    const owner = scpOwners.get(key);
    if (owner && owner!==node[14][0]) throw Error('Duplicate verified SCP identity: '+key.replaceAll('\0',' / '));
    scpOwners.set(key, node[14][0]);
  }
}

// Both persisted publication validation and the isolated preview use these
// same checks. Preview callers already built this board from the exact inputs.
function validateBoard(board, catalogs, sources, {rebuild=true}={}) {
  if (board.overview.classification !== 'reading_record_page_type') throw Error('Missing ledger classification');
  if (board.schemaVersion !== 3 || board.overview.identity !== 'ledger_work') throw Error('Missing work identity');
  const workIds = new Set(), pageUrls = new Set(), aliases = new Set();
  for (const n of board.nodes) {
    if (n.length !== 15 || (n[12] && branchForPageType(n[12]) !== n[8])) throw Error('Ledger classification mismatch');
    if (workIds.has(n[14][0])) throw Error('Duplicate work node');
    workIds.add(n[14][0]);
    if (n[14].length !== 3 || !Array.isArray(n[14][2])) throw Error('Missing work aliases');
    for (const key of n[14][2]) {
      if (aliases.has(key)) throw Error('Work alias assigned to multiple nodes');
      aliases.add(key);
    }
    if (n[3] !== 4) for (const version of n[13]) {
      if (pageUrls.has(version[1])) throw Error('Page assigned to multiple works');
      pageUrls.add(version[1]);
    }
  }
  if (pageUrls.size !== board.overview.sourcePageCount) throw Error('Lost source page');
  const owners=new Map(board.nodes.flatMap(node=>node[13].map(page=>[page[1],node[14][0]])));
  if(board.overview.workIdentityPolicy!=='original_catalog_and_explicit_credits_v1')throw Error('Missing document work identity policy');
  for(const proof of board.workIdentityProofs||[]){
    if(!owners.has(proof.source)||owners.get(proof.source)!==owners.get(proof.target))throw Error('Translation identity proof does not join catalog pages');
  }
  for(const node of board.nodes){
    if(node[14][2].length<1)throw Error('Work lost its original catalog identity');
  }
  validateScpIdentities(board, sources);
  if (JSON.stringify(board.overview.categoryOrder) !== JSON.stringify(CATEGORY_ORDER)) throw Error('HOME category order mismatch');
  const catalogWorks = new Map();
  const catalogById=new Map();
  for (const catalog of catalogs) for (const row of catalog.data) {
    const key = `catalog:${row.pageType}:${row.itemId}`;
    if (!catalogWorks.has(key)) catalogWorks.set(key,[]);
    catalogWorks.get(key).push({...row,language:catalog.language});
    if(!catalogById.has(row.itemId))catalogById.set(row.itemId,[]);
    catalogById.get(row.itemId).push({...row,language:catalog.language});
  }
  for (const node of board.nodes) {
    const urls=new Set(node[13].map(p=>p[1]));
    const rows = catalogWorks.get(node[14][0]) || (catalogById.get(node[14][1])||[]).filter(row=>urls.has(normalizePage(row.isTranslatedJP!==false&&row.urlJP?row.urlJP:row.urlEN)?.url));
    const row = rows.find(row => row.language === node[11]) || rows[0];
    if (!row || node[3] !== KIND_BY_CATEGORY[homeCategory(node[12]||row.pageType,row.contentType)]) {
      throw Error(`HOME article category mismatch: ${node[14][0]}`);
    }
  }
  const members = new Set(catalogs.flatMap(c => c.data.map(row =>
    normalizePage(row.isTranslatedJP !== false && row.urlJP ? row.urlJP : row.urlEN)?.url)).filter(Boolean));
  if (pageUrls.size !== members.size || [...pageUrls].some(url => !members.has(url))) {
    throw Error('Board pages differ from the fetched official catalog');
  }
  const rawIdOwners=new Map(),flaggedIds=new Set(board.overview.ambiguousArticleIds||[]);
  for(const catalog of catalogs)for(const row of catalog.data){
    const url=normalizePage(row.isTranslatedJP!==false&&row.urlJP?row.urlJP:row.urlEN)?.url;
    if(!owners.has(url))continue;
    if(!rawIdOwners.has(row.itemId))rawIdOwners.set(row.itemId,new Set());
    rawIdOwners.get(row.itemId).add(owners.get(url));
  }
  for(const [id,works]of rawIdOwners)if(works.size>1&&!flaggedIds.has(id))throw Error('Unflagged reused article ID: '+id);
  if (board.nodes.some(n => n[3] === 4) ||
      board.overview.types.some(type => ['appears_in_log','appears_in_addendum','translation_assertion'].includes(type))) {
    throw Error('Uncollected entity or excluded hyperlink relations');
  }
  if(board.overview.linkPolicy!=='catalog_members_body_links_v6')throw Error('Invalid body link policy');
  require('./validate-identity-proofs').validateIdentityProofs(board,sources);
  for(const edge of board.edges){
    if(edge[0]===edge[1] || !board.nodes[edge[0]] || !board.nodes[edge[1]])throw Error('Invalid catalog link endpoints');
    if(board.overview.types[edge[2]]!=='references')continue;
    for(const id of edge[4]){
      const proof=board.proofs[id],p=normalizePage(proof[0]),state=p&&sources.get(p.id),r=state?.record;
      const targetUrls=new Set(board.nodes[edge[1]][13].map(v=>v[1]));
      if(owners.get(proof[0])!==board.nodes[edge[0]][14][0] || !(r?.linkExtractionVersion>=6) ||
          !r || r.contentSha256!==proof[3] ||
          !(r.links||[]).some(l=>l.method==='body_hyperlink_v6'&&targetUrls.has(normalizePage(l.target)?.url)))throw Error('Unproven body reference');
    }
  }
  // Exercise the real generation path against committed evidence and catalogs.
  // This runs in the existing staging validation workflow without recrawling.
  if (rebuild) {
    const rebuilt = buildBoard(catalogs, sources);
    if (JSON.stringify(board) !== JSON.stringify(rebuilt)) throw Error('Published board does not match current crawler inputs');
  }
  return {revision:board.revision, nodes:board.nodes.length, edges:board.edges.length, verified:true};
}

function validate(root = path.join(__dirname, '..')) {
  const input = path.join(root, 'local-data'), directory = path.join(input, 'mobile-v3/research-board');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')));
  if (manifest.fileName !== `board-${manifest.sha256}.json.gz`) throw Error('Invalid board pointer');
  const bytes = fs.readFileSync(path.join(directory, manifest.fileName));
  if (bytes.length !== manifest.bytes || digest(bytes) !== manifest.sha256) throw Error('Board checksum mismatch');
  const decoded = zlib.gunzipSync(bytes);
  if (decoded.length !== manifest.decodedBytes) throw Error('Board decoded size mismatch');
  const runtime = JSON.parse(decoded);
  const {loadAudit,runtimeBoard}=require('./runtime-delivery');
  const board=loadAudit(input);
  require('node:assert/strict').deepEqual(runtime,runtimeBoard(board),'Runtime differs from audited projection');
  if (runtime.revision !== manifest.revision || runtime.nodes.length !== manifest.nodeCount || runtime.edges.length !== manifest.edgeCount) throw Error('Board metadata mismatch');
  const audited = validateBoard(board, loadCatalogs(input), readSources(path.join(input, 'research-board-sources')));
  const result={...audited,revision:runtime.revision,edges:runtime.edges.length,auditRevision:board.revision};
  console.log(JSON.stringify(result));
  return result;
}
if (require.main === module) validate();
module.exports = { validate, validateBoard, validateScpIdentities };
