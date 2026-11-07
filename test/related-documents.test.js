'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { normalize, extractHtml, extractApi, classify, buildCatalogs, run } = require('../related-documents');
const seed = 'https://scp-wiki.wikidot.com/scp-682';
const log = 'https://scp-wiki.wikidot.com/experiment-log-t-98816-oc108-682';
const date = '2026-11-05T00:00:00.000Z';
const row = { itemId: 'scp-series-682', language: 'en', urlEN: seed, pageType: 'scp-series', isTranslatedJP: false };
const html = body => `<div id="page-title">Document title</div><div id="page-content">${body}</div><div class="page-tags"><a>en</a></div>`;

test('only publisher pages are candidates; aliases and tracking URLs normalize', () => {
  assert.equal(normalize('http://www.scpwiki.com/scp-682#x').url, seed);
  for (const url of ['https://example.com/a', 'file:///a', 'https://scp-wiki.wikidot.com/system:page',
    'https://scp-wiki.wikidot.com/foo?action=delete', 'https://a:b@scp-wiki.wikidot.com/foo']) assert.equal(normalize(url), null);
  assert.equal(normalize('/log?utm_source=a', seed).url, 'https://scp-wiki.wikidot.com/log');
});

test('article fetch accepts publisher pagination without widening discovery',()=>{
  const {articleFetchTarget}=require('../related-documents');
  for(const url of ['https://scp-jp.wikidot.com/story/offset/1/page13_limit/1/noredirect/true',
    'http://www.lafundacionscp.wikidot.com/eventos-extranormales-es/p/999#24']){
    assert(articleFetchTarget(url));assert.equal(normalize(url),null);
  }
  for(const url of ['https://example.com/story/p/1','https://scp-jp.wikidot.com/system:page-create/p/1',
    'https://scp-jp.wikidot.com/story/p/1?action=edit','https://user:pass@scp-jp.wikidot.com/story/p/1'])assert.equal(articleFetchTarget(url),null);
});

test('extracts body links, author and explicit origin links without navigation or new pages', () => {
  const r = extractHtml(seed, html(`<a href="${log}">log</a><a href="#x">anchor</a><a class="newpage" href="/missing">missing</a>
    <nav role="navigation"><a href="/nav">nav</a></nav><div class="licensebox"><a href="https://www.wikidot.com/user:info/author">Author</a></div>
    <span class="translation-source"><a href="https://scp-jp.wikidot.com/scp-682-jp">Original</a></span>`), date);
  assert(r.links.includes(log));
  assert(!r.links.some(url => /\/(?:missing|nav|scp-682)$/.test(url)));
  assert.equal(r.authors[0].name, 'Author');
  assert.deepEqual(r.translations, ['https://scp-jp.wikidot.com/scp-682-jp']);
  assert.throws(() => extractHtml(seed, '<h1>no content</h1>'));
  assert.throws(() => extractHtml(seed, html('<div class="error-block">not found</div>')));
});

test('API captures linked documents without inventing translations', () => {
  const r = extractApi('https://scpfoundation.net/scp-1001-ru', {
    title: 'SCP-1001-RU', source: '[[[document-1001-ru-1|Document]]] [[[https://example.com/a|no]]]', tags: ['филиал:ru'],
  }, date);
  assert.deepEqual(r.links, ['https://scpfoundation.net/document-1001-ru-1']);
  assert.deepEqual(r.translations, []);
});

test('an embedded module error does not hide an otherwise readable article',()=>{
  const r=extractHtml(seed,html('<p>Actual narrative text.</p><div class="error-block">ListPages error: no such category</div>'),date);
  assert.equal(r.descriptionExcerpt,'Actual narrative text.');
  assert.throws(()=>extractHtml(seed,html('<div class="error-block">Temporary module error</div>')));
});

test('origin follows explicit evidence, not hosting site or a single referenced SCP', () => {
  const records = new Map([[log, { tags: [], translations: [], links: [seed] }]]);
  const catalog = new Map([[seed, [row]]]);
  assert.equal(classify(log, records, catalog).branch, null);
  records.get(log).tags = ['jp'];
  assert.equal(classify(log, records, catalog).branch, 'jp');
  records.get(log).tags = ['jp', 'en'];
  assert.equal(classify(log, records, catalog).branch, null);
  records.get(log).tags = []; records.get(log).translations = [seed];
  assert.equal(classify(log, records, catalog).branch, 'en');
  records.get(log).translations = [log];
  assert.equal(classify(log, records, catalog).branch, null);
});

test('catalog separates fetched records and pending URLs, never expands document links recursively', () => {
  const next = 'https://scp-wiki.wikidot.com/unrelated-document';
  const records = new Map([[seed, extractHtml(seed, html(`<a href="${log}">log</a>`), date)],
    [log, extractHtml(log, html(`<a href="${next}">next</a>`), date)]]);
  const result = buildCatalogs([row], records, new Map(), date);
  assert.equal(result.totalCount, 1);
  assert.equal(result.data[0].originBranch, 'en');
  assert.equal(result.data[0].contentType, 'log');
  assert.deepEqual(result.data[0].sourceArticleIds, [row.itemId]);
  const id = result.data[0].itemId;
  assert.equal(buildCatalogs([row], records, new Map(), date).data[0].itemId, id);
  records.delete(log);
  const pending = buildCatalogs([row], records, new Map(), date);
  assert.equal(pending.totalCount, 0); assert.equal(pending.pending.length, 1);
});

test('bounded runs resume from cache, retain success on failure and suppress deleted pages', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-related-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'local-data/en'), { recursive: true });
  const file = path.join(root, 'local-data/en/scp-data.json');
  const original = JSON.stringify({ data: [row] }); fs.writeFileSync(file, original);
  const options = { root, maxRequests: 1, intervalMs: 0, now: date,
    request: async url => extractHtml(url, html(url === seed ? `<a href="${log}">log</a>` : 'Log body'), date) };
  let r = await run(options);
  assert.equal(r.pending.length, 1);
  r = await run(options);
  assert.equal(r.totalCount, 1);
  let calls = 0;
  await run({ ...options, request: async () => { calls++; throw Error('must not request fresh cache'); } });
  assert.equal(calls, 0);
  const next = { ...options, maxRequests: 2, now: '2026-11-13T00:00:00.000Z', request: async () => { throw Error('offline'); } };
  r = await run(next); assert.equal(r.data[0].fetchStatus, 'stale');
  r = await run({ ...next, now: '2026-11-21T00:00:00.000Z', request: async () => { const e = Error('gone'); e.response = { status: 404 }; throw e; } });
  assert.equal(r.totalCount, 0); assert.equal(r.pending[0].status, 'not_found');
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.equal(fs.existsSync(path.join(root, 'local-data/mobile-v1/research-board')), false);
  const output = path.join(root, 'local-data/related-documents');
  assert.deepEqual(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(output, 'catalog.json.gz')))), r);
});
