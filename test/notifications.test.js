const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main: sendNotifications, deliveryWindow } = require('../send-scheduled-notifications');
const { readLedger, gitPersistence } = require('../notification-state');
const { recover } = require('../recover-notification');

const repository = path.resolve(__dirname, '..');
const queueRelativePath = 'local-data/notification-queue.json';
const saturdayEvening = new Date('2026-10-03T10:00:00Z'); // Saturday 19:00 in Japan.
const secret = JSON.stringify({ project_id: 'test-project' });

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-notifications-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'work');
  fs.mkdirSync(cwd);
  const gitConfig = path.join(root, 'empty.gitconfig');
  fs.writeFileSync(gitConfig, '');
  const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: gitConfig };
  const git = (...args) => execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: gitEnv,
  }).trim();
  git('init', '-b', 'master');
  git('config', 'user.name', 'Notification Test');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.autocrlf', 'false');
  for (const file of ['prepare-notification-queue.js', 'languages.js', 'additional-sites.js', 'additional-sites.json']) {
    fs.copyFileSync(path.join(repository, file), path.join(cwd, file));
  }
  const catalogPath = path.join(cwd, 'local-data/jp/scp-data.json');
  fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
  const writeCatalog = data => fs.writeFileSync(catalogPath, JSON.stringify({ data }));
  writeCatalog([{ itemId: 'scp-series-1', titleJP: 'Existing article' }]);
  git('add', '.');
  git('commit', '-m', 'Initial catalog');
  const queuePath = path.join(cwd, queueRelativePath);
  const generate = () => execFileSync(process.execPath, ['prepare-notification-queue.js'], {
    cwd, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const readQueue = () => JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  const remote = path.join(root, 'remote.git');
  git('init', '--bare', remote);
  git('remote', 'add', 'origin', remote);
  git('push', '-u', 'origin', 'master');
  const ledgerPath = path.join(cwd, 'local-data/notification-deliveries.json');
  const persist = gitPersistence(queuePath, ledgerPath, cwd);
  const remoteLedger = () => JSON.parse(git('--git-dir', remote, 'show', 'master:local-data/notification-deliveries.json'));
  const options = { queuePath, ledgerPath, persist, secret, now: saturdayEvening,
    getAccessToken: async () => 'test-token', sendRequest: async () => JSON.stringify({ name: 'projects/test/messages/1' }) };
  const seed = (langs = ['jp']) => {
    fs.writeFileSync(queuePath, JSON.stringify({ version: 1, pending: Object.fromEntries(langs.map(lang => [lang, {
      items: [{ itemId: 'scp-series-2', titleJP: 'New article' }], lastSentWindow: null,
    }])) }));
    git('add', 'local-data'); git('commit', '-m', 'Queue new articles'); git('push', 'origin', 'master');
  };
  const restart = () => {
    const next = path.join(root, 'restart');
    git('clone', remote, next);
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: next });
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: next });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: next });
    const nextQueue = path.join(next, queueRelativePath);
    const nextLedger = path.join(next, 'local-data/notification-deliveries.json');
    return { ...options, queuePath: nextQueue, ledgerPath: nextLedger,
      persist: gitPersistence(nextQueue, nextLedger, next) };
  };
  return { root, cwd, git, queuePath, ledgerPath, writeCatalog, generate, readQueue, remoteLedger, options, seed, restart };

}

function noNetwork() {
  assert.fail('No authentication or FCM request should be made');
}

