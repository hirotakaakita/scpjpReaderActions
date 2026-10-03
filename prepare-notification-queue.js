const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { LANGUAGES } = require('./languages');

const QUEUE_PATH = path.join(__dirname, 'local-data', 'notification-queue.json');

function previousData(lang) {
  try {
    return JSON.parse(execFileSync('git', ['show', `HEAD:local-data/${lang}/scp-data.json`], {
      cwd: __dirname, encoding: 'utf8', maxBuffer: 100 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    }));
  } catch (_) { return { data: [] }; }
}

function currentData(lang) {
  const file = path.join(__dirname, 'local-data', lang, 'scp-data.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { data: [] };
}

function main() {
  let queue = { version: 1, pending: {} };
  if (fs.existsSync(QUEUE_PATH)) {
    try { queue = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8')); } catch (_) { /* recreate invalid queue */ }
  }
  queue.version = 1;
  if (!queue.pending || typeof queue.pending !== 'object') queue.pending = {};
  for (const lang of Object.keys(LANGUAGES)) {
    const previous = new Map((previousData(lang).data || []).map(item => [item.itemId, item]));
    const state = queue.pending?.[lang] || { items: [], lastSentWindow: null };
    const items = new Map((state.items || []).map(item => [item.itemId, item]));
    for (const item of currentData(lang).data || []) {
      if (item.itemId && !previous.has(item.itemId)) items.set(item.itemId, { itemId: item.itemId, titleJP: item.titleJP || '' });
    }
    queue.pending[lang] = { ...state, items: [...items.values()] };
  }
  queue.updatedAt = new Date().toISOString();
  fs.writeFileSync(QUEUE_PATH, `${JSON.stringify(queue, null, 2)}\n`, 'utf8');
}

main();
