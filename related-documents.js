'use strict';
// Catalog enrichment only: no graph, layout, or changes to existing work IDs.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const axios = require('axios');
const { JSDOM, VirtualConsole } = require('jsdom');
const { LANGUAGES } = require('./languages');
const { inspectArticlePage } = require('./article-page');
const { validOrigin, publisherOriginTags, publisherDefaultOrigin } = require('./catalog-origin');
const provenance = require('./origin-provenance');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const hosts = new Map(Object.entries(LANGUAGES).map(([language, config]) => [new URL(config.baseUrl).hostname, language]));
hosts.set('scpfoundation.net', 'ru');
const aliases = new Map(['scp-wiki.net', 'www.scp-wiki.net', 'scpwiki.com', 'www.scpwiki.com'].map(h => [h, 'scp-wiki.wikidot.com']));
aliases.set('www.scpfoundation.net', 'scpfoundation.net');
const excluded = 'script,style,iframe,noscript,.page-tags,.page-rate-widget-box,.creditRate,.licensebox,.license-box,.credit,.credit-box,#u-credit-view,.footer-wikiwalk-nav,.page-navigation,.interwiki-box,[role="navigation"],#toc,.toc';

function normalize(value, base) {
  try {
    const u = new URL(value, base), host = aliases.get(u.hostname) || u.hostname;
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port || !hosts.has(host)) return null;
    if (u.search && [...u.searchParams.keys()].some(k => !['utm_source', 'utm_medium', 'utm_campaign'].includes(k))) return null;
    const slug = decodeURIComponent(u.pathname).replace(/^\/+|\/+$/g, '').toLowerCase();
    if (!/^[\p{L}\p{N}][\p{L}\p{N}_:-]*$/u.test(slug) || /^(?:system|admin|forum|user|component|theme|nav|fragment|css|template|category):/.test(slug)) return null;
    const language = host === 'scp-nd.wikidot.com'
      ? Object.keys(LANGUAGES).find(code => LANGUAGES[code].namespace && slug.startsWith(LANGUAGES[code].namespace))
      : hosts.get(host);
    if (!language) return null;
    const namespace = LANGUAGES[language].namespace || '';
    return { url: `https://${host}/${encodeURI(slug)}`, language, slug: namespace ? slug.slice(namespace.length) : slug };
  } catch { return null; }
}

// A published article may redirect to one of its paginated views. Accept that
// view for fetching only; it is not a new catalog entry or a discovery source.
function articleFetchTarget(value) {
  try {
    const u = new URL(value);
    if (u.username || u.password || u.port || !['http:', 'https:'].includes(u.protocol)) return null;
    if (u.hostname.startsWith('www.') && hosts.has(u.hostname.slice(4))) u.hostname = u.hostname.slice(4);
    if (normalize(u.href)) return u.href;
    if (u.search || !/^\/[^/]+(?:(?:\/(?:p|offset|page\d+_limit)\/\d+)+(?:\/noredirect\/true)?|\/noredirect\/true)$/.test(u.pathname)) return null;
    return normalize(u.origin + '/' + u.pathname.split('/')[1]) ? u.href : null;
  } catch { return null; }
}

