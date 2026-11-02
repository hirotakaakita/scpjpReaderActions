'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { digest, makeRecord, normalizePage } = require('./core');
function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value));
  fs.renameSync(temporary, file);
}
function recordPath(dir, url) { return path.join(dir, `${digest(normalizePage(url)?.id || url)}.json`); }
function readRecord(dir, url) {
  const file = recordPath(dir, url);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function captureDirectory() { return process.env.RELATIONS_CAPTURE_DIR || path.join(__dirname, '..', 'partial-data', 'relations'); }
function capture(url, body, format = 'html', dir = captureDirectory()) {
  const record = makeRecord(url, body, format);
  atomicJson(recordPath(dir, url), { record, lastAttempt: { status: 'success', at: record.checkedAt } });
  return record;
}
function captureFailure(url, status, dir = captureDirectory()) {
  const previous = readRecord(dir, url);
  atomicJson(recordPath(dir, url), { url, record: previous?.record || null,
    lastAttempt: { at: new Date().toISOString(), status } });
}
function recordFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))
    .flatMap(entry => entry.isDirectory() ? recordFiles(path.join(dir, entry.name))
      : entry.isFile() && entry.name.endsWith('.json') ? [path.join(dir, entry.name)] : []);
}
module.exports = { atomicJson, recordPath, readRecord, capture, captureFailure, recordFiles };
