const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { applyArrivalDates, readDelivery } = require('../catalog-arrivals');
const { generateMobileCatalogs } = require('../mobile-catalog');

test('date repair uses the old snapshot and advances the cache timestamp exactly once', () => {
  const previous = { timestamp: '2026-11-01T00:00:00Z', data: [
    { itemId: 'scp-1', lastUpdated: '2026-10-01T00:00:00Z' },
  ] };
  const delivery = { timestamp: previous.timestamp, data: [
    { itemId: 'scp-1', lastUpdated: '2026-11-01T00:00:00Z' },
    { itemId: 'scp-2', lastUpdated: '2026-11-01T00:00:00Z' },
  ] };
  applyArrivalDates(delivery, previous);
  assert.equal(delivery.data[0].createdAt, previous.data[0].lastUpdated);
  assert.equal(delivery.data[1].createdAt, delivery.data[1].lastUpdated);
  assert.ok(Date.parse(delivery.timestamp) > Date.parse(previous.timestamp));
  const rerun = { timestamp: previous.timestamp, data: delivery.data.map(row => ({
    ...row, createdAt: undefined, lastUpdated: '2026-11-02T00:00:00Z',
  })) };
  applyArrivalDates(rerun, delivery);
  assert.equal(rerun.timestamp, delivery.timestamp);
  assert.deepEqual(rerun.data.map(row => row.createdAt), delivery.data.map(row => row.createdAt));
});

test('invalid dates are repaired; valid source dates are retained on first delivery', () => {
  const delivery = { data: [
    { itemId: 'scp-1', createdAt: 'invalid', lastUpdated: '2026-10-01T00:00:00Z' },
    { itemId: 'scp-2', createdAt: '2026-09-01T00:00:00Z', lastUpdated: '2026-10-01T00:00:00Z' },
  ] };
  applyArrivalDates(delivery, null);
  assert.equal(delivery.data[0].createdAt, delivery.data[0].lastUpdated);
  assert.equal(delivery.data[1].createdAt, '2026-09-01T00:00:00Z');
  assert.throws(() => applyArrivalDates({ data: [{ itemId: 'bad' }] }, null), /Missing arrival date/);
});

test('real generation dates additional SCPs and preserves dates across recrawls', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-arrivals-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, 'local-data');
  fs.mkdirSync(path.join(input, 'jp'), { recursive: true });
  fs.mkdirSync(path.join(input, 'related-documents'));
  const date = '2026-10-01T00:00:00Z';
  fs.writeFileSync(path.join(input, 'jp/scp-data.json'), JSON.stringify({
    language: 'jp', timestamp: date, totalCount: 1, data: [{
      itemId: 'scp-001', titleJP: 'Existing', isTranslatedJP: true,
      extractedFrom: 'scp-series', pageType: 'scp-series', contentType: 'scp', lastUpdated: date,
    }],
  }));
  fs.writeFileSync(path.join(input, 'jp/meta.json'), JSON.stringify({ lastUpdated: date, totalCount: 1 }));
  const extra = { schemaVersion: 1, timestamp: date, totalCount: 1, data: [{
    language: 'jp', itemId: 'scp-series-002', title: 'Additional SCP', numericItemId: 2,
    url: 'https://scp-jp.wikidot.com/scp-002', pageType: 'scp-series', contentType: 'scp',
    lastUpdated: date, tags: [],
  }] };
  const file = path.join(input, 'related-documents/catalog.json');
  fs.writeFileSync(file, JSON.stringify(extra));
  generateMobileCatalogs(input);
  const directory = path.join(input, 'mobile-v3/jp');
  const first = readDelivery(directory);
  assert.equal(first.totalCount, 2);
  assert.ok(first.data.every(row => row.createdAt === date));
  extra.timestamp = extra.data[0].lastUpdated = '2026-11-01T00:00:00Z';
  fs.writeFileSync(file, JSON.stringify(extra));
  generateMobileCatalogs(input);
  const next = readDelivery(directory);
  assert.ok(next.data.every(row => row.createdAt === date));
  const pointer = fs.readFileSync(path.join(directory, 'manifest.json'));
  generateMobileCatalogs(input);
  assert.deepEqual(fs.readFileSync(path.join(directory, 'manifest.json')), pointer);
  // A damaged previous delivery must stop publication, never silently redate articles.
  const manifest = JSON.parse(pointer);
  fs.writeFileSync(path.join(directory, manifest.fileName), 'damaged');
  assert.throws(() => generateMobileCatalogs(input), /checksum/);
});

test('delivery readers reject missing payloads and malformed pointers', () => {
  const catalog = { timestamp: '2026-10-01T00:00:00Z', totalCount: 0, data: [] };
  const payload = zlib.gzipSync(JSON.stringify(catalog));
  const sha256 = crypto.createHash('sha256').update(payload).digest('hex');
  const manifest = { timestamp: catalog.timestamp, sha256, fileName: `catalog-${sha256}.json.gz` };
  const read = file => file.endsWith('manifest.json') ? Buffer.from(JSON.stringify(manifest)) : payload;
  assert.deepEqual(readDelivery('data', read), catalog);
  assert.throws(() => readDelivery('data', file => file.endsWith('manifest.json') ? read(file) : null), /checksum/);
  manifest.fileName = '../catalog.json.gz';
  assert.throws(() => readDelivery('data', read), /manifest/);
});
