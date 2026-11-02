'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { normalizePage, digest, EXTRACTOR_VERSION } = require('./core');
const {rowsHash,writeRows}=require('./jsonl');
const crypto=require('node:crypto');
const { TYPES, pageKind } = require('./semantics');
const { atomicJson, recordFiles } = require('./store');

function catalogIndex(catalogDir) {
  const pages = new Map();
  const catalogs = [];
  for (const lang of fs.readdirSync(catalogDir).sort()) {
    const file = path.join(catalogDir, lang, 'scp-data.json');
    if (!fs.existsSync(file)) continue;
    const bytes = fs.readFileSync(file);
    const catalog = JSON.parse(bytes);
    if (!Array.isArray(catalog.data) || !catalog.data.length) throw new Error(`Empty catalog: ${lang}`);
    catalogs.push({ language: lang, count: catalog.data.length, timestamp: catalog.timestamp,
      sha256: digest(bytes) });
    for (const row of catalog.data) {
      const actual = row.isTranslatedJP !== false && row.urlJP ? row.urlJP : row.urlEN;
      const page = normalizePage(actual);
      if (!page) continue;
      let node = pages.get(page.id);
      if (!node) {
        node = { ...page, kind: 'page', title: page.slug, catalogEntries: [], coverage: 'unfetched' };
        pages.set(page.id, node);
      }
      const entry = { language: lang, itemId: row.itemId, title: row.titleJP,
        pageType: row.pageType, catalogTimestamp: catalog.timestamp };
      node.catalogEntries.push(entry);
      if (lang === page.branch || node.title === page.slug) node.title = row.titleJP || page.slug;
    }
  }
  if (!catalogs.length) throw new Error('No catalogs found');
  return { pages, catalogs };
}