test('enabling extra branches preserves history and queues only articles added after the published baseline', t => {
  const f = fixture(t);
  const codes = Object.keys(require('../additional-sites.json'));
  for (const code of codes) {
    const directory = path.join(f.cwd, 'local-data', code);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'scp-data.json'), JSON.stringify({ data: [
      { itemId: 'scp-series-1', titleJP: 'Already published' },
    ] }));
  }
  f.seed();
  const before = f.readQueue();
  before.pending.jp.lastSentWindow = '2026-10-03';
  fs.writeFileSync(f.queuePath, JSON.stringify(before));
  fs.writeFileSync(f.ledgerPath, JSON.stringify({ version: 1, deliveries: [] }));
  const ledger = fs.readFileSync(f.ledgerPath, 'utf8');
  f.generate();
  assert.deepEqual(f.readQueue().pending.jp, before.pending.jp);
  for (const code of codes) assert.equal(f.readQueue().pending[code].items.length, 0, code);
  for (const code of codes) {
    fs.writeFileSync(path.join(f.cwd, 'local-data', code, 'scp-data.json'), JSON.stringify({ data: [
      { itemId: 'scp-series-1', titleJP: 'Already published' },
      { itemId: 'scp-series-2', titleJP: 'New article' },
    ] }));
  }
  f.generate(); f.generate();
  const after = f.readQueue();
  assert.deepEqual(after.pending.jp, before.pending.jp);
  for (const code of codes) assert.deepEqual(after.pending[code].items.map(row => row.itemId), ['scp-series-2'], code);
  assert.equal(fs.readFileSync(f.ledgerPath, 'utf8'), ledger);
});

test('missing and empty queues perform no network or persistence operations', async t => {
  const f = fixture(t);
  const options = { ...f.options, getAccessToken: noNetwork, sendRequest: noNetwork, persist: noNetwork };
  await sendNotifications(options);
  assert.equal(fs.existsSync(f.queuePath), false);
  f.generate();
  assert.ok(Object.values(f.readQueue().pending).every(state => !state.items.length));
  await sendNotifications(options);
});

test('catalog diff -> remote reservation -> FCM -> remote receipt; rerun never resends', async t => {
  const f = fixture(t);
  f.writeCatalog([{ itemId: 'scp-series-1', titleJP: 'Old' }, { itemId: 'scp-series-2', titleJP: 'New article' }]);
  f.generate(); f.generate();
  assert.equal(f.readQueue().pending.jp.items.length, 1);
  f.git('add', 'local-data'); f.git('commit', '-m', 'Publish catalog'); f.git('push', 'origin', 'master');
  let sends = 0;
  await sendNotifications({ ...f.options, sendRequest: async (host, endpoint, method, payload) => {
    sends++;
    assert.equal(f.remoteLedger().deliveries[0].status, 'sending');
    assert.equal(JSON.parse(payload).message.topic, 'new_scp_jp');
    assert.equal(JSON.parse(payload).message.data.delivery_id, 'jp/2026-10-03');
    return JSON.stringify({ name: 'projects/test/messages/accepted' });
  } });
  assert.equal(sends, 1);
  assert.equal(f.remoteLedger().deliveries[0].status, 'sent');
  assert.equal(f.remoteLedger().deliveries[0].messageName, 'projects/test/messages/accepted');
  assert.equal(f.readQueue().pending.jp.items.length, 0);
  await sendNotifications({ ...f.restart(), sendRequest: noNetwork, getAccessToken: noNetwork });
});

test('FCM failure between successful languages retains individual durable outcomes', async t => {
  const f = fixture(t); f.seed(['jp', 'ko', 'cn']);
  // Japan/Korea reach 19:00 one hour before China.
  const now = saturdayEvening;
  const messages = [];
  const sendRequest = async (h, p, m, payload) => {
    const message = JSON.parse(payload).message;
    messages.push(message);
    const lang = message.topic.split('_').at(-1);
    if (lang === 'ko') throw new Error('Connection lost');
    return JSON.stringify({ name: 'projects/test/messages/ok' });
  };
  await assert.rejects(sendNotifications({ ...f.options, now, sendRequest }), /ko.*unknown/);
  await assert.rejects(sendNotifications({ ...f.options, now: new Date('2026-10-03T11:00:00Z'), sendRequest }), /ko.*unresolved/);
  for (const message of messages) {
    const lang = message.topic.split('_').at(-1);
    const expected = { jp: '新着SCPのお知らせ', ko: '새 SCP 문서', cn: 'SCP新文章通知' };
    assert.equal(message.notification.title, expected[lang]);
    assert.ok(message.notification.body.includes({ jp: '新着記事：1件。', ko: '새 문서 1개:', cn: '新文章：1篇。' }[lang]));
  }
  assert.deepEqual(f.remoteLedger().deliveries.map(r => [r.lang, r.status]), [['jp', 'sent'], ['ko', 'unknown'], ['cn', 'sent']]);
  await assert.rejects(sendNotifications({ ...f.restart(), now, sendRequest: noNetwork, getAccessToken: noNetwork }), /ko.*unresolved/);
});

