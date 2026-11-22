const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { LANGUAGES } = require('./languages');
const { readDelivery } = require('./catalog-arrivals');

const QUEUE_PATH = path.join(__dirname, 'local-data', 'notification-queue.json');

function readFromHead(file) {
  const relative = path.relative(__dirname, file).split(path.sep).join('/');
  const options = {
      cwd: __dirname, encoding: 'utf8', maxBuffer: 100 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
  };
  if (!execFileSync('git', ['ls-tree', '--name-only', 'HEAD', '--', relative], options).trim()) return null;
  return execFileSync('git', ['show', `HEAD:${relative}`], { ...options, encoding: null });
}

function catalogItems(lang, previous = false) {
  const read = previous ? readFromHead : file => fs.existsSync(file) ? fs.readFileSync(file) : null;
  const file = path.join(__dirname, 'local-data', lang, 'scp-data.json');
  const bytes = read(file);
  const legacy = bytes ? JSON.parse(bytes).data || [] : [];
  const mobile = readDelivery(path.join(__dirname, 'local-data', 'mobile-v3', lang), read);
  // Preserve notifications for legacy article types. Additional SCPs use the
  // same IDs and language boundary as the actual app delivery, after deduplication.
  return [...legacy, ...(mobile?.data || []).filter(item => item.contentType === 'scp')];
}

function main() {
  let queue = { version: 1, pending: {} };
  if (fs.existsSync(QUEUE_PATH)) {
    try { queue = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8')); } catch (_) { /* recreate invalid queue */ }
  }
  queue.version = 1;
  if (!queue.pending || typeof queue.pending !== 'object') queue.pending = {};
  for (const lang of Object.keys(LANGUAGES)) {
    const previous = new Map(catalogItems(lang, true).map(item => [item.itemId, item]));
    const state = queue.pending?.[lang] || { items: [], lastSentWindow: null };
    const items = new Map((state.items || []).map(item => [item.itemId, item]));
    for (const item of catalogItems(lang)) {
      if (item.itemId && !previous.has(item.itemId)) items.set(item.itemId, { itemId: item.itemId, titleJP: item.titleJP || '' });
    }
    queue.pending[lang] = { ...state, items: [...items.values()] };
  }
  queue.updatedAt = new Date().toISOString();
  fs.writeFileSync(QUEUE_PATH, `${JSON.stringify(queue, null, 2)}\n`, 'utf8');
}

main();
