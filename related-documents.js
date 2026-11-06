'use strict';
// Catalog enrichment only: no graph, layout, or changes to existing work IDs.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const axios = require('axios');
const { JSDOM, VirtualConsole } = require('jsdom');
const { LANGUAGES } = require('./languages');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const hosts = new Map(Object.entries(LANGUAGES).map(([language, config]) => [new URL(config.baseUrl).hostname, language]));
hosts.set('scpfoundation.net', 'ru');
const aliases = new Map(['scp-wiki.net', 'www.scp-wiki.net', 'scpwiki.com', 'www.scpwiki.com'].map(h => [h, 'scp-wiki.wikidot.com']));
aliases.set('www.scpfoundation.net', 'scpfoundation.net');
const excluded = 'script,style,iframe,noscript,.page-tags,.licensebox,.license-box,.credit,.credit-box,#u-credit-view,.footer-wikiwalk-nav,.page-navigation,.interwiki-box,[role="navigation"],#toc,.toc';

function normalize(value, base) {
  try {
    const u = new URL(value, base), host = aliases.get(u.hostname) || u.hostname;
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port || !hosts.has(host)) return null;
    if (u.search && [...u.searchParams.keys()].some(k => !['utm_source', 'utm_medium', 'utm_campaign'].includes(k))) return null;
    const slug = decodeURIComponent(u.pathname).replace(/^\/+|\/+$/g, '').toLowerCase();
    if (!/^[\p{L}\p{N}][\p{L}\p{N}_:-]*$/u.test(slug) || /^(?:system|admin|forum|user|component|theme|nav|fragment|css|template|category):/.test(slug)) return null;
    return { url: `https://${host}/${encodeURI(slug)}`, language: hosts.get(host), slug };
  } catch { return null; }
}

function extractHtml(url, html, now = new Date().toISOString(), existingDocument = null) {
  const page = normalize(url);
  if (!page) throw Error('Unsupported document URL');
  const dom = existingDocument ? null : new JSDOM(String(html), { url: page.url, virtualConsole: new VirtualConsole() });
  try {
    const d = existingDocument || dom.window.document, root = d.querySelector('#page-content')?.cloneNode(true);
    const title = (d.querySelector('#page-title')?.textContent || d.title || '').trim();
    if (!root || !title || d.querySelector('#page-content .error-block,.page-not-found') || /^(?:page not found|page does not exist|access denied|security check|just a moment)/i.test(title)) throw Error('Not an article page');
    const tags = [...d.querySelectorAll('.page-tags a')].map(a => a.textContent.trim()).filter(Boolean);
    const translations = [...d.querySelectorAll('a[rel~="alternate"][hreflang],link[rel~="alternate"][hreflang],.translation-source a[href],a[data-translation-source]')]
      .map(a => normalize(a.getAttribute('href'), page.url)?.url).filter(Boolean);
    const authors = [...d.querySelectorAll('.licensebox a,.credit a,#u-credit-view a')]
      .filter(a => /wikidot\.com\/user:info\//i.test(a.href)).map(a => ({ name: a.textContent.trim(), url: a.href }));
    for (const n of root.querySelectorAll(excluded)) n.remove();
    const links = [...new Set([...root.querySelectorAll('a[href]')].filter(a => !a.classList.contains('newpage') && !a.getAttribute('href').startsWith('#'))
      .map(a => normalize(a.getAttribute('href'), page.url)?.url).filter(v => v && v !== page.url))].sort();
    return { ...page, title, tags, translations: [...new Set(translations)].sort(), authors,
      links, descriptionExcerpt: root.textContent.trim().replace(/\s+/g, ' ').slice(0, 250),
      contentSha256: hash(String(html)), checkedAt: now, format: 'html' };
  } finally { dom?.window.close(); }
}

function extractApi(url, article, now = new Date().toISOString()) {
  const page = normalize(url);
  if (!page || !article?.title || typeof article.source !== 'string' || !article.source.trim()) throw Error('Invalid API article');
  const source = article.source, links = new Set();
  for (const match of source.matchAll(/\[\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\]/g)) {
    const target = normalize(match[1].trim(), `${page.url}/../`);
    if (target && target.url !== page.url) links.add(target.url);
  }
  return { ...page, title: article.title, tags: (article.tags || []).map(t => typeof t === 'string' ? t : t.name).filter(Boolean),
    links: [...links].sort(), translations: [], authors: [], format: 'ftml', contentSha256: hash(source), checkedAt: now,
    descriptionExcerpt: source.replace(/\[\[[\s\S]*?\]\]/g, ' ').replace(/\s+/g, ' ').slice(0, 250) };
}

function capture(url, body, format = 'html', directory = path.join(__dirname, 'partial-data/related-documents'), existingDocument = null) {
  // Enrichment must not break a successful ordinary catalog crawl.
  try {
    const record = format === 'html' ? extractHtml(url, body, undefined, existingDocument) : extractApi(url, body);
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `${hash(record.url)}.json`);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(record)); fs.renameSync(`${file}.tmp`, file);
    return true;
  } catch (error) { console.warn(`Related document capture skipped: ${url}: ${error.message}`); return false; }
}