test('reservation push failure prevents the FCM call', async t => {
  const f = fixture(t); f.seed();
  f.git('remote', 'set-url', '--push', 'origin', path.join(f.root, 'unavailable.git'));
  await assert.rejects(sendNotifications({ ...f.options, sendRequest: noNetwork }), /git push/);
});

test('receipt push failure blocks resend from a fresh checkout, even next week', async t => {
  const f = fixture(t); f.seed();
  await assert.rejects(sendNotifications({ ...f.options, sendRequest: async () => {
    f.git('remote', 'set-url', '--push', 'origin', path.join(f.root, 'unavailable.git'));
    return JSON.stringify({ name: 'projects/test/messages/accepted' });
  } }), /git push/);
  assert.equal(f.remoteLedger().deliveries[0].status, 'sending');
  assert.equal(readLedger(f.ledgerPath).deliveries[0].status, 'sent');
  await assert.rejects(sendNotifications({ ...f.restart(), now: new Date('2026-10-10T10:00:00Z'),
    sendRequest: noNetwork, getAccessToken: noNetwork }), /unresolved/);
});

test('interruption after reservation blocks sending; explicit retry preserves the snapshot', async t => {
  const f = fixture(t); f.seed();
  await assert.rejects(sendNotifications({ ...f.options, sendRequest: noNetwork, persist: async (q, l) => {
    await f.options.persist(q, l); throw new Error('Runner stopped');
  } }), /Runner stopped/);
  const next = f.restart();
  await assert.rejects(sendNotifications({ ...next, sendRequest: noNetwork }), /unresolved/);
  await recover({ ...next, id: 'jp/2026-10-03', action: 'retry', reason: 'Confirmed interruption before FCM call' });
  await sendNotifications(next);
  assert.equal(f.remoteLedger().deliveries[0].status, 'sent');
  assert.equal(f.remoteLedger().deliveries[0].attempts, 2);
  assert.equal(f.remoteLedger().deliveries[0].resolutions[0].action, 'retry');
});

test('manual sent recovery removes only delivered items and never calls FCM', async t => {
  const f = fixture(t); f.seed();
  await assert.rejects(sendNotifications({ ...f.options, sendRequest: async () => { throw new Error('Timeout'); } }), /unknown/);
  await assert.rejects(recover({ ...f.options, id: 'jp/2026-10-03', action: 'sent', reason: '' }), /reason/);
  const q = f.readQueue(); q.pending.jp.items.push({ itemId: 'scp-series-3', titleJP: 'Later arrival' });
  fs.writeFileSync(f.queuePath, JSON.stringify(q));
  await recover({ ...f.options, id: 'jp/2026-10-03', action: 'sent', reason: 'FCM acceptance ID confirmed in logs' });
  assert.deepEqual(f.readQueue().pending.jp.items.map(i => i.itemId), ['scp-series-3']);
  await sendNotifications({ ...f.options, sendRequest: noNetwork, getAccessToken: noNetwork });
  await assert.rejects(recover({ ...f.options, id: 'jp/2026-10-03', action: 'retry', reason: 'Do not retry sent records' }), /unresolved/);
});

