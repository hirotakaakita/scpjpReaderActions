const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const axios = require('axios');
const { buildEntries, LocalSCPCrawler } = require('../local-crawler');
const { deduplicateArticles, validateCatalogs } = require('../catalog-identity');
const { mergeLanguage } = require('../merge-data');
const { repair } = require('../repair-catalog-identities');
const { LANGUAGES } = require('../languages');

const candidate = href => ({ href, scpNumber: href.match(/\d+/)[0], title: href, isUnwritten: false });
const row = (id, url, extra = {}) => ({ itemId: id, urlJP: url, tags: [], ...extra });
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-identity-'));
  t.after(() => {
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('scp-identity-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return root;
}

test('international IDs remain stable across separate pages, order and missing canonical entries', () => {
  const config = { pageType: 'scp-series' };
  const normal = candidate('/scp-1380');
  const variant = candidate('/scp-1380-ru');
  const ids = items => buildEntries(items, config).map(item => item.itemId).sort();
  assert.deepEqual(ids([normal]), ['scp-series-1380']);
  assert.deepEqual(ids([variant]), ['scp-series-1380-ru']);
  assert.deepEqual(ids([normal, variant]), ids([variant, normal]));
  assert.deepEqual(ids([normal, variant]), ['scp-series-1380', 'scp-series-1380-ru']);
  assert.deepEqual(ids([normal, normal]), ['scp-series-1380']);
});

test('ordinary branch, joke and explained IDs are preserved', () => {
  for (const [type, href, expected] of [
    ['scp-series-jp', '/scp-001-jp', 'scp-series-jp-001'],
    ['scp-series-cn', '/scp-cn-001', 'scp-series-cn-001'],
    ['joke-scps', '/scp-001-j', 'joke-scps-001'],
    ['scp-ex', '/scp-001-ex', 'scp-ex-001'],
  ]) assert.equal(buildEntries([candidate(href)], { pageType: type })[0].itemId, expected);
});

test('extractor rejects ID collisions instead of silently dropping an article', () => {
  assert.throws(() => buildEntries([
    candidate('/scp-001-cn'), candidate('/scp-cn-001'),
  ], { pageType: 'scp-series-cn' }), /Conflicting extracted itemId/);
});

test('repeated article URLs deduplicate but different or unknown URLs block publishing', () => {
  const first = row('scp-series-4697', 'http://scp-wiki.wikidot.com/scp-4697', { lastUpdated: '2026-09-01' });
  const latest = { ...first, urlJP: 'https://scp-wiki.wikidot.com/scp-4697#toc', lastUpdated: '2026-09-02' };
  assert.deepEqual(deduplicateArticles([first, latest, first]), [latest]);
  assert.throws(() => deduplicateArticles([first, { ...first, urlJP: 'https://scp-wiki.wikidot.com/scp-4697-ru' }]), /conflicting itemId/);
  assert.throws(() => deduplicateArticles([row('same'), row('same')]), /conflicting itemId/);
});

test('cross-page collision fails merge without overwriting the previous catalog', t => {
  const root = temporary(t);
  const partial = path.join(root, 'partial');
  const output = path.join(root, 'local-data');
  fs.mkdirSync(partial);
  fs.mkdirSync(path.join(output, 'cn'), { recursive: true });
  const catalogFile = path.join(output, 'cn', 'scp-data.json');
  fs.writeFileSync(catalogFile, 'original');
  const pages = LANGUAGES.cn.pages;
  for (const [i, page] of pages.entries()) {
    fs.writeFileSync(path.join(partial, `cn--${page.path}.json`), JSON.stringify({
      timestamp: '2026-10-06T00:00:00Z', data: [row(i < 2 ? 'collision' : `id-${i}`, `https://example.org/scp-${i}`)],
    }));
  }
  assert.throws(() => mergeLanguage('cn', partial, output), /conflicting itemId collision/);
  assert.equal(fs.readFileSync(catalogFile, 'utf8'), 'original');
  const secondFile = path.join(partial, `cn--${pages[1].path}.json`);
  const second = JSON.parse(fs.readFileSync(secondFile));
  second.data[0].urlJP = 'https://example.org/scp-0';
  fs.writeFileSync(secondFile, JSON.stringify(second));
  assert.equal(mergeLanguage('cn', partial, output), true);
  const merged = JSON.parse(fs.readFileSync(catalogFile));
  assert.equal(merged.totalCount, pages.length - 1);
  assert.equal(validateCatalogs(output), 1);
  // Retained languages are checked too, even if their crawl was skipped.
  fs.mkdirSync(path.join(output, 'it'));
  fs.writeFileSync(path.join(output, 'it', 'scp-data.json'), JSON.stringify({ totalCount: 2, data: [row('dup'), row('dup')] }));
  assert.throws(() => validateCatalogs(output), /conflicting itemId/);
});

test('crawler never inherits details from a different URL with the same old ID', async t => {
  const crawler = new LocalSCPCrawler('cn');
  crawler.startTime = new Date();
  crawler.totalUrls = 1;
  crawler.entryDelayMs = 0;
  crawler.displayProgress = () => {};
  t.mock.method(axios, 'get', async () => ({ status: 200,
    data: '<ul><li><a href="/scp-1380">SCP-1380</a> - Correct</li></ul>' }));
  crawler.extractScpDetailsFromPage = async () => ({ fetchSucceeded: false, tags: [], tagVersion: null });
  const old = row('scp-series-1380', `${crawler.baseUrl}/scp-1380-ru`, {
    imageUrl: 'wrong-image', objectClass: 'wrong-class', descriptionExcerpt: 'wrong-excerpt', tags: ['wrong-tag'],
  });
  const result = await crawler.extractScpDataFromUrl(`${crawler.baseUrl}/scp-series-2`, new Map([[old.itemId, old]]), 1);
  assert.equal(result.length, 1);
  for (const field of ['imageUrl', 'objectClass', 'descriptionExcerpt']) assert.equal(result[0][field], null);
  assert.deepEqual(result[0].tags, []);
});

test('repair preserves articles and creation dates, refreshes metadata, and is idempotent', async t => {
  const root = temporary(t);
  const createdAt = '2026-08-01T00:00:00Z';
  const catalogs = {
    cn: [row('scp-series-1380', 'https://example.org/scp-1380', { createdAt }),
      row('scp-series-1380', 'https://example.org/scp-1380-ru', { createdAt })],
    it: Array.from({ length: 3 }, () => row('scp-series-4697', 'https://example.org/scp-4697', { createdAt })),
  };
  for (const [lang, data] of Object.entries(catalogs)) {
    fs.mkdirSync(path.join(root, lang));
    fs.writeFileSync(path.join(root, lang, 'scp-data.json'), JSON.stringify({ data, totalCount: data.length }));
    fs.writeFileSync(path.join(root, lang, 'meta.json'), '{}');
  }
  const original = fs.readFileSync(path.join(root, 'cn', 'scp-data.json'), 'utf8');
  await assert.rejects(repair(root, async () => ({ fetchSucceeded: false })), /Could not refresh/);
  assert.equal(fs.readFileSync(path.join(root, 'cn', 'scp-data.json'), 'utf8'), original);
  const now = '2026-10-06T00:00:00Z';
  const calls = [];
  assert.deepEqual(await repair(root, async url => {
    calls.push(url);
    return { fetchSucceeded: true, imageUrl: null, objectClass: 'Safe', rating: 1,
      descriptionExcerpt: url, tags: [], tagVersion: 2 };
  }, now), ['cn', 'it']);
  assert.equal(calls.length, 2);
  const cn = JSON.parse(fs.readFileSync(path.join(root, 'cn', 'scp-data.json')));
  assert.deepEqual(cn.data.map(item => item.itemId), ['scp-series-1380', 'scp-series-1380-ru']);
  assert.ok(cn.data.every(item => item.createdAt === createdAt));
  assert.equal(cn.timestamp, now);
  const itMeta = JSON.parse(fs.readFileSync(path.join(root, 'it', 'meta.json')));
  assert.equal(itMeta.totalCount, 1);
  assert.equal(itMeta.lastUpdated, now);
  assert.deepEqual(await repair(root, async () => { throw new Error('Unexpected fetch'); }), []);
});

test('workflow validates final catalogs before notification preparation and push', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/scp-crawler.yml'), 'utf8');
  const validation = workflow.indexOf('run: node catalog-identity.js');
  assert.ok(validation > workflow.indexOf('run: node apply-manga-flags.js'));
  assert.ok(validation < workflow.indexOf('run: node prepare-notification-queue.js'));
  assert.ok(validation < workflow.indexOf('git push origin master'));
});