function readCatalogs(root) {
  return Object.keys(LANGUAGES).flatMap(language => {
    const file = path.join(root, language, 'scp-data.json');
    if (!fs.existsSync(file)) return [];
    const catalog = JSON.parse(fs.readFileSync(file));
    if (!Array.isArray(catalog.data)) throw Error(`Invalid catalog ${language}`);
    return catalog.data.map(row => ({ ...row, language }));
  });
}

function loadCache(directory) {
  const records = new Map(), attempts = new Map();
  if (fs.existsSync(directory)) for (const name of fs.readdirSync(directory).filter(n => /^[a-f0-9]{2}\.json\.gz$/.test(n))) {
    const rows = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(directory, name))));
    for (const row of rows) {
      const page = normalize(row.url);
      if (!page || page.url !== row.url) throw Error('Invalid cache URL');
      if (row.record) records.set(row.url, row.record);
      if (row.attempt) attempts.set(row.url, row.attempt);
    }
  }
  return { records, attempts };
}
function saveCache(directory, records, attempts) {
  fs.mkdirSync(directory, { recursive: true });
  const shards = new Map();
  for (const url of [...new Set([...records.keys(), ...attempts.keys()])].sort()) {
    const key = hash(url).slice(0, 2);
    if (!shards.has(key)) shards.set(key, []);
    shards.get(key).push({ url, record: records.get(url) || null, attempt: attempts.get(url) || null });
  }
  for (const [key, rows] of shards) {
    const file = path.join(directory, `${key}.json.gz`);
    fs.writeFileSync(`${file}.tmp`, zlib.gzipSync(JSON.stringify(rows), { level: 9 })); fs.renameSync(`${file}.tmp`, file);
  }
}
function importRecords(directory, records) {
  if (!directory || !fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { importRecords(file, records); continue; }
    const rows = /^[a-f0-9]{64}\.json$/.test(entry.name) ? [JSON.parse(fs.readFileSync(file))] :
      /^[a-f0-9]{2}\.json\.gz$/.test(entry.name) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(file))) : [];
    for (const row of rows) {
      const r = row.record || row;
      const page = normalize(r.url);
      if (!page || !r.title || !r.contentSha256) continue;
      const record = { ...page, title: r.title, tags: r.tags || [], authors: r.authors || [], format: r.format,
        checkedAt: r.checkedAt, contentSha256: r.contentSha256, descriptionExcerpt: r.descriptionExcerpt || '',
        links: (r.links || []).map(v => normalize(typeof v === 'string' ? v : v.target)?.url).filter(Boolean),
        translations: (r.translations || []).map(v => normalize(typeof v === 'string' ? v : v.target)?.url).filter(Boolean) };
      if (!records.has(page.url) || record.checkedAt > records.get(page.url).checkedAt) records.set(page.url, record);
    }
  }
}

function branchOfType(type) {
  if (['scp-series', 'joke-scps', 'scp-ex'].includes(type)) return 'en';
  return /^(?:scp-series-|joke-scps-)([a-z-]+)$/.exec(type || '')?.[1] || /^scp-([a-z-]+)-ex$/.exec(type || '')?.[1] || null;
}
function classify(url, records, catalogByUrl, visited = new Set()) {
  if (visited.size >= 20) return { branch: null, basis: 'translation_depth_limit', evidence: [] };
  if (visited.has(url)) return { branch: null, basis: 'translation_cycle', evidence: [] };
  const next = new Set([...visited, url]);
  const entries = catalogByUrl.get(url) || [];
  const branches = [...new Set(entries.map(e => branchOfType(e.pageType)).filter(Boolean))];
  if (branches.length === 1) return { branch: branches[0], basis: 'catalog_page_type', evidence: entries.map(e => ({ itemId: e.itemId, pageType: e.pageType })) };
  if (branches.length > 1) return { branch: null, basis: 'conflicting_catalog_types', evidence: branches };
  const r = records.get(url), known = new Set(['en', 'zh', ...Object.keys(LANGUAGES)]);
  const tags = [...new Set((r?.tags || []).map(t => t.replace(/^филиал:/u, '')).map(t => t === 'zh-tr' ? 'zh' : t).filter(t => known.has(t)))];
  if (tags.length) return { branch: tags.length === 1 ? tags[0] : null, basis: tags.length === 1 ? 'publisher_origin_tag' : 'conflicting_origin_tags', evidence: tags };
  const translated = (r?.translations || []).map(target => ({ target, ...classify(target, records, catalogByUrl, next) })).filter(v => v.branch);
  const origins = [...new Set(translated.map(v => v.branch))];
  if (origins.length) return { branch: origins.length === 1 ? origins[0] : null, basis: origins.length === 1 ? 'explicit_translation_metadata' : 'conflicting_translation_metadata', evidence: translated };
  const slug = normalize(url).slug, m = /^scp-(?:([a-z][a-z-]*)-)?(\d+)(?:-(.*))?$/.exec(slug);
  if (m) {
    const tokens = (m[3] || '').split('-'), branch = m[1] || tokens.find(t => known.has(t)) || 'en';
    if (known.has(branch)) return { branch, basis: 'scp_identifier', evidence: [slug] };
  }
  return { branch: null, basis: r ? 'insufficient_origin_evidence' : 'not_fetched', evidence: [] };
}