function extractHtml(url, html, now = new Date().toISOString(), existingDocument = null, {redirectTarget=null} = {}) {
  const page = normalize(url);
  if (!page) throw Error('Unsupported document URL');
  const dom = existingDocument ? null : new JSDOM(String(html).replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ''), { url: page.url, virtualConsole: new VirtualConsole() });
  try {
    const d = existingDocument || dom.window.document, root = d.querySelector('#page-content')?.cloneNode(true);
    const title = require('./article-titles').extractArticleTitle(d,url);
    const availability = inspectArticlePage(d);
    if (!availability.usable) {
      const error=Error('Unavailable article: '+availability.reason);error.articleUnavailable=availability.terminal;error.articleTitle=title;throw error;
    }
    const block=d.querySelector('#page-content .error-block,.page-not-found');
    const redirectNotice=!!redirectTarget&&/redirect|리다이렉트|リダイレクト|重定向|перенаправ/iu.test(block?.textContent||'');
    const substantive = root?.cloneNode(true);
    if (substantive) for (const n of substantive.querySelectorAll(excluded + ',.error-block')) n.remove();
    const errorOnly = block && !substantive?.textContent.trim() && !substantive?.querySelector('img,svg,canvas,video,audio,iframe');
    if(!root||!title||(errorOnly&&!redirectNotice)){const error=Error('Unrecognized article structure');
      error.articleUnavailable=!!block&&/not found|does not exist|no existe|存在しません/i.test(block.textContent);throw error;}
    const tags = [...d.querySelectorAll('.page-tags a')].map(a => a.textContent.trim()).filter(Boolean);
    const translations = [...d.querySelectorAll('a[rel~="alternate"][hreflang],link[rel~="alternate"][hreflang],.translation-source a[href],a[data-translation-source]')]
      .map(a => normalize(a.getAttribute('href'), page.url)?.url).filter(Boolean);
    const authors = [...d.querySelectorAll('.licensebox a,.credit a,#u-credit-view a')]
      .filter(a => /wikidot\.com\/user:info\//i.test(a.href)).map(a => ({ name: a.textContent.trim(), url: a.href }));
    const boardExtractor = require('./research-board/extract');
    boardExtractor.removeAuxiliaryContent(root);
    for (const n of root.querySelectorAll(excluded + ',' + boardExtractor.EXCLUDED)) n.remove();
    const bodyLinks = boardExtractor.bodyLinks(root, {...boardExtractor.normalizePage(page.url),title});
    const links = bodyLinks.map(l => l.target);
    // Lazy import: the ordinary crawler also calls this extractor with its DOM.
    const metadata = require('./local-crawler');
    const description = metadata.extractDescriptionAndTagsFromDocument(root).descriptionExcerpt || '';
    return { ...page, title, tags, translations: [...new Set(translations)].sort(), authors,
      ...(redirectTarget?{redirectTarget}:{}),...(!description&&redirectNotice?{descriptionStatus:'redirect_only'}:{}),
      originProvenanceVersion:provenance.VERSION, originalSources:provenance.extractOriginalSources(d,page.url),
      attributionDiscussionUrl:provenance.discussionPage(d,page.url),
      ...provenance.extractAuthorCredits(d),
      objectClass: metadata.extractObjectClassFromDocument(d), rating: metadata.extractRatingFromDocument(d),
      imageUrl: metadata.extractImageUrlFromDocument(d,page.url),
      links, bodyLinks, linkExtractionVersion: boardExtractor.EXTRACTOR_VERSION,identityMetadataVersion:1,
      descriptionExcerpt: Array.from(description).slice(0, 500).join(''),descriptionVersion:require('./article-excerpts').VERSION,
      contentSha256: hash(String(html)), checkedAt: now, format: 'html', availabilityVersion: 1 };
  } finally { dom?.window.close(); }
}

function extractApi(url, article, now = new Date().toISOString()) {
  const page = normalize(url);
  if (!page || !article?.title || typeof article.source !== 'string' || !article.source.trim()) throw Error('Invalid API article');
  const source = article.source, boardExtractor=require('./research-board/extract');
  const bodyLinks=boardExtractor.ftmlLinks(source,{...boardExtractor.normalizePage(page.url),title:article.title});
  const metadata = require('./rufoundation-crawler');
  return { ...page, title: article.title, tags: (article.tags || []).map(t => typeof t === 'string' ? t : t.name).filter(Boolean),
    objectClass: metadata.extractObjectClass(source),rating:metadata.normalizeRating(article.rating),imageUrl:metadata.extractImageUrl(source,page.slug),
    links: bodyLinks.map(l=>l.target), bodyLinks, linkExtractionVersion:boardExtractor.FTML_LINK_VERSION,
    translations: [], originalSources:[], originProvenanceVersion:provenance.VERSION, authors: [], format: 'ftml', contentSha256: hash(source), checkedAt: now, availabilityVersion: 1,
    descriptionExcerpt: metadata.extractDescription(source) || '',descriptionVersion:require('./article-excerpts').VERSION };
}

