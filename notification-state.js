const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function readLedger(file) {
  if (!fs.existsSync(file)) return { version: 1, deliveries: [] };
  const ledger = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ids = new Set();
  if (ledger.version !== 1 || !Array.isArray(ledger.deliveries)) throw new Error('Invalid notification ledger');
  for (const record of ledger.deliveries) {
    if (!record.lang || !/^\d{4}-\d{2}-\d{2}$/.test(record.window) ||
        record.id !== `${record.lang}/${record.window}` || ids.has(record.id) ||
        !['sending', 'unknown', 'sent', 'retry'].includes(record.status) ||
        !Array.isArray(record.items) || !record.items.length ||
        record.items.some(item => typeof item.itemId !== 'string' || typeof item.titleJP !== 'string')) {
      throw new Error('Invalid notification delivery record');
    }
    ids.add(record.id);
  }
  return ledger;
}

function reconcile(queue, ledger) {
  const before = JSON.stringify(queue);
  for (const record of ledger.deliveries) {
    if (record.status !== 'sent') continue;
    const state = queue.pending?.[record.lang];
    if (!state) continue;
    const delivered = new Set(record.items.map(item => item.itemId));
    state.items = state.items.filter(item => !delivered.has(item.itemId));
    if (!state.lastSentWindow || state.lastSentWindow < record.window) state.lastSentWindow = record.window;
  }
  return before !== JSON.stringify(queue);
}

function writeState(queuePath, ledgerPath, queue, ledger) {
  for (const [file, value] of [[queuePath, queue], [ledgerPath, ledger]]) {
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, file);
  }
}

// Each successful return is a remotely durable checkpoint. Never rebase with
// automatic conflict resolution: a competing update must stop before sending.
function gitPersistence(queuePath, ledgerPath, cwd = __dirname) {
  const git = (...args) => execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return async (queue, ledger) => {
    const remote = git('ls-remote', 'origin', 'refs/heads/master').split(/\s/)[0];
    if (!remote || git('rev-parse', 'HEAD') !== remote) {
      throw new Error('Notification state is not based on current origin/master; reload before retrying');
    }
    if (git('diff', '--cached', '--name-only')) throw new Error('Unrelated staged changes; refusing notification commit');
    writeState(queuePath, ledgerPath, queue, ledger);
    git('add', '--', path.relative(cwd, queuePath), path.relative(cwd, ledgerPath));
    if (git('diff', '--cached', '--name-only')) {
      git('commit', '-m', 'Checkpoint notification deliveries');
      git('push', 'origin', 'HEAD:master');
    }
  };
}

module.exports = { readLedger, reconcile, writeState, gitPersistence };
