'use strict';
const { LANGUAGES } = require('../languages');
const { validOrigin } = require('../catalog-origin');

// The reading ledger groups on pageType, not the host serving a translation.
function branchForPageType(type) {
  const document = /^related-document-([a-z-]+)$/.exec(type || '');
  if (document) {
    const code = document[1];
    return validOrigin(code) || 'other';
  }
  if (['scp-series', 'joke-scps', 'scp-ex'].includes(type)) return 'en';
  const match = /^(?:scp-series-|joke-scps-)([a-z][a-z-]*)$/.exec(type || '') ||
    /^scp-([a-z][a-z-]*)-ex$/.exec(type || '');
  return match?.[1] || null;
}

function classify(node, record, catalogEntries, knownBranches) {
  const candidates = (catalogEntries || []).filter(e => branchForPageType(e.pageType));
  // A page's own catalog is authoritative if another delivery catalog disagrees.
  const own = candidates.filter(e => e.language === node.siteBranch);
  const applicable = own.length ? own : candidates;
  const distinct = [...new Set(applicable.map(e => e.pageType))].sort();
  if (distinct.length === 1) return { branch: branchForPageType(distinct[0]), pageType: distinct[0], basis: 'catalog_page_type' };
  if (distinct.length > 1) {
    const branches = [...new Set(distinct.map(branchForPageType))];
    return { branch: branches.length === 1 ? branches[0] : 'other', pageType: '', basis: 'conflicting_catalog_types' };
  }

  // Publisher-assigned origin tags also cover non-catalog logs and tales.
  const aliases = { 'zh-tr': 'zh' };
  const tags = [...new Set((record?.tags || []).map(t => t.replace(/^филиал:/u, ''))
    .map(t => aliases[t] || t).filter(t => knownBranches.has(t)))];
  if (tags.length === 1) return { branch: tags[0], pageType: '', basis: 'publisher_origin_tag' };
  if (tags.length > 1) return { branch: 'other', pageType: '', basis: 'multiple_origin_tags' };

  // Canonical SCP identifiers are a fallback only for pages absent from catalogs.
  const scp = /^scp-(?:([a-z][a-z-]*)-)?(\d+)(?:-(.*))?$/.exec(node.slug);
  if (scp) {
    const suffix = scp[3]?.split('-') || [];
    const code = scp[1] || suffix.find(s => knownBranches.has(s));
    if (code && !knownBranches.has(code)) return { branch: 'other', pageType: '', basis: 'unknown_identifier' };
    const branch = code || 'en';
    const family = suffix.includes('j') ? 'joke-scps' : suffix.includes('ex') ? 'scp-ex' : 'scp-series';
    const pageType = branch === 'en' ? family : family === 'scp-ex' ? `scp-${branch}-ex` : `${family}-${branch}`;
    return { branch, pageType, basis: 'scp_identifier' };
  }
  // A log's hosting language alone is not proof of its original branch.
  return { branch: 'other', pageType: '', basis: 'unclassified' };
}

function classifyNodes(nodes, records, entries) {
  const knownBranches = new Set(['en', ...Object.keys(LANGUAGES).map(x => x === 'zh-tr' ? 'zh' : x),
    ...[...entries.values()].flatMap(list => list.map(e => branchForPageType(e.pageType)).filter(Boolean))]);
  const byId = new Map(nodes.map(n => [n.id, n]));
  for (const node of nodes) {
    if (node.classificationSourceId) continue;
    const result = classify(node, records.get(node.id)?.record, entries.get(node.id), knownBranches);
    node.branch = result.branch;
    node.pageType = result.pageType;
    node.classificationBasis = result.basis;
  }
  for (const node of nodes) if (node.classificationSourceId) {
    const source = byId.get(node.classificationSourceId);
    node.branch = source.branch;
    node.pageType = '';
    node.classificationBasis = 'source_document';
  }
}
module.exports = { branchForPageType, classifyNodes };
