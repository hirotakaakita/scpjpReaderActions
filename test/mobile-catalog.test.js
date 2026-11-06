const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { mobileCatalog, generateMobileCatalogs } = require('../mobile-catalog');

function catalog() {
  return { language: 'jp', timestamp: '2026-11-03T00:00:00Z', totalCount: 1,
    statistics: { translated: 1 }, tagSchemaVersion: 2, data: [{
      itemId: 'scp-001', numericItemId: 1, titleJP: '日本語・中文・Русский・😀',
      descriptionExcerpt: '説明文', imageUrl: null, objectClass: 'Safe', rating: 12,
      isTranslatedJP: true, extractedFrom: 'scp-series', pageType: 'scp-series',
      contentType: 'scp', lastUpdated: '2026-11-03T00:00:00Z',
      createdAt: '2026-10-01T00:00:00Z', tagVersion: 3, tagFetchStatus: 'success',
      tags: [{ id: 'tag-1', label: '人間型' }], mangaLanguages: ['jp'], translatedLanguages: ['jp', 'en'],
    }] };
}

test('delivery projection preserves reader fields without mutating crawler state', () => {
  const source = catalog(), before = JSON.stringify(source);
  const mobile = mobileCatalog(source, 'jp');
  assert.equal(JSON.stringify(source), before);
  assert.equal(mobile.schemaVersion, 1);
  assert.deepEqual(mobile.data[0], Object.fromEntries(Object.entries(source.data[0])
    .filter(([key, value]) => !['tagVersion', 'tagFetchStatus'].includes(key) && value !== null)));
  assert.equal(mobile.statistics, undefined);
  assert.throws(() => mobileCatalog({ ...source, totalCount: 2 }, 'jp'));
  assert.throws(() => mobileCatalog({ ...source, data: [source.data[0], source.data[0]], totalCount: 2 }, 'jp'));
});

test('gzip manifest is deterministic, verifiable and leaves legacy files byte-identical', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-catalog-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'local-data'), jp = path.join(input, 'jp');
  fs.mkdirSync(jp, { recursive: true });
  const source = catalog(), legacy = JSON.stringify(source, null, 2);
  const meta = JSON.stringify({ lastUpdated: source.timestamp, totalCount: 1 });
  fs.writeFileSync(path.join(jp, 'scp-data.json'), legacy);
  fs.writeFileSync(path.join(jp, 'meta.json'), meta);
  generateMobileCatalogs(input);
  const output = path.join(input, 'mobile-v1', 'jp');
  const manifest = fs.readFileSync(path.join(output, 'manifest.json'), 'utf8');
  const descriptor = JSON.parse(manifest);
  const compressed = fs.readFileSync(path.join(output, descriptor.fileName));
  const json = zlib.gunzipSync(compressed);
  assert.equal(compressed.length, descriptor.bytes);
  assert.equal(json.length, descriptor.decodedBytes);
  assert.equal(crypto.createHash('sha256').update(compressed).digest('hex'), descriptor.sha256);
  assert.deepEqual(JSON.parse(json), mobileCatalog(source, 'jp'));
  assert.ok(json.toString('utf8').includes(source.data[0].titleJP));
  generateMobileCatalogs(input);
  assert.equal(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'), manifest);
  assert.equal(fs.readFileSync(path.join(jp, 'scp-data.json'), 'utf8'), legacy);
  assert.equal(fs.readFileSync(path.join(jp, 'meta.json'), 'utf8'), meta);
  source.timestamp = '2026-11-04T00:00:00Z';
  fs.writeFileSync(path.join(jp, 'scp-data.json'), JSON.stringify(source));
  assert.throws(() => generateMobileCatalogs(input), /mismatch/);
  assert.equal(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'), manifest);
  fs.writeFileSync(path.join(jp, 'meta.json'), JSON.stringify({ lastUpdated: source.timestamp, totalCount: 1 }));
  generateMobileCatalogs(input);
  const next = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
  assert.notEqual(next.fileName, descriptor.fileName);
  assert.equal(fs.existsSync(path.join(output, descriptor.fileName)), true);
  assert.equal(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(output, next.fileName)))).timestamp, source.timestamp);
});