function buildCatalogs(catalogs, records, attempts, now = new Date().toISOString()) {
  const seeds = new Map(), sources = new Map();
  for (const entry of catalogs) {
    const page = normalize(entry.isTranslatedJP !== false && entry.urlJP ? entry.urlJP : entry.urlEN);
    if (!page) continue;
    if (!seeds.has(page.url)) seeds.set(page.url, []);
    seeds.get(page.url).push(entry);
  }
  // Only catalog article bodies discover candidates. Additional documents do not recursively expand the queue.
  for (const [url, entries] of seeds) for (const target of records.get(url)?.links || []) {
    if (seeds.has(target) || !normalize(target)) continue;
    if (!sources.has(target)) sources.set(target, new Set());
    for (const entry of entries) sources.get(target).add(entry.itemId);
  }
  const data = [], pending = [];
  for (const [url, ids] of [...sources].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    const r = records.get(url), page = normalize(url), origin = classify(url, records, seeds);
    const attempt = attempts.get(url);
    const discovery = { url, language: page.language, sourceArticleIds: [...ids].sort(), lastAttempt: attempt || null };
    if (!r) { pending.push({ ...discovery, status: attempt?.status || 'pending' }); continue; }
    // Explicitly retired/non-article pages stay in the queue for later rechecks, not the usable catalog.
    if (['not_found', 'not_article'].includes(attempt?.status) && attempt.at >= r.checkedAt) { pending.push({ ...discovery, status: attempt.status }); continue; }
    const kind = /^(?:experiment|test|exploration)(?:-|:)|(?:^|-)log(?:-|$)/i.test(page.slug) ? 'log' :
      (r.tags || []).some(t => ['tale', 'tale-jp', 'tale-cn', 'рассказ'].includes(t)) ? 'tale' :
      (r.tags || []).some(t => ['hub', 'ハブ'].includes(t)) ? 'hub' : 'document';
    data.push({ itemId: `document-${page.language}--${page.slug}`, url, language: page.language, title: r.title,
      contentType: kind, pageType: origin.branch ? `related-document-${origin.branch}` : 'related-document-unclassified',
      originBranch: origin.branch, classification: origin, sourceArticleIds: discovery.sourceArticleIds,
      tags: r.tags, authors: r.authors, descriptionExcerpt: r.descriptionExcerpt, translationUrls: r.translations,
      contentSha256: r.contentSha256, lastUpdated: r.checkedAt, fetchStatus: attempt?.status === 'failed' && attempt.at >= r.checkedAt ? 'stale' : 'success' });
  }
  return { schemaVersion: 1, timestamp: now, totalCount: data.length, data, pending,
    statistics: { catalogPages: seeds.size, catalogPagesCaptured: [...seeds.keys()].filter(url => records.has(url)).length,
      discoveredDocuments: sources.size, classified: data.filter(r => r.originBranch).length, unclassified: data.filter(r => !r.originBranch).length, pending: pending.length } };
}