test('missing credentials and outside schedule leave pending items unchanged', async t => {
  const f = fixture(t); f.seed();
  const before = fs.readFileSync(f.queuePath, 'utf8');
  await sendNotifications({ ...f.options, secret: '', persist: noNetwork, getAccessToken: noNetwork });
  await sendNotifications({ ...f.options, now: new Date('2026-10-05T10:59:00Z'), persist: noNetwork, getAccessToken: noNetwork });
  assert.equal(fs.readFileSync(f.queuePath, 'utf8'), before);
});

test('corrupt ledger fails closed instead of sending without history', async t => {
  const f = fixture(t); f.seed(); fs.writeFileSync(f.ledgerPath, '{}');
  await assert.rejects(sendNotifications({ ...f.options, sendRequest: noNetwork, getAccessToken: noNetwork }), /Invalid notification ledger/);
});

test('sent ledger reconciles a stale queue without resending or dropping new arrivals', async t => {
  const f = fixture(t); f.seed();
  const stale = f.readQueue();
  await sendNotifications(f.options);
  stale.pending.jp.items.push({ itemId: 'scp-series-3', titleJP: 'Later arrival' });
  fs.writeFileSync(f.queuePath, JSON.stringify(stale));
  f.git('add', 'local-data'); f.git('commit', '-m', 'Simulate stale queue'); f.git('push', 'origin', 'master');
  await sendNotifications({ ...f.options, sendRequest: noNetwork, getAccessToken: noNetwork });
  assert.deepEqual(f.readQueue().pending.jp.items.map(item => item.itemId), ['scp-series-3']);
  assert.equal(f.readQueue().pending.jp.lastSentWindow, '2026-10-03');
});

test('stale checkout cannot overwrite a competing delivery reservation', async t => {
  const f = fixture(t); f.seed();
  const stale = f.restart();
  await sendNotifications(f.options);
  await assert.rejects(sendNotifications({ ...stale, sendRequest: noNetwork }), /current origin\/master/);
  assert.equal(f.remoteLedger().deliveries[0].status, 'sent');
});

test('missed Saturday delivery waits until next Saturday and keeps pending articles', async t => {
  const f = fixture(t); f.seed();
  const before = fs.readFileSync(f.queuePath, 'utf8');
  for (const date of ['2026-10-03T11:00:00Z', '2026-10-04T10:00:00Z', '2026-10-05T10:00:00Z']) {
    await sendNotifications({ ...f.options, now: new Date(date), sendRequest: noNetwork, getAccessToken: noNetwork });
  }
  assert.equal(fs.readFileSync(f.queuePath, 'utf8'), before);
  await sendNotifications({ ...f.options, now: new Date('2026-10-10T10:00:00Z') });
  assert.equal(f.remoteLedger().deliveries[0].window, '2026-10-10');
  assert.equal(f.readQueue().pending.jp.items.length, 0);
});

test('Saturday 19:00 window respects local dates, DST, and the year boundary', () => {
  for (const date of ['2026-10-02T10:00:00Z', '2026-10-03T09:59:59Z',
    '2026-10-03T11:00:00Z', '2026-10-04T10:00:00Z', '2026-10-05T10:00:00Z']) {
    assert.equal(deliveryWindow(new Date(date), 'Asia/Tokyo'), null, date);
  }
  assert.equal(deliveryWindow(new Date('2026-10-03T10:00:00Z'), 'Asia/Tokyo'), '2026-10-03');
  assert.equal(deliveryWindow(new Date('2026-10-03T10:59:59Z'), 'Asia/Tokyo'), '2026-10-03');
  // New York is still Saturday when UTC is already Sunday, in both DST and standard time.
  assert.equal(deliveryWindow(new Date('2026-10-31T23:00:00Z'), 'America/New_York'), '2026-10-31');
  assert.equal(deliveryWindow(new Date('2026-11-07T23:59:59Z'), 'America/New_York'), null);
  assert.equal(deliveryWindow(new Date('2026-11-08T00:00:00Z'), 'America/New_York'), '2026-11-07');
  assert.equal(deliveryWindow(new Date('2026-11-08T01:00:00Z'), 'America/New_York'), null);
  assert.equal(deliveryWindow(new Date('2028-01-01T10:00:00Z'), 'Asia/Tokyo'), '2028-01-01');
});

