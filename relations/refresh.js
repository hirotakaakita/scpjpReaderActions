'use strict';
const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');
const robotsParser = require('robots-parser');
const { catalogIndex } = require('./build');
const { normalizePage, makeRecord, HOSTS, EXTRACTOR_VERSION } = require('./core');
const { atomicJson, readRecord, recordPath } = require('./store');
const PRODUCT = 'SCPReaderRelations';
const USER_AGENT = `${PRODUCT}/1.0 (+https://github.com/hirotakaakita/scpjpReaderActions)`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function request(url, headers = {}) {
  return axios.get(url, { timeout: 20000, maxRedirects: 4, maxContentLength: 16 * 1024 * 1024,
    responseType: 'text', transformResponse: [x => x], validateStatus: () => true,
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/json', ...headers },
    beforeRedirect: options => {
      if (!HOSTS.has(options.hostname)) throw new Error('Redirect outside supported branches');
    } });
}

// RuFoundation exposes article source as public JSON. Use that transport only;
// HTML pages and their bot challenge are never fetched or solved by this policy.
async function accessPolicy(host, get = request) {
  if (host === 'scpfoundation.net') return {
    transport: 'public_article_api',
    getCrawlDelay: () => 0.5,
    isAllowed: value => {
      try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === host && !u.port && !u.username && !u.password && !u.search && /^\/api\/articles\/[^/]+$/.test(u.pathname); }
      catch { return false; }
    },
  };
  const response = await get(`https://${host}/robots.txt`);
  if (response.status !== 200 && response.status !== 404) throw new Error('Robots unavailable');
  if (response.status === 200 && /<(?:!doctype|html)\b/i.test(response.data)) throw new Error('Robots returned an HTML error');
  return robotsParser(`https://${host}/robots.txt`, response.status === 404 ? '' : response.data);
}

async function refreshPage(page, dir, get = request, now = () => new Date().toISOString(), {surveyDir} = {}) {
  const old = readRecord(dir, page.url);
  const previous = old?.record;
  const endpoint = page.host === 'scpfoundation.net'
    ? `https://${page.host}/api/articles/${encodeURIComponent(page.slug)}` : page.url;
  let lastAttempt;
  try {
    const headers = {};
    if (previous?.extractorVersion === EXTRACTOR_VERSION && (!surveyDir || require('./survey-source').hasSource(surveyDir,page.url,previous))) {
      if (previous.etag) headers['If-None-Match'] = previous.etag;
      if (previous.lastModified) headers['If-Modified-Since'] = previous.lastModified;
    }
    const r = await get(endpoint, headers);
    const at = now();
    const final = r.request?.res?.responseUrl;
    if (final && page.host !== 'scpfoundation.net' && normalizePage(final)?.id !== page.id) {
      lastAttempt = { at, status: 'redirected', httpStatus: r.status, target: normalizePage(final)?.url || null };
    } else if (r.status === 304 && previous) {
      const record = { ...previous, checkedAt: at };
      atomicJson(recordPath(dir, page.url), { url: page.url, record,
        lastAttempt: { at, status: 'not_modified' } });
      return 'not_modified';
    } else if (r.status === 200) {
      const record = makeRecord(page.url, r.data,
        page.host === 'scpfoundation.net' ? 'ftml' : 'html', at,
        { etag: r.headers?.etag, lastModified: r.headers?.['last-modified'] });
      atomicJson(recordPath(dir, page.url), { url: page.url, record,
        lastAttempt: { at, status: 'success' } });
      if(surveyDir)require('./survey-source').saveSource(surveyDir,page.url,r.data,record.format,record);
      return 'success';
    } else {
      lastAttempt = { at, status: r.status === 429 ? 'rate_limited' : [404, 410].includes(r.status) ? 'not_found' : 'http_error', httpStatus: r.status, ...(r.status===429?{retryAfterMs:Math.min(86400000,Math.max(0,Number(r.headers?.['retry-after'])*1000 || Date.parse(r.headers?.['retry-after'])-Date.now() || 30000))}:{}) };
    }
  } catch (e) {
    // No response bodies, tokens or free-form error messages in the public graph.
    lastAttempt = { at: now(), status: e.code === 'ECONNABORTED' ? 'timeout' : 'fetch_or_parse_error' };
  }
  atomicJson(recordPath(dir, page.url), { url: page.url, record: previous || null, lastAttempt });
  if(surveyDir)require('./survey-source').sourceFailure(surveyDir,page.url,lastAttempt.status);
  return lastAttempt.status;
}

function selectPages(pages, dir, { maxPages = 0, ageDays = 7, seeds = [], language, surveyDir } = {}) {
  const queues = new Map();
  const selected = new Map();
  const threshold = Date.now() - ageDays * 86400000;
  for (const value of seeds) {
    const p = normalizePage(value);
    if (p && (!language || p.branch === language)) selected.set(p.id, p);
  }
  const candidates = [...pages.values()].filter(p => !language || p.branch === language)
    .map(p => ({ page: p, state: readRecord(dir, p.url) }))
    .filter(({page,state}) => (surveyDir && !require('./survey-source').hasSource(surveyDir,page.url,state?.record)) || !state?.record || state.record.extractorVersion !== EXTRACTOR_VERSION ||
      !['success', 'not_modified'].includes(state.lastAttempt?.status) ||
      new Date(state.record.checkedAt).getTime() < threshold)
    .sort((a, b) => (a.state?.lastAttempt?.at || '').localeCompare(b.state?.lastAttempt?.at || '') || a.page.id.localeCompare(b.page.id));
  for (const { page } of candidates) {
    if (!queues.has(page.host)) queues.set(page.host, []);
    queues.get(page.host).push(page);
  }
  // Round-robin branches instead of spending the first run entirely on English.
  while ([...queues.values()].some(q => q.length) && (!maxPages || selected.size < maxPages)) {
    for (const queue of queues.values()) {
      if (queue.length && (!maxPages || selected.size < maxPages)) {
        const page = queue.shift(); selected.set(page.id, page);
      }
    }
  }
  return [...selected.values()].slice(0, maxPages || undefined);
}