function buildGraph({ catalogDir, recordDirs, now = new Date().toISOString(), maxAgeDays = 14 }) {
  const { pages, catalogs } = catalogIndex(catalogDir);
  const records = new Map();
  for (const dir of recordDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of recordFiles(dir)) {
      const state = JSON.parse(fs.readFileSync(file, 'utf8'));
      const r = state.record;
      const identity = normalizePage(r?.url || state.url);
      if (!identity) throw new Error(`Invalid identity: ${file}`);
      if (r && (identity.id !== r.pageId || !/^[a-f0-9]{64}$/.test(r.contentSha256))) throw new Error(`Invalid record: ${file}`);
      const previous = records.get(identity.id);
      const valid = [2, EXTRACTOR_VERSION].includes(r?.extractorVersion) ? r : null;
      const record = !previous?.record || (valid && valid.checkedAt > previous.record.checkedAt) ? valid : previous.record;
      const lastAttempt = !previous?.lastAttempt || state.lastAttempt?.at > previous.lastAttempt.at ? state.lastAttempt : previous.lastAttempt;
      records.set(identity.id, { url: identity.url, record, lastAttempt });
    }
  }
  const edges = new Map();
  const addPage = url => {
    const p = normalizePage(url);
    if (!p) return null;
    if (!pages.has(p.id)) pages.set(p.id, { ...p, kind: 'page', title: p.slug, catalogEntries: [], coverage: 'unfetched' });
    return pages.get(p.id);
  };
  const ageLimit = new Date(now).getTime() - maxAgeDays * 86400000;
  const stats = { fetched: 0, stale: 0, failedRefresh: 0, missing: 0, failed: 0 };
  for (const { url, record: r, lastAttempt } of records.values()) {
    if (!r) {
      const node = addPage(url);
      node.coverage = lastAttempt?.status === 'not_found' ? 'missing' : 'failed';
      node.lastAttempt = lastAttempt;
      stats[node.coverage]++;
      continue;
    }
    const source = addPage(r.url);
    const failed = lastAttempt && !['success', 'not_modified'].includes(lastAttempt.status);
    const missing = failed && lastAttempt.status === 'not_found';
    const stale = failed || new Date(r.checkedAt).getTime() < ageLimit;
    source.title = r.title || source.title;
    source.coverage = missing ? 'missing' : stale ? 'stale' : 'fetched';
    source.checkedAt = r.checkedAt;
    source.contentSha256 = r.contentSha256;
    source.authors = r.authors;
    source.pageKind = pageKind(source, r);
    source.limitations = r.limitations;
    if (failed) source.lastAttempt = lastAttempt;
    stats[missing ? 'missing' : stale ? 'stale' : 'fetched']++;
    if (failed) stats.failedRefresh++;
    const provenance = { sourceUrl: r.url, checkedAt: r.checkedAt, contentSha256: r.contentSha256,
      extractorVersion: r.extractorVersion, format: r.format };
    for (const [type, items] of [['references', r.links], ['translation_assertion', r.translations], ...Object.keys(TYPES).filter(t => !['references','translation_assertion'].includes(t)).map(t => [t, (r.semanticRelations || []).filter(x => x.type === t)])]) {
      for (const item of items || []) {
        let target;
        if(item.targetEntity && type==='member_of') {
          const entity=item.targetEntity;
          const id=`entity:${source.id}/${entity.key}`;
          if(!/^[a-z0-9-]+$/.test(entity.key)) throw new Error('Invalid entity key');
          target={id,kind:'entity',title:entity.title,slug:entity.title,branch:source.branch,host:source.host,url:source.url,coverage:source.coverage,pageKind:{type:'organization',basis:'reviewed_source_assertion'},context:source.id};
          pages.set(id,target);
        } else target = addPage(item.target);
        const subject = item.subject ? addPage(item.subject) : source;
        if (!target || !subject || target.id === subject.id) continue;
        const key = `${subject.id}\0${type}\0${target.id}`;
        let edge = edges.get(key);
        if (!edge) {
          edge = { id: `edge:${digest(key)}`, source: subject.id, target: target.id, type,
            stale, inactive: !!missing, evidence: [] };
          edges.set(key, edge);
        }
        edge.evidence.push({ ...provenance, stale, inactive:!!missing, location: item.location, sourceAnchor: item.sourceAnchor || null, ...(item.quote ? {quote:item.quote, note:item.note, method:item.method} : {}), ...(item.section ? {section:item.section} : {}) });
      }
    }
    // Tags are a separate bipartite layer, not fabricated pairwise story relationships.
    for (const label of [...new Set(r.tags || [])].sort()) {
      const targetId = `tag:${source.host}/${encodeURIComponent(label)}`;
      if (!pages.has(targetId)) pages.set(targetId, { id: targetId, kind: 'tag', title: label,
        branch: source.branch, url: `https://${source.host}/system:page-tags/tag/${encodeURIComponent(label)}` });
      const key = `${source.id}\0has_tag\0${targetId}`;
      edges.set(key, { id: `edge:${digest(key)}`, source: source.id, target: targetId,
        type: 'has_tag', stale, inactive: !!missing, evidence: [{ ...provenance, location: 'page_tags' }] });
    }
  }
  for (const e of edges.values()) if(e.type !== 'has_tag') {
    e.inactive=e.evidence.every(p=>p.inactive);
    e.stale=!e.inactive && e.evidence.every(p=>p.inactive || p.stale);
  }
  for (const n of pages.values()) if (n.kind === 'page' && !n.pageKind) n.pageKind = pageKind(n);
  const nodes = [...pages.values()].sort((a, b) => a.id.localeCompare(b.id, 'en'));
  const relations = [...edges.values()].sort((a, b) => a.id.localeCompare(b.id, 'en'));
  const pageNodes = nodes.filter(n => n.kind === 'page');
  const byBranch = {};
  for (const n of pageNodes) {
    byBranch[n.branch] ||= { pages: 0, fetched: 0, stale: 0, missing: 0, failed: 0, unfetched: 0 };
    byBranch[n.branch].pages++; byBranch[n.branch][n.coverage]++;
  }
  const manifest = { schemaVersion: 1, extractorVersion: EXTRACTOR_VERSION, generatedAt: now,
    license: 'CC-BY-SA-3.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    identity: 'page_url; translations remain separate pages; no inferred work merges',
    catalogs, counts: { nodes: nodes.length, pages: pageNodes.length, edges: relations.length,
      ...stats, unfetched: pageNodes.filter(n => n.coverage === 'unfetched').length }, byBranch,
    semanticCoverage: {scope:'source_specific_reviewed_assertions_only',
      counts:Object.fromEntries(Object.keys(TYPES).map(t=>[t,relations.filter(e=>e.type===t && !e.inactive && !e.stale).length])),
      warning:'意味的な関係の調査は一部のみです。種類の定義は全件調査済みという意味ではありません。'},
    edgeTypes: { ...TYPES, references: 'An explicit article-body link, not a claim of shared canon or interaction',
      has_tag: 'A publisher-assigned tag; same labels on different branches remain separate',
      translation_assertion: 'An explicit alternate-language/source assertion; not automatically merged' } };
  return { manifest, nodes, edges: relations };
}