function capture(url, body, format = 'html', directory = path.join(__dirname, 'partial-data/related-documents'), existingDocument = null) {
  // Enrichment must not break a successful ordinary catalog crawl.
  try {
    const record = format === 'html' ? extractHtml(url, body, undefined, existingDocument) : extractApi(url, body);
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `${hash(record.url)}.json`);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(record)); fs.renameSync(`${file}.tmp`, file);
    require('./research-board/source-store').capture(url, format === 'html' ? body : JSON.stringify(body), format === 'html' ? 'html' : 'ftml', path.join(directory,'research-board'), existingDocument);
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
        translations: (r.translations || []).map(v => normalize(typeof v === 'string' ? v : v.target)?.url).filter(Boolean),
        originalSources:r.originalSources||[],originProvenanceVersion:r.originProvenanceVersion||0 };
      if (!records.has(page.url) || record.checkedAt > records.get(page.url).checkedAt) records.set(page.url, record);
    }
  }
}

function branchOfType(type) {
  if (['scp-series', 'joke-scps', 'scp-ex'].includes(type)) return 'en';
  return /^(?:scp-series-|joke-scps-)([a-z-]+)$/.exec(type || '')?.[1] || /^scp-([a-z-]+)-ex$/.exec(type || '')?.[1] || null;
}
function incubatorSource(url, record, catalogByUrl) {
  const page = normalize(url);
  const match = /^unofficial:[a-z]{2,3}:([a-z0-9][a-z0-9-]*)$/.exec(page?.slug || '');
  if (page?.language !== 'int' || !match || !(record?.tags || []).includes('language-incubator')) return null;
  // ULI's posting rules preserve the original unix-name after the delivery
  // language prefix. The language tag itself describes the translation, not
  // its origin: https://scp-int.wikidot.com/unofficial:language-incubator-hub
  // Require an existing native catalog entry for that exact unix-name. ULI's
  // rule covers tales, proposals and documents as well as numbered SCPs.
  const evidence = [];
  for (const [site, config] of Object.entries(LANGUAGES)) {
    const source = normalize(match[1], config.baseUrl);
    for (const entry of catalogByUrl.get(source?.url) || []) {
      const branch = branchOfType(entry.pageType) || validOrigin(/^related-document-([a-z]+)$/.exec(entry.pageType || '')?.[1]);
      if (branch && (branch === (site === 'zh-tr' ? 'zh' : site) || (site === 'cs' && branch === 'sk'))) {
        evidence.push({ url: source.url, itemId: entry.itemId, pageType: entry.pageType, branch });
      }
    }
  }
  const branches = [...new Set(evidence.map(e => e.branch))];
  if (!branches.length) return null;
  return { branch: branches.length === 1 ? branches[0] : null,
    basis: branches.length === 1 ? 'incubator_source_catalog' : 'conflicting_incubator_source_catalog', evidence };
}
function classify(url, records, catalogByUrl, visited = new Set()) {
  if (visited.size >= 20) return { branch: null, basis: 'translation_depth_limit', evidence: [] };
  if (visited.has(url)) return { branch: null, basis: 'translation_cycle', evidence: [] };
  const next = new Set([...visited, url]);
  const entries = catalogByUrl.get(url) || [];
  const branches = [...new Set(entries.map(e => branchOfType(e.pageType)).filter(Boolean))];
  if (branches.length === 1) return { branch: branches[0], basis: 'catalog_page_type', evidence: entries.map(e => ({ itemId: e.itemId, pageType: e.pageType })) };
  if (branches.length > 1) return { branch: null, basis: 'conflicting_catalog_types', evidence: branches };
  const r = records.get(url), known = new Set(['en', 'zh', 'nd', ...Object.keys(LANGUAGES), ...Object.keys(require('./additional-origins.json'))]);
  const { origins: tags, unsupported, conflicts } = publisherOriginTags(url, r);
  if (conflicts.length) return {branch:null,basis:'conflicting_origin_tags',evidence:conflicts};
  if (unsupported.length) return {branch:null,basis:'unsupported_origin_tag',evidence:unsupported};
  if (tags.length) return { branch: tags.length === 1 ? tags[0] : null, basis: tags.length === 1 ? 'publisher_origin_tag' : 'conflicting_origin_tags', evidence: tags };
  const originalOrigins=[];
  for(const source of r?.originalSources||[]){
    const target=provenance.originalPage(source.url);
    if(!target||source.method!=='credit_original_label')continue;
    const known=records.has(target.url)||catalogByUrl.has(target.url);
    const result=known?classify(target.url,records,catalogByUrl,next):null;
    const originalDefault=result?.basis==='insufficient_origin_evidence'&&target.hostBranch==='en'?
      publisherDefaultOrigin(target.url,records.get(target.url),{originalSource:true}):null;
    const secondary=(r.tags||[]).some(t=>['二次翻译','二次翻譯','重訳','translation'].includes(t));
    const branch=result?.branch||originalDefault?.branch||(!known&&!secondary&&target.hostBranch!=='int'?target.hostBranch:null);
    if(branch)originalOrigins.push({branch,url:target.url,quote:source.quote});
  }
  const originalBranches=[...new Set(originalOrigins.map(s=>s.branch))];
  if(originalBranches.length)return {branch:originalBranches.length===1?originalBranches[0]:null,basis:originalBranches.length===1?'explicit_original_credit':'conflicting_original_credits',evidence:originalOrigins};
  if(r?.originalSources?.length)return {branch:null,basis:'unresolved_original_credit',evidence:r.originalSources};
  const interwiki=r?.interwikiOrigin;
  if(interwiki?.schemaVersion===1&&interwiki.queryUrl===url&&interwiki.contentSha256===r.contentSha256&&interwiki.status==='unsupported_source')
    return {branch:null,basis:'unsupported_interwiki_source',evidence:[interwiki]};
  if(interwiki?.schemaVersion===1&&interwiki.queryUrl===url&&interwiki.contentSha256===r.contentSha256&&interwiki.status==='translation'&&interwiki.chain?.length){
    const chain=interwiki.chain.map(u=>provenance.originalPage(u));
    if(!interwiki.terminal||chain.some(p=>!p)||new Set([url,...chain.map(p=>p?.url)]).size!==chain.length+1)
      return {branch:null,basis:'unresolved_interwiki_origin',evidence:[interwiki]};
    const target=chain.at(-1),known=records.has(target.url)||catalogByUrl.has(target.url);
    const resolved=known?classify(target.url,records,catalogByUrl,new Set([...next,...chain.slice(0,-1).map(p=>p.url)])):null;
    const originalDefault=resolved?.basis==='insufficient_origin_evidence'&&target.hostBranch==='en'?
      publisherDefaultOrigin(target.url,records.get(target.url),{originalSource:true}):null;
    const branch=resolved?.branch||originalDefault?.branch||(!known&&target.hostBranch!=='int'?target.hostBranch:null);
    return {branch,basis:branch?'interwiki_original_metadata':'unresolved_interwiki_origin',evidence:[interwiki]};
  }
  const translated = (r?.translations || []).map(target => ({ target, ...classify(target, records, catalogByUrl, next) })).filter(v => v.branch);
  const origins = [...new Set(translated.map(v => v.branch))];
  if (origins.length) return { branch: origins.length === 1 ? origins[0] : null, basis: origins.length === 1 ? 'explicit_translation_metadata' : 'conflicting_translation_metadata', evidence: translated };
  const incubator = incubatorSource(url, r, catalogByUrl);
  if (incubator) return incubator;
  const slug = normalize(url).slug, m = /^scp-(?:([a-z][a-z-]*)-)?(\d+)(?:-(.*))?$/.exec(slug);
  if (m) {
    const tokens = (m[3] || '').split('-'), branch = m[1] || tokens.find(t => known.has(t)) || 'en';
    if (known.has(branch)) return { branch, basis: 'scp_identifier', evidence: [slug] };
  }
  return publisherDefaultOrigin(url,r) || { branch: null, basis: r ? 'insufficient_origin_evidence' : 'not_fetched', evidence: [] };
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

async function fetchRecord(url, captureDirectory = null, {rawDirectory=null,metadataDirectory=null,timeoutMs=20000,beforeRequest=async()=>{},expandDescriptions=true} = {}) {
  const page = normalize(url);
  if (!page) throw Error('Unsupported URL');
  let redirectTarget=null;
  function saveRaw(body,format){if(!rawDirectory)return;fs.mkdirSync(rawDirectory,{recursive:true});
    fs.writeFileSync(path.join(rawDirectory,hash(page.url)+'.'+format+'.gz'),zlib.gzipSync(typeof body==='string'?body:JSON.stringify(body)));}
  function saveMetadata(record,body,format){if(!metadataDirectory)return;
    fs.mkdirSync(metadataDirectory,{recursive:true});const file=path.join(metadataDirectory,hash(record.url)+'.json');
    fs.writeFileSync(file+'.tmp',JSON.stringify(record));fs.renameSync(file+'.tmp',file);
    require('./research-board/source-store').capture(record.url,typeof body==='string'?body:JSON.stringify(body),format,path.join(metadataDirectory,'research-board'));
  }
  // Validate every redirect so an allowlisted link cannot redirect requests to arbitrary hosts.
  const request = async (target, depth = 0) => {
    target = articleFetchTarget(target);
    if (!target || depth > 5) throw Error('Unsupported redirect');
    await beforeRequest(target);
    const response = await axios.get(target, { timeout: timeoutMs, maxRedirects: 0, maxContentLength: 12 * 1024 * 1024,
      validateStatus: s => (s >= 200 && s < 400), headers: { 'User-Agent': 'SCPReaderCatalog/1.0', Accept: 'text/html,application/json' } });
    if (response.status >= 300) {
      const destination=new URL(response.headers.location,target).href,normalized=normalize(destination);
      const listing=normalized&&normalized.slug!==page.slug&&/^(?:joke-scps|scp-series(?:-[a-z\d-]+)?|foundation-tales|scp-ex|archived-scps|main|start)$/.test(normalized.slug);
      if((!articleFetchTarget(destination)||listing)&&!target.endsWith('/noredirect/true')){
        redirectTarget=destination;
        return request(page.url+'/noredirect/true',depth+1);
      }
      return request(destination,depth+1);
    }
    return response.data;
  };
  if (page.language === 'ru') {
    // This endpoint is deliberately constructed here, never accepted as a discovered URL.
    await beforeRequest(page.url);
    const response = await axios.get(`https://scpfoundation.net/api/articles/${encodeURIComponent(page.slug)}`, {
      timeout: timeoutMs, maxRedirects: 0, maxContentLength: 12 * 1024 * 1024, headers: { Accept: 'application/json' },
    });
    const record = extractApi(url, response.data);
    if(expandDescriptions&&(!record.descriptionExcerpt||record.descriptionExcerpt.length<20))record.descriptionExcerpt=await require('./rufoundation-crawler').extractApiDescription(response.data,async target=>{await beforeRequest(target);return (await axios.get(target,{timeout:timeoutMs,maxRedirects:0,headers:{Accept:'application/json'}})).data;})||'';
    saveRaw(response.data,'json');
    saveMetadata(record,response.data,'ftml');
    if (captureDirectory) require('./research-board/source-store').capture(url, JSON.stringify(response.data), 'ftml', captureDirectory);
    return record;
  }
  const configuredScheme = new URL(LANGUAGES[page.language].baseUrl).protocol;
  let html;
  try{html=await request(url.replace(/^http:/,'https:'));}
  catch(error){
    const transient=[500,502,503,504].includes(error.response?.status)||['ECONNRESET','ETIMEDOUT','ECONNABORTED','EAI_AGAIN'].includes(error.code);
    if(!transient||!new URL(page.url).hostname.endsWith('.wikidot.com'))throw error;
    // Fetch the same owned page through Wikidot's no-redirect view. This can
    // remain available while its normal rendering endpoint is failing.
    html=await request(page.url+'/noredirect/true');
  }
  const record = extractHtml(url, html,undefined,null,{redirectTarget});
  if(expandDescriptions&&!record.descriptionExcerpt)record.descriptionExcerpt=await require('./article-frames').extractOwnedFrameProse(url,html,async target=>{await beforeRequest(target);return (await axios.get(target,{timeout:timeoutMs,maxRedirects:0,maxContentLength:12*1024*1024})).data;})||'';
  saveRaw(html,'html');
  saveMetadata(record,html,'html');
  if (captureDirectory) require('./research-board/source-store').capture(url, html, 'html', captureDirectory);
  return record;
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
module.exports = { normalize, articleFetchTarget, extractHtml, extractApi, capture, classify, buildCatalogs, run, fetchRecord, readCatalogs, loadCache, saveCache };
