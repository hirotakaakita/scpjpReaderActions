'use strict';
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const axios = require('axios');
const crypto = require('node:crypto');
const { JSDOM, VirtualConsole } = require('jsdom');
const { LANGUAGES } = require('./languages');
const { normalize, fetchRecord, loadCache } = require('./related-documents');
const { inspectArticlePage } = require('./article-page');
const sourcesFile = require('./catalog-index-sources.json');
const { validOrigin } = require('./catalog-origin');
const VERSION = 1;
const PARSER_VERSION = 5;
const excludedPath = /(?:^|[-:])(?:guide|guides|artwork|authors?|members|contest|concurs|concorso|essay|news|translation-reservation|tag-guide|licensing)(?:[-:]|$)/i;
const excludedTags = new Set(['artwork','artist','author','authors','author-page','guide','guidelines','essay','contest','contest-hub','news','著者ページ','アートワーク','ガイド','エッセイ','コンテスト','作者','艺术作品','指导','страница_автора','структура:страница_автора','структура:руководство','структура:конкурс']);
for(const tag of ['autor','auteur','autore','작가','автор','tác-giả','hướng-dẫn','藝術作品','hội-họa','_bild','안내'])excludedTags.add(tag);
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
function originHint(url) {
  const p = new URL(url).pathname;
  const special = {'/liste-fr':'fr','/lista-pl':'pl','/scp-it-serie-i':'it','/racconti-italiani':'it','/gdi-it-serie-i':'it',
    '/centre-des-contes-francais':'fr','/centre-des-canons-francais':'fr','/contos-da-fundacao':'pt','/formatos-gdi':'pt','/scp-de-geschichten':'de','/relatos-de-la-fundacion-hispanoparlante':'es','/formatos-de-gdi':'es'};
  if (special[p]) return special[p];
  const nativeLog = /^\/(?:log-of-anomalous-items|log-of-extranormal-events|log-of-unexplained-locations|supplement-hub|anthology-hub)-([a-z]{2})(?:\/|$)/.exec(p);
  if (nativeLog) return validOrigin(nativeLog[1]);
  const tale = /\/tales-([a-z]+)-by-/.exec(p) || /\/tales-by-(?:author|title|page-name|create-time|date|year)-([a-z]+)$/.exec(p);
  if (tale) return validOrigin(tale[1]);
  const m = /(?:foundation-tales|canon-hub|goi-formats|scp-series|scp-list|serie-scp|scp-serie|joke-scps|scp-ex)-([a-z]+)(?:-\d+)?$/.exec(p) || /\/series-\d+-([a-z]+)$/.exec(p);
  if (m) return validOrigin(m[1]);
  return null;
}
function pageUrl(value, base) {
  try {
    const u = new URL(value, base), root = new URL(base);
    if (!/^https?:$/.test(u.protocol) || u.hostname !== root.hostname || u.username || u.password || u.port || u.search) return null;
    u.protocol = 'https:'; u.hash = ''; return u.href;
  } catch { return null; }
}
function isPager(url, source) {
  const base = new URL(source).pathname.replace(/\/$/, ''), p = new URL(url).pathname;
  // Do not enumerate sort/tag combinations or arbitrary paths.
  return p.startsWith(base + '/') && /^(?:\/(?:p|offset|page\d+_(?:limit|offset))\/\d+)+$/.test(p.slice(base.length));
}
function isExcluded(url, tags = []) {
  return (!isWorkIndex(url) && excludedPath.test(new URL(url).pathname.slice(1))) || tags.some(t => excludedTags.has(String(t).toLowerCase()));
}
function isWorkIndex(url) {
  return /^\/(?:tales(?:-[a-z]+)?-by-(?:author|title|page-name|create-time|date|year)(?:-[a-z]+)?|tales-by-year)$/.test(new URL(url).pathname);
}
function parseIndex(html, source, registry, { embedded = false } = {}) {
  const dom = new JSDOM(String(html).replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ''), { url: source.url, virtualConsole: new VirtualConsole() });
  try {
    const d = dom.window.document;
    const availability = embedded ? { usable: true } : inspectArticlePage(d);
    if (!availability.usable) throw Error('Index unavailable: ' + availability.reason);
    const content = (d.querySelector('#page-content') || (embedded ? d.body : null))?.cloneNode(true);
    if (!content) throw Error('Missing index body');
    for (const e of content.querySelectorAll('script,style,noscript,nav,[role="navigation"],.page-navigation,.footer-wikiwalk-nav,.licensebox,.credit,.credit-box,#u-credit-view,#toc,.toc,.page-rate-widget-box,.authorbox')) e.remove();
    const members = new Map(), pages = new Set(), missing = new Set(), embeds = new Set(), childIndexes = new Set();
    const structured = !!content.querySelector('li a[href],td a[href],.list-pages-item a[href],.list-pages-box a[href]');
    let origin = validOrigin(source.origin) || originHint(source.root || source.url), section = '';
    const sourceOrigin = origin;
    const headings = [];
    for (const e of content.querySelectorAll('h1,h2,h3,a[href]')) {
      if (/^H[123]$/.test(e.tagName)) {
        section = clean(e.textContent);
        const level = Number(e.tagName[1]);
        while (headings.length && headings.at(-1).level >= level) headings.pop();
        const branch = /^SCP[- ](EN|RU|KO|CN|FR|PL|ES|TH|JP|DE|IT|UA|PT(?:\/BR)?|CS|SK|ZH(?:-TR)?|VN|INT|ID)\b/i.exec(section);
        origin = branch ? validOrigin(branch[1].toLowerCase().replace('pt/br','pt')) : headings.at(-1)?.origin ?? sourceOrigin;
        headings.push({ level, origin });
        continue;
      }
      if (e.getAttribute('href').startsWith('#')) continue;
      const url = pageUrl(e.getAttribute('href'), source.url);
      if (!url) continue;
      const page = normalize(url);
      if (e.classList.contains('newpage')) { if (page) missing.add(page.url); continue; }
      if (isPager(url, source.root || source.url)) { pages.add(url); continue; }
      if (isWorkIndex(url) && url !== source.url) { childIndexes.add(url); continue; }
      if (registry.has(url) || url === source.url || !page || (source.language && page.language !== source.language) || origin === 'id' || isExcluded(url)) continue;
      if (source.kind === 'scp' && !/^scp-(?:[a-z]+-)?\d+(?:-[\p{L}\p{N}_-]+)?$/u.test(page.slug)) continue;
      // Support lists, tables, list-pages modules and flat div/br layouts. SCP
      // indexes already restrict by identifier; others require a listed item.
      if (source.kind !== 'scp' && !e.closest('li,td,.list-pages-item,.list-pages-box,.yui-content,.collection,.series-list,.hub-list,.tale-block,.tale-list-box,.tale-title,.tale-list') &&
          !(source.kind === 'international-hub' && e.closest('p')) &&
          !(!structured && (e.closest('p') || e.nextElementSibling?.tagName === 'BR' || e.previousElementSibling?.tagName === 'BR'))) continue;
      const label = clean(e.textContent || e.querySelector('img')?.getAttribute('alt') || (source.kind==='scp' ? page.slug : ''));
      if (!label) continue;
      members.set(page.url, { url: page.url, kind: source.kind, origin: origin || null, title: label, source: source.root || source.url, section });
    }
    for (const e of content.querySelectorAll('iframe[src]')) {
      const u = pageUrl(e.getAttribute('src'), source.url);
      if (u && new URL(u).pathname.startsWith(new URL(source.root || source.url).pathname + '/html/')) embeds.add(u);
    }
    // These are also readable aggregate documents, not just link directories.
    if (['setting','record','canon'].includes(source.kind) && normalize(source.url)) {
      members.set(normalize(source.url).url, { url: normalize(source.url).url, kind: source.kind, origin: sourceOrigin, title: clean(d.querySelector('#page-title')?.textContent), source: source.root || source.url, section: '' });
    }
    return { members: [...members.values()], missing: [...missing], pages: [...pages], embeds: [...embeds], childIndexes: [...childIndexes] };
  } finally { dom.window.close(); }
}
async function requestHtml(url) {
  const allowed = new Set(Object.values(LANGUAGES).map(c => new URL(c.baseUrl).hostname));
  const initial = new URL(url);
  const embed = /^\/([^/]+)\/html\/([^/]+)$/.exec(initial.pathname);
  const embeddedHost = initial.hostname.replace(/\.wikidot\.com$/, '.wdfiles.com');
  let current = url;
  for (let depth = 0; depth <= 5; depth++) {
    const u = new URL(current);
    const embeddedAsset = embed && u.hostname === embeddedHost &&
      u.pathname === `/local--html/${embed[1]}/${embed[2]}/${initial.hostname}/`;
    if ((!allowed.has(u.hostname) && !embeddedAsset) || u.username || u.password || u.port || !/^https?:$/.test(u.protocol)) throw Error('Unsafe index redirect');
    const r = await axios.get(current, { timeout: 25000, maxRedirects: 0, maxContentLength: 8 * 1024 * 1024,
      validateStatus: s => s >= 200 && s < 400, headers: { 'User-Agent': 'SCPReaderCatalog/1.0', Accept: 'text/html' } });
    if (r.status < 300) return r.data;
    current = new URL(r.headers.location, current).href;
  }
  throw Error('Too many index redirects');
}
function readState(file) {
  if (![file,file+'.bak',file+'.tmp'].some(f=>fs.existsSync(f))) return { schemaVersion: VERSION, indexes: {}, records: {}, attempts: {} };
  let error;
  for(const candidate of [file,file+'.bak',file+'.tmp']){
    if(!fs.existsSync(candidate))continue;
    try {
      const state=JSON.parse(zlib.gunzipSync(fs.readFileSync(candidate)));
      if(state.schemaVersion!==VERSION)throw Error('Unknown index state schema');
      if(!state.indexes||!state.records||!state.attempts)throw Error('Incomplete index state');
      return state;
    }catch(e){if(e.message==='Unknown index state schema')throw e;error=e;}
  }
  const failure=Error('Corrupt index state: '+file,{cause:error});failure.code='INDEX_STATE_CORRUPT';throw failure;
}
function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd=fs.openSync(file+'.tmp','w');
  try{fs.writeFileSync(fd,zlib.gzipSync(JSON.stringify(state),{level:9}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  if(fs.existsSync(file)){
    try{const old=JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));if(old.schemaVersion===VERSION){
      fs.copyFileSync(file,file+'.bak.tmp');const backup=fs.openSync(file+'.bak.tmp','r+');
      try{fs.fsyncSync(backup);}finally{fs.closeSync(backup);}fs.renameSync(file+'.bak.tmp',file+'.bak');
    }}catch(e){if(!['Z_DATA_ERROR','Z_BUF_ERROR'].includes(e.code)&&!(e instanceof SyntaxError))throw e;}
  }
  fs.renameSync(file + '.tmp', file);
}
function eligibleRecord(record) {
  return record && record.title && record.contentSha256 &&
    (record.availabilityVersion || clean(record.descriptionExcerpt));
}
async function crawl(language, { root = __dirname, now = new Date().toISOString(), maxRequests = 600,
  maxDurationMs = 300000, intervalMs = 500, request = requestHtml, articleRequest = url => fetchRecord(url, path.join(root,'partial-data/related-documents/research-board')), force = false, sources = sourcesFile.sources } = {}) {
  if (!LANGUAGES[language]) throw Error('Unknown language');
  const started = Date.now(), committed = path.join(root, 'local-data/catalog-indexes', language + '.json.gz');
  if (!Number.isInteger(maxRequests) || maxRequests < 0 || maxRequests > 10000 || !Number.isFinite(maxDurationMs) || maxDurationMs <= 0 || !Number.isFinite(intervalMs) || intervalMs < 0) throw Error('Invalid index crawl limits');
  const partial = path.join(root, 'partial-data/catalog-indexes', language + '.json.gz');
  // Resume interrupted local runs without losing completed pages/requests.
  let state;
  try{state=readState([partial,partial+'.bak',partial+'.tmp'].some(f=>fs.existsSync(f))?partial:committed);}catch(e){
    if(e.code!=='INDEX_STATE_CORRUPT'||!fs.existsSync(partial))throw e;
    fs.renameSync(partial,partial+'.corrupt-'+Date.now());
    console.warn(`[${language}] interrupted state is corrupt; rebuilding from committed state and captures`);
    state=readState(committed);
  }
  // The ordinary crawler already checks these bodies in this same matrix job.
  // Keep their index membership, but do not download every SCP a second time.
  const ordinaryFile=path.join(root,'local-data',language,'scp-data.json');
  const ordinaryUrls=new Set(fs.existsSync(ordinaryFile)?JSON.parse(fs.readFileSync(ordinaryFile)).data
    .filter(r=>r.isTranslatedJP!==false).map(r=>normalize(r.urlJP||r.urlEN)?.url).filter(Boolean):[]);
  const selected = sources.filter(s => s.language === language), registry = new Set(selected.map(s => s.url));
  let fetchedIndexes = 0, fetchedArticles = 0, failures = 0, last = 0;
  async function slot() { const wait = Math.max(0, last + intervalMs - Date.now()); if (wait) await new Promise(r => setTimeout(r, wait)); last = Date.now(); }
  const fresh = at => !force && Date.parse(now) - Date.parse(at || 0) < 7 * 86400000;
  // Transient failures must not be cached for the same week as successes and
  // confirmed missing articles. Avoid hammering persistently failing pages.
  const attemptFresh = attempt => attempt?.status === 'failed'
    ? !force && Date.parse(now) - Date.parse(attempt.at || 0) < 15 * 60000
    : fresh(attempt?.at);
  if (language === 'ru') {
    // Public HTML is blocked; official API lists all pages with publisher tags.
    await slot();
    const response = await axios.get('https://scpfoundation.net/api/articles', { timeout: 30000, maxContentLength: 32 * 1024 * 1024 });
    if (!Array.isArray(response.data) || !response.data.length) throw Error('Invalid RU index API');
    const members = [];
    for (const r of response.data) {
      const tags = r.tags || [], page = normalize('https://scpfoundation.net/' + r.pageId);
      if (!page || /^(?:draft|deleted|fragment|component|theme):/.test(page.slug) || isExcluded(page.url,tags)) continue;
      const allowed = tags.some(t => /^(?:тип:объект|структура:рассказ|структура:свор_формат|тип:канон|тип:формат_фонда)$/.test(t)) || /^scp-(?:[a-z]+-)?\d/.test(page.slug);
      if (!allowed || tags.includes('филиал:id')) continue;
      const origin = tags.filter(t => t.startsWith('филиал:')).map(t => t.slice(7));
      members.push({ url: page.url, title: r.title, kind: 'international-hub', origin: origin.length === 1 ? origin[0] : null, source: 'https://scpfoundation.net/api/articles', section: '' });
    }
    state.indexes['https://scpfoundation.net/api/articles'] = { at: now, members, missing: [], pages: [], embeds: [] };
    fetchedIndexes++;
  } else {
    const excludedRoots=new Set((state.discoveredIndexes||[]).filter(s=>isExcluded(s.url,state.records[s.url]?.tags||[])).map(s=>s.url));
    state.discoveredIndexes=(state.discoveredIndexes||[]).filter(s=>!excludedRoots.has(s.url));
    for(const [url,snapshot]of Object.entries(state.indexes))if(excludedRoots.has(snapshot.root||url))delete state.indexes[url];
    const queue = [...selected.map(s => ({ ...s, root: s.url })), ...(state.discoveredIndexes || [])], seen = new Set();
    for (const s of state.discoveredIndexes || []) registry.add(s.url);
    for (const s of selected) {
      for (const old of Object.entries(state.indexes).filter(([,v]) => v.root === s.url)) queue.push({ ...s, url: old[0], root: s.url, embedded: old[1].embedded });
    }
    while (queue.length && Date.now()-started < maxDurationMs * 0.65) {
      const source = queue.shift();
      if (seen.has(source.url)) continue;
      seen.add(source.url);
      const previous = state.indexes[source.url];
      let parsed;
      if (previous && previous.parserVersion === PARSER_VERSION && fresh(previous.at)) parsed = previous;
      else {
        try {
          await slot();
          parsed = parseIndex(await request(source.url), source, registry, { embedded: !!source.embedded });
          // Large losses indicate a broken selector or a half-loaded index.
          if (previous?.parserVersion === PARSER_VERSION && previous.members.length > 30 && parsed.members.length < previous.members.length / 2) {
            // Explicit newpage evidence is still valid when a layout regresses.
            state.indexes[source.url] = {...previous,missing:[...new Set([...(previous.missing||[]),...parsed.missing])]};
            throw Error('Index membership unexpectedly shrank');
          }
          state.indexes[source.url] = { ...parsed, at: now, root: source.root, embedded: !!source.embedded, parserVersion: PARSER_VERSION };
          if (state.failures) delete state.failures[source.url];
          fetchedIndexes++;
        } catch (e) {
          failures++; parsed = previous;
          state.failures ||= {}; state.failures[source.url] = { at: now, reason: e.message };
        }
      }
      if (parsed) {
        for (const url of parsed.pages || []) queue.push({ ...source, url });
        for (const url of parsed.embeds || []) queue.push({ ...source, url, embedded: true });
        for (const url of parsed.childIndexes || []) {
          const child = {language,url,root:url,kind:'tale',origin:originHint(url),discoveredFrom:source.root || source.url};
          queue.push(child);registry.add(url);state.discoveredIndexes ||= [];
          if(!state.discoveredIndexes.some(s=>s.url===url))state.discoveredIndexes.push(child);
        }
      }
      if (seen.size % 20 === 0) writeState(partial, state);
    }
    state.pendingIndexes = queue;
  }
  // Import previously fetched document metadata, never infer existence from a URL.
  const cached = loadCache(path.join(root, 'local-data/related-document-cache')).records;
  for (const [url, record] of cached) if (normalize(url)?.language === language && !state.records[url] && eligibleRecord(record)) state.records[url] = record;
  const captures=path.join(root,'partial-data/related-documents');
  for(const url of ordinaryUrls){
    const file=path.join(captures,crypto.createHash('sha256').update(url).digest('hex')+'.json');
    if(!fs.existsSync(file))continue;
    const record=JSON.parse(fs.readFileSync(file));
    if(record.url===url && eligibleRecord(record))state.records[url]=record;
  }
  const members = new Map(Object.values(state.indexes).flatMap(i => i.members || []).map(m => [m.url,m]));
  function discoverHub(url,record){
    const member=members.get(url);
    if(!member||isExcluded(url,record.tags)||!(record.tags||[]).some(t=>['hub','ハブ','中心','структура:хаб'].includes(t))||
        !['goi-format','canon','setting','international-hub','tale'].includes(member.kind))return;
    state.discoveredIndexes ||= [];
    if(!registry.has(url)&&!state.discoveredIndexes.some(s=>s.url===url))state.discoveredIndexes.push({language,url,root:url,kind:'tale',origin:member.origin||null,discoveredFrom:member.source});
  }
  for(const [url,record]of Object.entries(state.records))if(eligibleRecord(record))discoverHub(url,record);
  const additionalFile = path.join(root,'local-data/related-documents/catalog.json.gz');
  const unknownOrigins = new Set(fs.existsSync(additionalFile) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(additionalFile))).data
    .filter(r=>r.language===language&&r.pageType==='related-document-unclassified').map(r=>r.url) : []);
  const needsOrigin = url => unknownOrigins.has(url) && (state.records[url]?.originProvenanceVersion||0)<require('./origin-provenance').VERSION;
  const pending = [...members.keys()].filter(url => !ordinaryUrls.has(url) && (!eligibleRecord(state.records[url]) || !fresh(state.records[url]?.checkedAt) ||
    needsOrigin(url)))
    .filter(url => !attemptFresh(state.attempts[url])).sort((a,b) => Number(!!state.records[a])-Number(!!state.records[b]) || Number(needsOrigin(b))-Number(needsOrigin(a)) || a.localeCompare(b));
  for (const url of pending) {
    if (fetchedArticles >= maxRequests || Date.now()-started >= maxDurationMs) break;
    await slot();
    try {
      const record = await articleRequest(url);
      if (!eligibleRecord(record)) throw Error('Not an article page');
      state.records[url] = record; state.attempts[url] = { at: now, status: 'success' };
      discoverHub(url,record);
    } catch (e) {
      const terminal = [404,410].includes(e.response?.status) || e.articleUnavailable===true || /Invalid API article/.test(e.message);
      state.attempts[url] = { at: now, status: terminal ? 'unavailable' : 'failed', reason: e.message };
      if (terminal) delete state.records[url];
      failures++;
    }
    fetchedArticles++;
    if (fetchedArticles % 25 === 0) { writeState(partial,state); console.log(`[${language}] index articles ${fetchedArticles}/${maxRequests}`); }
  }
  state.language = language; state.updatedAt = now;
  state.statistics = { members: members.size, available: [...members.keys()].filter(u => (ordinaryUrls.has(u) || eligibleRecord(state.records[u])) && state.attempts[u]?.status !== 'unavailable').length,
    fetchedIndexes, fetchedArticles, failures, pendingIndexes: state.pendingIndexes?.length || 0,
    pendingDiscoveredIndexes:language === 'ru' ? 0 : (state.discoveredIndexes||[]).filter(s=>!state.indexes[s.url]).length };
  writeState(partial, state); console.log(JSON.stringify({ language, ...state.statistics }));
  return state;
}
if (require.main === module) {
  crawl(process.argv[2], { maxRequests: Number(process.env.INDEX_MAX_REQUESTS || 600), maxDurationMs: Number(process.env.INDEX_MAX_DURATION_MS || 300000),
    intervalMs: Number(process.env.CRAWL_REQUEST_INTERVAL_MS || 500),force:process.env.FORCE_REFRESH_ARTICLE_INDEXES==='1' }).catch(e => { console.error(e); process.exitCode = 1; });
}
module.exports = { parseIndex, crawl, readState, writeState, eligibleRecord, isExcluded, originHint, isPager, requestHtml };
