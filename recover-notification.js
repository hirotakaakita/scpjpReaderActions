const fs = require('node:fs');
const path = require('node:path');
const { readLedger, reconcile, gitPersistence } = require('./notification-state');

async function recover({
  id, action, reason,
  queuePath = path.join(__dirname, 'local-data/notification-queue.json'),
  ledgerPath = path.join(path.dirname(queuePath), 'notification-deliveries.json'),
  persist = gitPersistence(queuePath, ledgerPath),
}) {
  if (!['sent', 'retry'].includes(action) || !reason?.trim()) {
    throw new Error('Recovery requires action sent/retry and an investigation reason');
  }
  const ledger = readLedger(ledgerPath);
  const record = ledger.deliveries.find(item => item.id === id);
  if (!record || !['sending', 'unknown'].includes(record.status)) {
    throw new Error('Only unresolved deliveries can be recovered');
  }
  record.resolutions ??= [];
  record.resolutions.push({ action, reason, previousStatus: record.status, at: new Date().toISOString() });
  record.status = action;
  const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  reconcile(queue, ledger);
  await persist(queue, ledger);
}

if (require.main === module) {
  recover({ id: process.env.RECOVERY_DELIVERY, action: process.env.RECOVERY_ACTION,
    reason: process.env.RECOVERY_REASON }).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { recover };