async function fetchRecord(url) {
  const page = normalize(url);
  if (!page) throw Error('Unsupported URL');
  // Validate every redirect so an allowlisted link cannot redirect requests to arbitrary hosts.
  const request = async (target, depth = 0) => {
    if (!normalize(target) || depth > 5) throw Error('Unsupported redirect');
    const response = await axios.get(target, { timeout: 20000, maxRedirects: 0, maxContentLength: 4 * 1024 * 1024,
      validateStatus: s => (s >= 200 && s < 400), headers: { 'User-Agent': 'SCPReaderCatalog/1.0', Accept: 'text/html,application/json' } });
    if (response.status >= 300) return request(new URL(response.headers.location, target).href, depth + 1);
    return response.data;
  };
  if (page.language === 'ru') {
    // This endpoint is deliberately constructed here, never accepted as a discovered URL.
    const response = await axios.get(`https://scpfoundation.net/api/articles/${encodeURIComponent(page.slug)}`, {
      timeout: 20000, maxRedirects: 0, maxContentLength: 4 * 1024 * 1024, headers: { Accept: 'application/json' },
    });
    return extractApi(url, response.data);
  }
  const configuredScheme = new URL(LANGUAGES[page.language].baseUrl).protocol;
  return extractHtml(url, await request(url.replace(/^https:/, configuredScheme)));
}

async function run({ root = __dirname, maxRequests = 300, intervalMs = 500, maxDurationMs = 180000, request = fetchRecord, importDirectory = null, now = new Date().toISOString() } = {}) {
  const startedAt = Date.now();
  const base = path.join(root, 'local-data'), cache = path.join(base, 'related-document-cache');
  const { records, attempts } = loadCache(cache), catalogs = readCatalogs(base);
  if (!catalogs.length) throw Error('No source catalogs');
  importRecords(importDirectory, records);
  importRecords(path.join(root, 'partial-data/related-documents'), records);
  const before = buildCatalogs(catalogs, records, attempts, now);
  const seedUrls = catalogs.map(e => normalize(e.isTranslatedJP !== false && e.urlJP ? e.urlJP : e.urlEN)?.url).filter(Boolean);
  const documents = [...before.pending.map(r => r.url), ...before.data.map(r => r.url)];
  const age = url => Date.parse(records.get(url)?.checkedAt || '1970-01-01');
  const priority = url => Math.max(age(url), Date.parse(attempts.get(url)?.at || '1970-01-01'));
  const eligible = url => (!records.has(url) || Date.parse(now) - age(url) >= 7 * 86400000) &&
    (!attempts.has(url) || Date.parse(now) - Date.parse(attempts.get(url).at) >= (['not_found', 'not_article'].includes(attempts.get(url).status) ? 28 : 7) * 86400000);
  // Reserve some requests for missing seed bodies, so discovery and enrichment both progress.
  const seeds = [...new Set(seedUrls)].filter(eligible).sort((a, b) => priority(a) - priority(b) || a.localeCompare(b));
  const docs = [...new Set(documents)].filter(eligible).sort((a, b) => priority(a) - priority(b) || a.localeCompare(b));
  const seedBudget = docs.length ? Math.ceil(maxRequests / 4) : maxRequests;
  const queue = [...seeds.slice(0, seedBudget), ...docs, ...seeds.slice(seedBudget)].slice(0, maxRequests);
  let fetched = 0;
  for (const url of queue) {
    if (Date.now() - startedAt >= maxDurationMs) break;
    if (fetched && intervalMs) await new Promise(resolve => setTimeout(resolve, intervalMs));
    try { records.set(url, await request(url)); attempts.set(url, { status: 'success', at: now }); }
    catch (error) {
      const status = error.response?.status === 404 || error.response?.status === 410 ? 'not_found' : /Not an article|Invalid API article/.test(error.message) ? 'not_article' : 'failed';
      attempts.set(url, { status, at: now, httpStatus: error.response?.status || null });
    }
    fetched++;
    if (fetched % 25 === 0) console.log(`Related documents: ${fetched}/${queue.length}`);
  }
  saveCache(cache, records, attempts);
  const result = buildCatalogs(catalogs, records, attempts, now);
  const output = path.join(base, 'related-documents'); fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'catalog.json.tmp'), JSON.stringify(result));
  fs.renameSync(path.join(output, 'catalog.json.tmp'), path.join(output, 'catalog.json'));
  fs.writeFileSync(path.join(output, 'catalog.json.gz'), zlib.gzipSync(JSON.stringify(result), { level: 9 }));
  console.log(JSON.stringify({ ...result.statistics, requests: fetched }));
  return result;
}
if (require.main === module) {
  const count = Number(process.env.RELATED_DOCUMENT_MAX_REQUESTS ?? 300);
  if (!Number.isInteger(count) || count < 0 || count > 1000) throw Error('Invalid request limit');
  run({ maxRequests: count, importDirectory: process.env.RELATED_DOCUMENT_IMPORT_DIR || null }).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { normalize, extractHtml, extractApi, capture, classify, buildCatalogs, run };
