'use strict';
// Extract alongside normal article fetching. No extra page request or AI call.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { makeRecord, normalizePage, digest } = require('./extract');

function capture(url, body, format = 'html', directory = path.join(__dirname, '../partial-data/research-board'), existingDocument = null) {
  try {
  const page = normalizePage(url);
  if (!page) return;
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${digest(page.id)}.json`);
  const record = makeRecord(url, body, format, new Date().toISOString(), {}, existingDocument);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ record, lastAttempt: { status: 'success', at: record.checkedAt } }));
  fs.renameSync(`${file}.tmp`, file);
  return true;
  } catch (error) {
    console.warn(`Research source capture skipped: ${error.message}`);
    return false; // Optional enrichment must not turn a valid catalog fetch into failure.
  }
}

function captureFailure(url, status = 'fetch_error', directory = path.join(__dirname, '../partial-data/research-board')) {
  const page = normalizePage(url);
  if (!page) return;
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${digest(page.id)}.json`);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ url: page.url, record: null,
    lastAttempt: { status, at: new Date().toISOString() } }));
  fs.renameSync(`${file}.tmp`, file);
}

function readSources(directory) {
  const sources = new Map();
  if (!fs.existsSync(directory)) return sources;
  const pointer = path.join(directory, 'manifest.json');
  const manifest = fs.existsSync(pointer) ? JSON.parse(fs.readFileSync(pointer)) : null;
  if (manifest) for (const name of Object.keys(manifest.files)) {
    if (!/^[a-f0-9]{2}\.json\.gz$/.test(name) || !fs.existsSync(path.join(directory, name))) throw Error('Missing research source shard');
  }
  for (const name of (manifest ? Object.keys(manifest.files) : fs.readdirSync(directory)).sort()) {
    if (!/^[a-f0-9]{2}\.json\.gz$/.test(name)) continue;
    const bytes = fs.readFileSync(path.join(directory, name));
    if (manifest && (manifest.files[name]?.sha256 !== digest(bytes) || manifest.files[name]?.bytes !== bytes.length)) throw Error('Research source checksum mismatch');
    const rows = JSON.parse(zlib.gunzipSync(bytes));
    for (const state of rows) merge(sources, state);
  }
  if (manifest && sources.size !== manifest.recordCount) throw Error('Research source count mismatch');
  return sources;
}

function merge(sources, state) {
  const page = normalizePage(state.record?.url || state.url);
  if (!page || (state.record && (state.record.pageId !== page.id ||
      !/^[a-f0-9]{64}$/.test(state.record.contentSha256)))) throw Error('Invalid research source');
  const old = sources.get(page.id);
  let record = !old?.record || state.record?.checkedAt > old.record.checkedAt ? state.record : old.record;
  const other = record === state.record ? old?.record : state.record;
  if (record && other && record.contentSha256 === other.contentSha256 &&
      (other.linkExtractionVersion || 0) > (record.linkExtractionVersion || 0) && Array.isArray(other.links)) {
    record = {...record, links: other.links, linkExtractionVersion: other.linkExtractionVersion};
  }
  if(record&&other&&record.contentSha256===other.contentSha256&&
      (other.authorCreditVersion||0)>(record.authorCreditVersion||0)){
    record={...record,authorCreditVersion:other.authorCreditVersion,
      originalAuthors:other.originalAuthors||[],upstreamAuthors:other.upstreamAuthors||[],
      translators:other.translators||[],assetAuthors:other.assetAuthors||[]};
  }
  const lastAttempt = !old?.lastAttempt || state.lastAttempt?.at > old.lastAttempt.at ? state.lastAttempt : old.lastAttempt;
  sources.set(page.id, { url: page.url, record: record || null, lastAttempt });
}

function importDirectory(sources, directory) {
  if (!fs.existsSync(directory)) return;
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) importDirectory(sources, file);
    else if (/^[a-f0-9]{64}\.json$/.test(item.name)) merge(sources, JSON.parse(fs.readFileSync(file)));
  }
}

function saveSources(sources, directory) {
  fs.mkdirSync(directory, { recursive: true });
  const buckets = new Map();
  for (const [id, state] of [...sources].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    const key = digest(id).slice(0, 2);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(state);
  }
  const files = {};
  for (const [key, rows] of buckets) {
    const file = path.join(directory, `${key}.json.gz`);
    const json=Buffer.from(JSON.stringify(rows));
    const existing=fs.existsSync(file)?fs.readFileSync(file):null;
    // gzip headers differ between Windows and Linux. Preserve an unchanged
    // shard byte-for-byte so a refresh only rewrites actual source changes.
    const bytes=existing&&zlib.gunzipSync(existing).equals(json)?existing:
      zlib.gzipSync(json,{level:9});
    files[`${key}.json.gz`] = { bytes: bytes.length, sha256: digest(bytes) };
    if (!fs.existsSync(file) || !fs.readFileSync(file).equals(bytes)) {
      fs.writeFileSync(`${file}.tmp`, bytes);
      fs.renameSync(`${file}.tmp`, file);
    }
  }
  fs.writeFileSync(path.join(directory, 'manifest.json.tmp'), JSON.stringify({ schemaVersion: 1, recordCount: sources.size, files }));
  fs.renameSync(path.join(directory, 'manifest.json.tmp'), path.join(directory, 'manifest.json'));
}
module.exports = { capture, captureFailure, readSources, importDirectory, saveSources, merge };