test('authentication delay past 20:00 leaves articles queued without a reservation', async t => {
  const f = fixture(t); f.seed();
  let now = new Date('2026-10-03T10:59:59Z');
  await sendNotifications({ ...f.options, now: undefined, clock: () => now,
    getAccessToken: async () => { now = new Date('2026-10-03T11:00:00Z'); return 'token'; },
    sendRequest: noNetwork });
  assert.equal(readLedger(f.ledgerPath).deliveries.length, 0);
  assert.equal(f.readQueue().pending.jp.items.length, 1);
});

test('reservation delay past 20:00 safely defers sending until next Saturday', async t => {
  const f = fixture(t); f.seed();
  let now = new Date('2026-10-03T10:59:59Z');
  await sendNotifications({ ...f.options, now: undefined, clock: () => now,
    persist: async (queue, ledger) => {
      await f.options.persist(queue, ledger);
      now = new Date('2026-10-03T11:00:00Z');
    }, sendRequest: noNetwork });
  assert.equal(f.remoteLedger().deliveries[0].status, 'retry');
  assert.equal(f.readQueue().pending.jp.items.length, 1);
  await sendNotifications({ ...f.options, now: new Date('2026-10-10T10:00:00Z') });
  assert.equal(f.remoteLedger().deliveries[0].status, 'sent');
  assert.equal(f.readQueue().pending.jp.lastSentWindow, '2026-10-10');
});

test('previous Sunday delivery keys remain valid after switching to Saturday', async t => {
  const f = fixture(t); f.seed();
  const queue = f.readQueue();
  queue.pending.jp.lastSentWindow = '2026-09-27';
  fs.writeFileSync(f.queuePath, JSON.stringify(queue));
  fs.writeFileSync(f.ledgerPath, JSON.stringify({ version: 1, deliveries: [{
    id: 'jp/2026-09-27', lang: 'jp', window: '2026-09-27', status: 'sent',
    items: [{ itemId: 'scp-series-1', titleJP: 'Previously sent' }],
  }] }));
  f.git('add', 'local-data'); f.git('commit', '-m', 'Previous Sunday history'); f.git('push', 'origin', 'master');
  await sendNotifications(f.options);
  assert.deepEqual(f.remoteLedger().deliveries.map(row => row.id), ['jp/2026-09-27', 'jp/2026-10-03']);
});

test('publisher starting after a send preserves the sent ledger and appends only new arrivals', async t => {
  const f = fixture(t); f.seed();
  await sendNotifications(f.options);
  // This checkout models acquisition of the publish lock after a long crawl.
  const publisher = f.restart();
  const cwd = path.dirname(path.dirname(publisher.queuePath));
  const beforeLedger = fs.readFileSync(publisher.ledgerPath, 'utf8');
  const catalog = { data: [
    { itemId: 'scp-series-1', titleJP: 'Existing article' },
    { itemId: 'scp-series-3', titleJP: 'Newly crawled article' },
  ] };
  fs.writeFileSync(path.join(cwd, 'local-data/jp/scp-data.json'), JSON.stringify(catalog));
  execFileSync(process.execPath, ['prepare-notification-queue.js'], { cwd });
  const queue = JSON.parse(fs.readFileSync(publisher.queuePath, 'utf8'));
  assert.deepEqual(queue.pending.jp.items.map(item => item.itemId), ['scp-series-3']);
  assert.equal(queue.pending.jp.lastSentWindow, '2026-10-03');
  assert.equal(fs.readFileSync(publisher.ledgerPath, 'utf8'), beforeLedger);
});