test('workflow generates mobile catalogs after final legacy updates and before publication', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/scp-crawler.yml'), 'utf8');
  assert.ok(workflow.indexOf('node mobile-catalog.js') > workflow.indexOf('run: node apply-manga-flags.js'));
  assert.ok(workflow.indexOf('node mobile-catalog.js') > workflow.indexOf('run: node catalog-identity.js'));
  assert.ok(workflow.indexOf('node mobile-catalog.js') < workflow.indexOf('git add local-data/'));
  assert.ok(workflow.indexOf('node related-documents.js') < workflow.indexOf('node mobile-catalog.js'));
});

test('additional documents join the ordinary data array by language with a new delivery timestamp', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-related-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, 'local-data');
  fs.mkdirSync(path.join(input, 'jp'), { recursive: true });
  fs.mkdirSync(path.join(input, 'related-documents'));
  const source = catalog();
  fs.writeFileSync(path.join(input, 'jp/scp-data.json'), JSON.stringify(source));
  fs.writeFileSync(path.join(input, 'jp/meta.json'), JSON.stringify({ lastUpdated: source.timestamp, totalCount: 1 }));
  const document = { itemId: 'document-jp--incident-log', language: 'jp', title: 'Incident log',
    url: 'https://scp-jp.wikidot.com/incident-log', pageType: 'related-document-en', contentType: 'log',
    tags: ['en', 'experiment'], descriptionExcerpt: 'Log', lastUpdated: source.timestamp };
  const extra = { schemaVersion: 1, timestamp: '2026-11-05T00:00:00Z', totalCount: 2,
    data: [document, { ...document, language: 'en', itemId: 'document-en--incident-log', url: 'https://scp-wiki.wikidot.com/incident-log' }] };
  fs.writeFileSync(path.join(input, 'related-documents/catalog.json'), JSON.stringify(extra));
  generateMobileCatalogs(input);
  const output = path.join(input, 'mobile-v2/jp');
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json')));
  const result = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(output, manifest.fileName))));
  assert.equal(result.timestamp, extra.timestamp); assert.equal(manifest.timestamp, extra.timestamp);
  assert.equal(result.totalCount, 2); assert.equal(manifest.totalCount, 2);
  assert.deepEqual(result.data[0], mobileCatalog(source, 'jp').data[0]);
  assert.equal(result.data[1].itemId, document.itemId);
  assert.equal(result.data[1].urlJP, document.url);
  assert.deepEqual(result.data[1].tags, [{ id: 'experiment', label: 'experiment' }]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(input, 'jp/scp-data.json'))).totalCount, 1);
  const oldOutput = path.join(input, 'mobile-v1/jp');
  const oldManifest = JSON.parse(fs.readFileSync(path.join(oldOutput, 'manifest.json')));
  const oldPayload = fs.readFileSync(path.join(oldOutput, oldManifest.fileName));
  assert.equal(oldManifest.timestamp, source.timestamp);
  assert.equal(oldManifest.totalCount, source.totalCount);
  assert.deepEqual(JSON.parse(zlib.gunzipSync(oldPayload)), mobileCatalog(source, 'jp'));
  // Additional-only updates must leave the released channel byte-identical.
  const oldPointer = fs.readFileSync(path.join(oldOutput, 'manifest.json'));
  extra.timestamp = '2026-11-06T00:00:00Z';
  extra.data[0].title = 'Updated log';
  fs.writeFileSync(path.join(input, 'related-documents/catalog.json'), JSON.stringify(extra));
  generateMobileCatalogs(input);
  assert.deepEqual(fs.readFileSync(path.join(oldOutput, 'manifest.json')), oldPointer);
  assert.deepEqual(fs.readFileSync(path.join(oldOutput, oldManifest.fileName)), oldPayload);
  const updated = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json')));
  assert.notEqual(updated.fileName, manifest.fileName);
  assert.equal(updated.timestamp, extra.timestamp);
});
