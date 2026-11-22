const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { LANGUAGES } = require('../languages');
const { MESSAGES, buildNotification } = require('../notification-messages');
const { main, TIMEZONES } = require('../send-scheduled-notifications');

test('all 33 crawl branches have an explicit notification locale and delivery timezone', () => {
  const codes = Object.keys(LANGUAGES).sort();
  assert.equal(codes.length, 33);
  assert.deepEqual(Object.keys(TIMEZONES).sort(), codes);
  assert.deepEqual(Object.keys(MESSAGES).sort(), codes);
  const matrix = JSON.parse(execFileSync(process.execPath, ['print-matrix.js'], {
    cwd: path.resolve(__dirname, '..'), encoding: 'utf8',
  }));
  assert.deepEqual(matrix.include.map(row => row.lang).sort(), codes);
  for (const code of codes) {
    assert.ok(LANGUAGES[code].pages.length, code);
    assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone: TIMEZONES[code] }), code);
  }
});

test('all 33 branches deliver once per week to their environment topic after a durable reservation', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-notification-branches-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const codes = Object.keys(LANGUAGES);
  const queuePath = path.join(root, 'notification-queue.json');
  const ledgerPath = path.join(root, 'notification-deliveries.json');
  const staging = fs.existsSync(path.resolve(__dirname, '../staging-environment.js'));
  const topicPrefix = staging ? require('../staging-environment').TOPIC_PREFIX : 'new_scp_';
  const account = { type: 'service_account', project_id: staging ? 'scpjp-reader-stg' : 'test-project' };
  fs.writeFileSync(queuePath, JSON.stringify({ version: 1, pending: Object.fromEntries(codes.map(code => [code, {
    items: [{ itemId: 'scp-series-173', titleJP: 'New article' }], lastSentWindow: null,
  }])) }));
  const sent = [];
  const options = {
    queuePath, ledgerPath, secret: JSON.stringify(account), getAccessToken: async () => 'mock-token',
    persist: async (queue, ledger) => {
      fs.writeFileSync(queuePath, JSON.stringify(queue));
      fs.writeFileSync(ledgerPath, JSON.stringify(ledger));
    },
    sendRequest: async (host, endpoint, method, body) => {
      assert.equal(host, 'fcm.googleapis.com');
      assert.equal(endpoint, `/v1/projects/${account.project_id}/messages:send`);
      assert.equal(method, 'POST');
      const { message } = JSON.parse(body);
      const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
      const record = ledger.deliveries.find(row => row.id === message.data.delivery_id);
      assert.equal(record.status, 'sending');
      assert.equal(message.topic, topicPrefix + record.lang);
      assert.deepEqual(message.notification, buildNotification(record.lang, record.items));
      sent.push(record.lang);
      return JSON.stringify({ name: `projects/mock/messages/${sent.length}` });
    },
  };
  // Cover Saturday evening in all timezones, including the UTC Sunday Americas.
  for (let hour = 0; hour < 48; hour++) {
    await main({ ...options, now: new Date(Date.UTC(2026, 10, 14, hour)) });
  }
  assert.deepEqual(sent.slice().sort(), codes.slice().sort());
  const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  assert.ok(codes.every(code => queue.pending[code].lastSentWindow === '2026-11-14'));
  assert.ok(codes.every(code => queue.pending[code].items.length === 0));
  // Later arrivals outside Saturday 19:00 must wait for the next weekly window.
  for (const code of codes) queue.pending[code].items.push({ itemId: 'scp-series-174', titleJP: 'Later' });
  fs.writeFileSync(queuePath, JSON.stringify(queue));
  for (let hour = 0; hour < 24; hour++) {
    await main({ ...options, now: new Date(Date.UTC(2026, 10, 18, hour)) });
  }
  assert.equal(sent.length, 33);
});
