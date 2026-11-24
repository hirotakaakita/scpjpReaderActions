'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { normalizePage, digest } = require('./extract');
const { readSources, importDirectory, saveSources } = require('./source-store');
const { starLayout } = require('./layout.cjs');
const { regionLayout } = require('./regions.cjs');
const { warpLayout } = require('./warp.cjs');
const { classifyNodes } = require('./classification');
const { collapseWorks } = require('./works');
const { translationIdentities } = require('./translation-identities');
const {validOrigin,publisherOriginTags}=require('../catalog-origin');
const { LANGUAGES } = require('../languages');
const {KINDS, CATEGORY_ORDER, KIND_BY_CATEGORY, homeCategory} = require('./article-categories');

function buildBoard(catalogs, sources) {
  const pages = new Map(), candidates = [], catalogEntries = new Map();
  function page(url) {
    const identity = normalizePage(url);
    if (!identity) return null;
    if (!pages.has(identity.id)) pages.set(identity.id, { ...identity, siteBranch: identity.branch, title: identity.slug, coverage: 'unfetched' });
    return pages.get(identity.id);
  }
  for (const catalog of catalogs) for (const row of catalog.data) {
    const node = page(row.isTranslatedJP !== false && row.urlJP ? row.urlJP : row.urlEN);
    if (node && (catalog.language === node.branch || node.title === node.slug)) {
      node.title = row.titleJP || node.slug; node.catalogTitle = node.title;
    }
    if (node) {
      if (!catalogEntries.has(node.id)) catalogEntries.set(node.id, []);
      catalogEntries.get(node.id).push({ language: catalog.language, pageType: row.pageType, itemId: row.itemId, articleNumber: row.numericItemId, contentType: row.contentType });
    }
  }
  const catalogPageIds = new Set(pages.keys());
  // Evidence may connect catalog members, never discover new catalog articles.
  function catalogPage(url) {
    const identity = normalizePage(url);
    return identity && catalogPageIds.has(identity.id) ? pages.get(identity.id) : null;
  }
  for (const state of sources.values()) {
    const r = state.record;
    const source = catalogPage(r?.url || state.url);
    if (!source) continue;
    const terminal = ['not_found', 'not_article', 'unavailable'].includes(state.lastAttempt?.status);
    if (!r) { source.coverage = terminal ? 'missing' : 'failed'; continue; }
    source.title = r.title || source.title;
    source.coverage = terminal ? 'missing' : r.limitations?.includes('legacy_unchecked_links') ? 'unfetched' :
      state.lastAttempt?.status !== 'success' && state.lastAttempt?.status !== 'not_modified' ? 'stale' : 'fetched';
    // A failed new observation cannot keep old assertions as current relations.
    if (source.coverage !== 'fetched') continue;
    // A directed reference is structural evidence, never a story assertion.
    // Resolve only against the existing catalog; links cannot add pages.
    if (r.linkExtractionVersion >= 6) for (const item of r.links || []) {
      if (item.method !== 'body_hyperlink_v6') continue;
      const target = catalogPage(item.target);
      if (!target || target.id === source.id) continue;
      candidates.push({source:source.id,target:target.id,type:'references',
        proof:[r.url,item.quote || '',item.location || 'article_body',r.contentSha256,
          item.sourceAnchor || '', '',r.checkedAt]});
    }
    for (const [baseType, items] of [['translation_assertion', r.translations],
      ...Object.entries(Object.groupBy(r.semanticRelations || [], x => x.type))]) {
      for (const item of items || []) {
        if (!['translation_assertion','co_appearance','hostile_to','member_of','canon_member','same_canon','experiment','sequel','created_by','contains_document'].includes(baseType)) continue;
        const semantic = baseType !== 'translation_assertion';
        if (semantic && !['source_specific_exact_quote', 'explicit_canon_breadcrumb'].includes(item.method)) continue;
        let target;
        if (item.targetEntity) continue; // No synthetic or uncollected article nodes.
        target = catalogPage(item.target);
        const subject = item.subject ? catalogPage(item.subject) : source;
        if (!target || !subject || target.id === subject.id) continue;
        const type = baseType;
        const proof = [r.url, item.quote || '', item.section?.title ? `${item.location} / ${item.section.title}` : item.location || '',
          r.contentSha256, item.sourceAnchor || '', item.note || '', r.checkedAt];
        candidates.push({ source: subject.id, target: target.id, type, proof });
      }
    }
  }
  const sourcePages = [...pages.values()].sort((a, b) => a.id.localeCompare(b.id, 'en'));
  classifyNodes(sourcePages, sources, catalogEntries);
  sourcePages.forEach(n => {
    const entries = catalogEntries.get(n.id) || [];
    const own = entries.find(e => e.language === n.siteBranch) || entries[0];
    n.kindIndex = KIND_BY_CATEGORY[homeCategory(own?.pageType || '', own?.contentType)];
    // Legacy mixed Joke indexes sometimes assigned EN to explicitly branch-
    // numbered SCPs. Only positional identifier codes override that metadata;
    // words later in a title-like suffix (e.g. "but-it-s...") are not codes.
    if([0,8,9].includes(n.kindIndex)&&n.pageType){
      const identifier=/^scp-(?:([a-z]{2,5})-)?\d+(?:-([a-z]{2,5})(?:-|$))?/.exec(n.slug);
      let branches=[...new Set((identifier?[identifier[1],identifier[2]]:[]).map(validOrigin).filter(Boolean))];
      const tagged=publisherOriginTags(n.url,sources.get(n.id)?.record);
      if(!branches.length&&tagged.origins.length===1&&!tagged.unsupported.length&&!tagged.conflicts.length)branches=tagged.origins;
      if(branches.length===1){
        n.branch=branches[0];
        n.pageType=n.kindIndex===9?(n.branch==='en'?'joke-scps':`joke-scps-${n.branch}`):n.kindIndex===8?(n.branch==='en'?'scp-ex':`scp-${n.branch}-ex`):(n.branch==='en'?'scp-series':`scp-series-${n.branch}`);
      }
    }
  });
  // Reviewed special case: RU Book of Letters is published at /scp-1138,
  // not the distinct native /scp-1138-ru (Live Broadcast).
  require('./russian-english-mainlist-originals').applyRussianBook1138(sourcePages,sources);
  require('./explicit-scp-origin').inheritTransitiveOrigins(sourcePages,sources);
  const identities=translationIdentities(sourcePages,sources);
  candidates.push(...identities.candidates);
  const collapsed = collapseWorks(sourcePages, candidates, catalogEntries, sources);
  const { nodes, sourcePageCount, internalReferences } = collapsed;
  const byWork = new Map();
  for (const entries of catalogEntries.values()) for (const entry of entries) {
    const key = `catalog:${entry.pageType}:${entry.itemId}`;
    if (!byWork.has(key)) byWork.set(key, []);
    byWork.get(key).push(entry);
  }
  for (const node of nodes) {
    const entries = byWork.get(node.id) || [];
    const entry = entries.find(row => row.language === node.siteBranch) || entries[0];
    node.kindIndex = KIND_BY_CATEGORY[homeCategory(node.pageType || '', entry?.contentType)];
  }
  const relations = collapsed.relations.filter(edge => edge.type !== 'translation_assertion');
  nodes.forEach((n, index) => { n.index = index; });
  const byId = new Map(nodes.map(n => [n.id, n]));
  const neighbors = nodes.map(() => new Set());
  for (const e of relations) {
    const a = byId.get(e.source).index, b = byId.get(e.target).index;
    neighbors[a].add(b); neighbors[b].add(a);
  }
  if (!nodes.length) throw Error('Empty research board');
  const { groups, sections, trunks } = starLayout(nodes, neighbors);
  regionLayout(groups, sections);
  const { warp, width, height } = warpLayout(nodes, groups, sections);
  const tileSize = 320, tileKeys = new Set(), points = new Map();
  const compact = nodes.map(n => {
    tileKeys.add(`${Math.floor(n.x / tileSize)}_${Math.floor(n.y / tileSize)}`);
    const key = `${n.branch}:${Math.floor(n.x / 180)}:${Math.floor(n.y / 180)}`;
    if (!points.has(key)) points.set(key, [n.x, n.y, 0, n.branch, n.kindIndex]);
    points.get(key)[2]++;
    return [n.index, n.x, n.y, n.kindIndex, n.slug, n.title, n.url, n.coverage, n.branch, n.degree, n.section, n.siteBranch, n.pageType, n.versions, [n.id, n.articleId, n.workKeys]];
  });
  const types = [...new Set(relations.map(e => e.type))].sort(), proofs = [], proofIds = new Map();
  const edges = relations.map(e => {
    const ids = e.proofs.map(proof => {
      const key = JSON.stringify(proof);
      if (!proofIds.has(key)) { proofIds.set(key, proofs.length); proofs.push(proof); }
      return proofIds.get(key);
    });
    return [byId.get(e.source).index, byId.get(e.target).index, types.indexOf(e.type), ids[0], ids];
  });
  const generatedAt = [...catalogs.map(c => c.timestamp), ...[...sources.values()].map(s => s.record?.checkedAt).filter(Boolean)].sort().at(-1);
  const overview = { schemaVersion: 3, generatedAt, pageCount: nodes.filter(n => !n.classificationSourceId).length,
    identity: 'ledger_work', sourcePageCount, internalReferences,
    nodeCount: nodes.length, edgeCount: edges.length, tileSize, width, height, geometryWarp: warp, sections,
    trunks: trunks.map(([a,b]) => [nodes[a].x, nodes[a].y, nodes[b].x, nodes[b].y, a, b]),
    branches: groups.map(b => ({ code: b.code, x: b.left, y: b.top, width: b.width, height: b.height,
      count: b.nodes.length, lanes: b.lanes, polygon: b.polygon })),
    points: [...points.values()], branchLinks: [], aggregateLinks: [], tiles: [...tileKeys], kinds: KINDS, types,
    classification: 'reading_record_page_type', categoryOrder: CATEGORY_ORDER, categoryClassification: 'home_article_classification_v1', membership: 'official_index_catalog_v3', linkPolicy: 'catalog_members_body_links_v6',
    classificationCounts: Object.fromEntries([...new Set(nodes.map(n => n.classificationBasis))].sort()
      .map(basis => [basis, nodes.filter(n => n.classificationBasis === basis).length])),
    semanticCoverage: 'partial_source_specific_only', license: 'CC BY-SA 3.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/' };
  overview.workIdentityPolicy='original_catalog_and_explicit_credits_v1';
  overview.publisherReviewedIdentityCount=collapsed.publisherReviewed.reviewedCount;
  overview.publisherReviewedWorkMerges=collapsed.publisherReviewed.mergedGroups.length;
  overview.bodyLinkCoverage = {
    checkedPages: sourcePages.filter(p => p.coverage === 'fetched' && sources.get(p.id)?.record?.linkExtractionVersion >= 6).length,
    totalPages: sourcePages.length,
    referenceEdges: relations.filter(e => e.type === 'references').length,
  };
  const identityReview=[...identities.review,...collapsed.identityReview];
  overview.identityReviewCount=identityReview.length;
  overview.ambiguousWorkKeys=collapsed.ambiguousWorkKeys;
  overview.ambiguousArticleIds=collapsed.ambiguousArticleIds;
  const hiddenOriginalUnavailable = require('./original-availability').hiddenOriginalUnavailableNodeIds(compact,sources);
  const retired = require('./retired-visibility').retiredVisibility(compact,sources);
  overview.retiredArticleVisibilityPolicy = 'hide_publisher_withdrawn_pages_preserve_live_versions_v1';
  overview.hiddenRetiredPageCount = retired.pageUrls.length;
  overview.hiddenRetiredWorkCount = retired.nodeIds.length;
  overview.originalAbsentVisibilityPolicy = 'hide_work_from_visualization_keep_catalog_v1';
  overview.hiddenOriginalUnavailableWorkCount = hiddenOriginalUnavailable.nodeIds.length;
  const content = { schemaVersion: 3, overview, nodes: compact, edges, proofs,
    hiddenOriginalUnavailableNodeIds: hiddenOriginalUnavailable.nodeIds,
    hiddenRetiredPageUrls: retired.pageUrls,
    hiddenRetiredNodeIds: retired.nodeIds,
    workIdentityProofs:collapsed.identityProofs,identityReview };
  const revision = digest(JSON.stringify(content)).slice(0, 20);
  return { ...content, revision, overview: { ...overview, revision } };
}

