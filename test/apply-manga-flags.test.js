const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applyToFile } = require('../apply-manga-flags');

function fixture(t, data) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-manga-flags-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('scp-manga-flags-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, 'scp-data.json');
  const meta = path.join(dir, 'meta.json');
  fs.writeFileSync(file, JSON.stringify({ timestamp: 'old', totalCount: data.length, data }));
  fs.writeFileSync(meta, JSON.stringify({ lastUpdated: 'old', totalCount: data.length }));
  return { file, meta };
}

function article(number, suffix = '', extra = {}) {
  const padded = String(number).padStart(3, '0');
  return {
    itemId: `scp-series-${padded}${suffix}`, numericItemId: number,
    pageType: 'scp-series', urlJP: `https://scpfoundation.net/scp-${padded}${suffix}`,
    createdAt: '2025-01-01T00:00:00Z', mangaLanguages: ['ru'], ...extra,
  };
}

test('Russian variants lose incorrect manga links while canonical articles retain theirs', t => {
  const variants = [[9, '-v'], [13, '-arc'], [39, '-v'], [51, '-arc'], [500, '-j-v']];
  const data = variants.flatMap(([n, suffix]) => [article(n), article(n, suffix)]);
  const { file, meta } = fixture(t, data);
  const map = Object.fromEntries(variants.map(([n]) => [n, ['ru']]));
  const now = '2026-10-06T10:00:00.000Z';
  assert.equal(applyToFile(file, map, now), true);
  const actual = JSON.parse(fs.readFileSync(file));
  assert.equal(actual.timestamp, now);
  assert.equal(JSON.parse(fs.readFileSync(meta)).lastUpdated, now);
  assert.equal(actual.totalCount, data.length);
  for (let i = 0; i < data.length; i++) {
    const expected = { ...data[i] };
    if (i % 2) delete expected.mangaLanguages;
    assert.deepEqual(actual.data[i], expected);
  }
  const before = [fs.readFileSync(file, 'utf8'), fs.readFileSync(meta, 'utf8')];
  assert.equal(applyToFile(file, map, 'later'), false);
  assert.deepEqual([fs.readFileSync(file, 'utf8'), fs.readFileSync(meta, 'utf8')], before);
});

test('identity, URL and series must all identify the same canonical article', t => {
  const data = [
    article(9, '', { urlJP: 'https://scpfoundation.net/scp-009-v' }),
    article(9, '', { urlJP: 'https://scpfoundation.net/scp-013' }),
    article(9, '', { numericItemId: 13 }),
    article(9, '', { itemId: 'scp-series-ru-009', pageType: 'scp-series-ru' }),
    article(9, '', { urlJP: 'invalid' }),
    article(9, '', { urlJP: null }),
    article(9, '', { mangaLanguages: undefined, urlJP: null, urlEN: 'https://scp-wiki.wikidot.com/scp-009' }),
    article(9, '', { mangaLanguages: undefined, urlJP: 'https://scp-jp.wikidot.com/scp-009/#toc' }),
  ];
  const { file } = fixture(t, data);
  assert.equal(applyToFile(file, { 9: ['ja', 'ru'], 13: ['ru'] }), true);
  const result = JSON.parse(fs.readFileSync(file)).data;
  for (const row of result.slice(0, 6)) assert.equal(row.mangaLanguages, undefined);
  for (const row of result.slice(6)) assert.deepEqual(row.mangaLanguages, ['ja', 'ru']);
});

test('removed manga refreshes the catalog and metadata even without a crawl', t => {
  const { file, meta } = fixture(t, [article(9)]);
  assert.equal(applyToFile(file, {}, 'new'), true);
  assert.equal(JSON.parse(fs.readFileSync(file)).data[0].mangaLanguages, undefined);
  assert.equal(JSON.parse(fs.readFileSync(file)).timestamp, 'new');
  assert.equal(JSON.parse(fs.readFileSync(meta)).lastUpdated, 'new');
});
