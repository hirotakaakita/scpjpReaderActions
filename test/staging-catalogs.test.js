const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { crawlRussianApi } = require('../rufoundation-crawler');
const { mergeLanguage } = require('../merge-data');
const { validate } = require('../validate-staging-catalogs');

test('bootstrap permits absent new languages but validates incomplete or published ones', t => {
  const { root } = fixture(t);
  const { publishedLanguages } = require('../validate-staging-catalogs');
  assert.ok(publishedLanguages(root).includes('ru'), 'Existing languages stay mandatory');
  assert.ok(!publishedLanguages(root).includes('ar'), 'Not yet crawled additions are absent');
  assert.throws(() => validate(root, ['en', 'ar']), /ENOENT/);
  const dir = path.join(root, 'local-data', 'ar');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), '{}');
  assert.ok(publishedLanguages(root).includes('ar'));
  assert.throws(() => validate(root, ['en', 'ar']), /ENOENT/);
  fs.writeFileSync(path.join(dir, 'scp-data.json'), JSON.stringify({ data: [] }));
  assert.throws(() => validate(root, ['en', 'ar']), /Empty catalog/);
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-ru-bootstrap-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('scp-ru-bootstrap-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  for (const name of ['RU_API_LIMIT', 'RU_API_REQUEST_INTERVAL_MS']) {
    const old = process.env[name];
    process.env[name] = '0';
    t.after(() => { if (old === undefined) delete process.env[name]; else process.env[name] = old; });
  }
  const output = path.join(root, 'local-data');
  fs.mkdirSync(path.join(output, 'en'), { recursive: true });
  const timestamp = '2026-09-01T00:00:00Z';
  const data = ['002', '003'].map(number => ({
    itemId: `scp-series-${number}`, titleJP: `SCP-${number}`, numericItemId: Number(number),
    urlEN: `https://scp-wiki.wikidot.com/scp-${number}`, urlJP: `https://scp-wiki.wikidot.com/scp-${number}`,
    extractedFrom: 'scp-series', pageType: 'scp-series', contentType: 'scp',
    lastUpdated: timestamp, createdAt: timestamp, isTranslatedJP: true, tags: [],
  }));
  fs.writeFileSync(path.join(output, 'en', 'scp-data.json'), JSON.stringify({ timestamp, totalCount: 2, data }));
  fs.writeFileSync(path.join(output, 'en', 'meta.json'), JSON.stringify({ lastUpdated: timestamp, totalCount: 2 }));
  fs.writeFileSync(path.join(root, 'app-status.json'), JSON.stringify({ androidStoreUrl: '', maintenance: false }));
  return { root, output, timestamp };
}

test('missing configured language still fails validation', t => {
  const { root } = fixture(t);
  assert.throws(() => validate(root, ['en', 'ru']), /ENOENT/);
});

test('verified API bootstrap satisfies app schema without untranslated fallback rows', async t => {
  const { root, output, timestamp } = fixture(t);
  const articles = [
    { pageId: 'scp-002', title: 'SCP-002 - Translation', tags: [], createdAt: timestamp, updatedAt: timestamp },
    { pageId: 'scp-002-ru', title: 'SCP-002-RU - Original', tags: [], createdAt: timestamp, updatedAt: timestamp },
  ];
  const result = await crawlRussianApi({ root, request: async url => {
    if (url === 'https://scpfoundation.net/api/articles') return articles;
    return { source: '**Object Class:** Safe\n\n**Description:** Verified detail.' };
  } });
  assert.equal(result.totalCount, 2);
  const translated = result.data.find(item => item.itemId === 'scp-series-002');
  assert.equal(translated.isTranslatedJP, true);
  assert.equal(translated.createdAt, timestamp);
  assert.equal(translated.detailFetchStatus, 'success');
  assert.equal(translated.descriptionExcerpt, 'Verified detail.');
  assert.equal(translated.extractedFrom, 'scp-series');
  assert.equal(result.data.some(item => item.itemId === 'scp-series-003'), false);
  assert.ok(result.data.some(item => item.itemId === 'scp-series-002-ru'));
  assert.equal(mergeLanguage('ru', path.join(root, 'partial-data'), output), true);
  validate(root, ['en', 'ru']);

  const calls = [];
  const refreshed = await crawlRussianApi({ root, request: async url => {
    calls.push(url);
    if (url.endsWith('/api/articles')) return articles;
    return { source: '**Object Class:** Safe\n\n**Description:** Verified detail.' };
  } });
  assert.equal(calls.length, 1);
  assert.equal(refreshed.data.find(item => item.itemId === 'scp-series-002').detailFetchStatus, 'success');

  const file = path.join(output, 'ru', 'scp-data.json');
  const catalog = JSON.parse(fs.readFileSync(file));
  delete catalog.data[0].lastUpdated;
  fs.writeFileSync(file, JSON.stringify(catalog));
  assert.throws(() => validate(root, ['en', 'ru']), /missing lastUpdated/);
});

test('failed API bootstrap never leaves a publishable partial catalog', async t => {
  const { root } = fixture(t);
  await assert.rejects(crawlRussianApi({ root, metadataOnly: true, request: async () => {
    throw new Error('API unavailable');
  } }), /API unavailable/);
  assert.equal(fs.existsSync(path.join(root, 'partial-data', 'ru--api.json')), false);
});
