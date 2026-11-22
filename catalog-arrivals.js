const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

// read returns a Buffer, or null only when the file does not exist.
function readDelivery(directory, read = file => fs.existsSync(file) ? fs.readFileSync(file) : null) {
  const bytes = read(path.join(directory, 'manifest.json'));
  if (bytes === null) return null;
  const manifest = JSON.parse(bytes);
  if (!/^catalog-[a-f0-9]{64}\.json\.gz$/.test(manifest.fileName || '') ||
      !Number.isFinite(Date.parse(manifest.timestamp))) throw Error('Invalid delivery manifest');
  const payload = read(path.join(directory, manifest.fileName));
  if (!payload || crypto.createHash('sha256').update(payload).digest('hex') !== manifest.sha256) {
    throw Error('Delivery checksum mismatch');
  }
  const catalog = JSON.parse(zlib.gunzipSync(payload));
  if (!Array.isArray(catalog.data) || catalog.totalCount !== catalog.data.length ||
      catalog.timestamp !== manifest.timestamp) throw Error('Invalid delivery catalog');
  return catalog;
}

function applyArrivalDates(delivery, previous) {
  const prior = new Map((previous?.data || []).map(row => [row.itemId, row]));
  let repaired = false;
  for (const row of delivery.data) {
    const old = prior.get(row.itemId);
    // checkedAt/lastUpdated can change on every crawl. Retain the first delivered
    // date, and use the old snapshot's date when repairing an undated article.
    row.createdAt = [old?.createdAt, row.createdAt, old?.lastUpdated, row.lastUpdated]
      .find(value => typeof value === 'string' && Number.isFinite(Date.parse(value)));
    if (!row.createdAt) throw Error(`Missing arrival date: ${row.itemId}`);
    if (old && old.createdAt !== row.createdAt) repaired = true;
  }
  if (previous) {
    const floor = Date.parse(previous.timestamp);
    if (repaired && Date.parse(delivery.timestamp) <= floor) {
      delivery.timestamp = new Date(Math.max(Date.now(), floor + 1)).toISOString();
    } else if (Date.parse(delivery.timestamp) < floor) delivery.timestamp = previous.timestamp;
  }
}

module.exports = { readDelivery, applyArrivalDates };