function loadCatalogs(input) {
  return Object.keys(LANGUAGES).sort().flatMap(language => {
    const directory = path.join(input, 'mobile-v3', language);
    const pointer = path.join(directory, 'manifest.json');
    if (fs.existsSync(pointer)) {
      const manifest = JSON.parse(fs.readFileSync(pointer));
      if (!/^catalog-[a-f0-9]{64}\.json\.gz$/.test(manifest.fileName)) throw Error('Invalid v3 catalog pointer');
      const bytes = fs.readFileSync(path.join(directory, manifest.fileName));
      if (digest(bytes) !== manifest.sha256 || bytes.length !== manifest.bytes) throw Error('Invalid v3 catalog checksum');
      const catalog = JSON.parse(zlib.gunzipSync(bytes));
      if (catalog.language !== language || catalog.totalCount !== catalog.data.length) throw Error('Invalid v3 catalog');
      return [catalog];
    }
    return [];
  });
}

function generateResearchBoard(input, output, { incoming = path.join(input, '../partial-data/related-documents/research-board'), seed } = {}) {
  const sourceDir = path.join(input, 'research-board-sources');
  const sources = readSources(sourceDir);
  if (seed) importDirectory(sources, seed);
  importDirectory(sources, incoming);
  const catalogs = loadCatalogs(input);
  require('./catalog-sources').importCatalogSources(sources, input, catalogs);
  const board = buildBoard(catalogs, sources);
  saveSources(sources, sourceDir);
  const coverageFile=path.join(input,'research-board-body-link-coverage.json.gz');
  const coverage=require('./link-coverage').buildCoverage(catalogs,sources);
  fs.writeFileSync(coverageFile+'.tmp',zlib.gzipSync(JSON.stringify(coverage)+'\n'));
  fs.renameSync(coverageFile+'.tmp',coverageFile);
  return require('./runtime-delivery').writeDelivery(board, input, output);
}
module.exports = { buildBoard, generateResearchBoard, loadCatalogs };