async function refresh(options = {}) {
  const root = path.join(__dirname, '..');
  const dir = options.recordDir || path.join(__dirname, '.cache', 'records');
  const pages=options.pagesOverride || catalogIndex(options.catalogDir || path.join(root,'local-data')).pages;
  const reviewedSources = options.skipReviewedSeeds?[]:[...require('./reviewed-relations.json').map(r=>r.source), ...require('./semantic-sources.json')];
  const selected = selectPages(pages, dir, {...options,seeds:[...(options.seeds || []),...reviewedSources]});
  const queues = new Map();
  for (const p of selected) {
    if (!queues.has(p.host)) queues.set(p.host, []);
    queues.get(p.host).push(p);
  }
  const results = {};
  let done = 0;
  let stopping = false;
  const deadline = Date.now() + (options.maxSeconds || 18000) * 1000;
  const stop = () => { stopping = true; };
  process.once('SIGINT', stop);
  const hosts = [...queues.entries()];
  let cursor = 0;
  async function worker() {
    while (cursor < hosts.length && !stopping && Date.now() < deadline) {
      const [host, queue] = hosts[cursor++];
      let robots;
      try {
        robots = await accessPolicy(host);
      } catch {
        results.robots_unavailable = (results.robots_unavailable || 0) + queue.length;
        console.log(JSON.stringify({ host, status: 'robots_unavailable', skipped: queue.length }));
        continue;
      }
      if(host==='scpfoundation.net'){
        const {apiQueue}=require('./api-queue');
        const pool=await apiQueue(queue,{concurrency:3,intervalMs:Math.max(500,(robots.getCrawlDelay(PRODUCT)||0)*1000),shouldStop:()=>stopping||Date.now()>=deadline,
          fetchPage:async page=>{const status=await refreshPage(page,dir,request,undefined,{surveyDir:options.surveyDir});return{status,retryAfterMs:readRecord(dir,page.url)?.lastAttempt?.retryAfterMs};},
          onResult:async(page,r)=>{results[r.status]=(results[r.status]||0)+1;done++;if(done%10===0)console.log(JSON.stringify({host,done,selected:selected.length,results,concurrency:3}));}
        });
        if(pool.halted)console.log(JSON.stringify({host,status:'circuit_open'}));
        continue;
      }
      const delay = Math.max(options.delayMs ?? 1000, (robots.getCrawlDelay(PRODUCT) || 0) * 1000);
      let consecutiveFailures = 0;
      for (const page of queue) {
        if (stopping || Date.now() >= deadline) break;
        const apiUrl = host === 'scpfoundation.net' ? `https://${host}/api/articles/${encodeURIComponent(page.slug)}` : page.url;
        if (robots.isAllowed(apiUrl, PRODUCT) === false) {
          results.robots_denied = (results.robots_denied || 0) + 1; continue;
        }
        const status = await refreshPage(page,dir,request,undefined,{surveyDir:options.surveyDir});
        results[status] = (results[status] || 0) + 1;
        done++;
        consecutiveFailures = ['http_error', 'timeout', 'fetch_or_parse_error'].includes(status) ? consecutiveFailures + 1 : 0;
        if (done % 10 === 0) console.log(JSON.stringify({ done, selected: selected.length, results }));
        if (consecutiveFailures >= 3) {
          console.log(JSON.stringify({ host, status: 'circuit_open', remaining: queue.length - queue.indexOf(page) - 1 }));
          break;
        }
        await sleep(Math.min(delay, Math.max(0, deadline - Date.now())));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency || 4, hosts.length) }, worker));
  process.removeListener('SIGINT', stop);
  const summary = { selected: selected.length, attempted: done, results,
    stopped: stopping || Date.now() >= deadline, at: new Date().toISOString() };
  atomicJson(path.join(dir, '..', 'refresh-summary.json'), summary);
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const value = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  const seedsFile = value('--seeds');
  const maxPages = Number(value('--max-pages') || 0);
  const ageDays = Number(value('--age-days') || 7);
  const maxSeconds = Number(value('--max-seconds') || 18000);
  if (!Number.isInteger(maxPages) || maxPages < 0 || !Number.isFinite(ageDays) || ageDays < 0 ||
      !Number.isFinite(maxSeconds) || maxSeconds <= 0 ||
      (value('--language') && ![...HOSTS.values()].includes(value('--language')))) throw new Error('Invalid refresh options');
  refresh({ maxPages, ageDays, maxSeconds,
    language: value('--language'), seeds: seedsFile ? JSON.parse(fs.readFileSync(seedsFile, 'utf8')) : [] })
    .catch(e => { console.error(e.message); process.exitCode = 1; });
}
module.exports = { refreshPage, selectPages, refresh, accessPolicy, request };