function publishGraph(graph, outputDir) {
  const combined=crypto.createHash('sha256');
  const nodeHash=rowsHash(graph.nodes,combined),edgeHash=rowsHash(graph.edges,combined);
  const revision=combined.digest('hex').slice(0,20);
  const dir = path.join(outputDir, 'revisions', revision);
  fs.mkdirSync(dir, { recursive: true });
  function immutable(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      if (digest(fs.readFileSync(file)) !== digest(value)) throw new Error('Immutable graph content changed');
      return;
    }
    fs.writeFileSync(file, value, { flag: 'wx' });
  }
  writeRows(path.join(dir,'nodes.jsonl'),graph.nodes,nodeHash);
  writeRows(path.join(dir,'edges.jsonl'),graph.edges,edgeHash);
  const files={nodes:{path:`revisions/${revision}/nodes.jsonl`,sha256:nodeHash},edges:{path:`revisions/${revision}/edges.jsonl`,sha256:edgeHash}};
  const buckets = new Map();
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
  const bucketOf = id => digest(id).slice(0, 2);
  for (const n of graph.nodes) {
    const key = bucketOf(n.id);
    if (!buckets.has(key)) buckets.set(key, { roots: [], edges: [], neighbors: new Map() });
    buckets.get(key).roots.push(n);
  }
  for (const e of graph.edges) {
    for (const key of new Set([bucketOf(e.source), bucketOf(e.target)])) {
      const bucket = buckets.get(key);
      bucket.edges.push(e);
      for (const id of new Set([e.source, e.target,...e.evidence.map(p=>normalizePage(p.sourceUrl)?.id).filter(Boolean)])) if (bucketOf(id) !== key) {
        const n = nodeMap.get(id);
        bucket.neighbors.set(id, { id, title: n.title, kind: n.kind, url: n.url,
          branch: n.branch, slug: n.slug, coverage: n.coverage, pageKind:n.pageKind, contentSha256:n.contentSha256 });
      }
    }
  }
  const shards = {};
  for (const [key, b] of [...buckets].sort()) {
    const text = JSON.stringify({ schemaVersion: 1, bucket: key, roots: b.roots, edges: b.edges,
      neighbors: [...b.neighbors.values()].sort((a, b) => a.id.localeCompare(b.id, 'en')) });
    const hash = digest(text);
    const file = `chunks/${hash}.json`;
    immutable(path.join(outputDir, file), text);
    shards[key] = { path: file, sha256: hash, bytes: Buffer.byteLength(text) };
  }
  // Install the pointer last: readers never see a half-written graph.
  atomicJson(path.join(outputDir, 'manifest.json'), { ...graph.manifest, revision, files,
    partition: 'first two lowercase hex digits of SHA-256(UTF-8 page/tag id)', shards });
  return revision;
}

function importRecords(fromDir, toDir) {
  if (!fs.existsSync(fromDir)) return 0;
  let imported = 0;
  for (const name of recordFiles(fromDir)) {
    const incoming = JSON.parse(fs.readFileSync(name, 'utf8'));
    const identity = normalizePage(incoming.record?.url || incoming.url);
    if (!identity) throw new Error(`Invalid source snapshot: ${name}`);
    const target = path.join(toDir, `${digest(identity.id)}.json`);
    const previous = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : {};
    const record = !previous.record || incoming.record?.checkedAt > previous.record.checkedAt ? incoming.record : previous.record;
    const lastAttempt = !previous.lastAttempt || incoming.lastAttempt?.at > previous.lastAttempt.at ? incoming.lastAttempt : previous.lastAttempt;
    atomicJson(target, { url: identity.url, record: record || null, lastAttempt });
    imported++;
  }
  return imported;
}

if (require.main === module) {
  const root = path.join(__dirname, '..');
  importRecords(path.join(root, 'partial-data', 'relations'), path.join(__dirname, '.cache', 'records'));
  const graph = buildGraph({ catalogDir: path.join(root, 'local-data'), recordDirs: [
    path.join(__dirname, '.cache', 'records'), path.join(root, 'partial-data', 'relations') ] });
  const revision = publishGraph(graph, path.join(__dirname, 'output'));
  console.log(JSON.stringify({ revision, ...graph.manifest.counts, byBranch: graph.manifest.byBranch }, null, 2));
}
module.exports = { catalogIndex, buildGraph, publishGraph, importRecords };
