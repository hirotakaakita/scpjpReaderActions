const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main: sendNotifications } = require('../send-scheduled-notifications');

const repository = path.resolve(__dirname, '..');
const queueRelativePath = 'local-data/notification-queue.json';
const sundayEvening = new Date('2026-10-04T11:00:00Z'); // Sunday 20:00 in Japan.
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
  for (const file of ['prepare-notification-queue.js', 'languages.js']) {
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
  const commitState = () => {
    // Execute the actual Actions commit block, including its missing-file guard.
    const workflow = fs.readFileSync(path.join(repository, '.github/workflows/scheduled-notifications.yml'), 'utf8');
    const block = workflow.split('      - name: Commit notification state')[1]
      .split('        run: |')[1].split(/\r?\n/)
      .map(line => line.replace(/^          /, '')).join('\n');
    const bash = process.platform === 'win32'
      ? path.resolve(git('--exec-path'), '../../../bin/bash.exe') : 'bash';
    return execFileSync(bash, ['--noprofile', '--norc', '-eo', 'pipefail', '-c', block], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: gitEnv,
    });
  };
  return { root, cwd, git, queuePath, writeCatalog, generate, readQueue, commitState };
}

function noNetwork() {
  assert.fail('No authentication or FCM request should be made');
}

test('missing queue skips sending and the actual workflow commit block succeeds', async t => {
  const f = fixture(t);
  const head = f.git('rev-parse', 'HEAD');
  await sendNotifications({ queuePath: f.queuePath, secret, now: sundayEvening,
    getAccessToken: noNetwork, sendRequest: noNetwork });
  assert.match(f.commitState(), /No notification queue yet/);
  assert.equal(fs.existsSync(f.queuePath), false);
  assert.equal(f.git('rev-parse', 'HEAD'), head);
  assert.equal(f.git('status', '--porcelain'), '');
});

test('generation with no catalog changes creates an empty queue without sending', async t => {
  const f = fixture(t);
  f.generate();
  assert.ok(Object.values(f.readQueue().pending).every(state => state.items.length === 0));
  const before = fs.readFileSync(f.queuePath, 'utf8');
  await sendNotifications({ queuePath: f.queuePath, secret, now: sundayEvening,
    getAccessToken: noNetwork, sendRequest: noNetwork });
  assert.equal(fs.readFileSync(f.queuePath, 'utf8'), before);
  f.git('add', queueRelativePath);
  f.git('commit', '-m', 'Store empty queue');
  const head = f.git('rev-parse', 'HEAD');
  f.commitState(); // No remote: unchanged state must exit before pull/push.
  assert.equal(f.git('rev-parse', 'HEAD'), head);
});

test('new catalog entries are queued once, sent, committed and not resent', async t => {
  const f = fixture(t);
  f.writeCatalog([
    { itemId: 'scp-series-1', titleJP: 'Existing article' },
    { itemId: 'scp-series-2', titleJP: 'New article' },
  ]);
  f.generate();
  f.generate();
  assert.deepEqual(f.readQueue().pending.jp.items, [
    { itemId: 'scp-series-2', titleJP: 'New article' },
  ]);
  f.git('add', 'local-data');
  f.git('commit', '-m', 'Publish catalog and queue');
  // A local bare remote exercises the workflow push without contacting GitHub.
  const remote = path.join(f.root, 'remote.git');
  f.git('init', '--bare', remote);
  f.git('remote', 'add', 'origin', remote);
  f.git('push', '-u', 'origin', 'master');
  const requests = [];
  const options = { queuePath: f.queuePath, secret, now: sundayEvening,
    getAccessToken: async account => {
      assert.equal(account.project_id, 'test-project');
      return 'test-token';
    },
    sendRequest: async (...args) => { requests.push(args); return '{}'; },
  };
  await sendNotifications(options);
  assert.equal(requests.length, 1);
  const [host, endpoint, method, payload, headers] = requests[0];
  assert.equal(host, 'fcm.googleapis.com');
  assert.equal(endpoint, '/v1/projects/test-project/messages:send');
  assert.equal(method, 'POST');
  assert.equal(JSON.parse(payload).message.topic, 'new_scp_jp');
  assert.match(JSON.parse(payload).message.notification.body, /New article/);
  assert.equal(headers.Authorization, 'Bearer test-token');
  assert.deepEqual(f.readQueue().pending.jp, { items: [], lastSentWindow: '2026-10-04' });
  f.commitState();
  assert.equal(f.git('status', '--porcelain'), '');
  assert.equal(f.git('rev-parse', 'HEAD'), f.git('--git-dir', remote, 'rev-parse', 'master'));
  const head = f.git('rev-parse', 'HEAD');
  await sendNotifications(options);
  f.commitState();
  assert.equal(requests.length, 1);
  assert.equal(f.git('rev-parse', 'HEAD'), head);
});

test('missing credentials, outside delivery time, and FCM failure retain pending items', async t => {
  const f = fixture(t);
  const queue = { version: 1, pending: { jp: {
    items: [{ itemId: 'scp-series-2', titleJP: 'New article' }], lastSentWindow: null,
  } } };
  fs.writeFileSync(f.queuePath, JSON.stringify(queue));
  const before = fs.readFileSync(f.queuePath, 'utf8');
  await sendNotifications({ queuePath: f.queuePath, secret: '', now: sundayEvening,
    getAccessToken: noNetwork, sendRequest: noNetwork });
  assert.equal(fs.readFileSync(f.queuePath, 'utf8'), before);
  await sendNotifications({ queuePath: f.queuePath, secret, now: new Date('2026-10-05T11:00:00Z'),
    getAccessToken: noNetwork, sendRequest: noNetwork });
  assert.equal(fs.readFileSync(f.queuePath, 'utf8'), before);
  await assert.rejects(sendNotifications({ queuePath: f.queuePath, secret, now: sundayEvening,
    getAccessToken: async () => 'test-token',
    sendRequest: async () => { throw new Error('FCM unavailable'); },
  }), /FCM unavailable/);
  assert.equal(fs.readFileSync(f.queuePath, 'utf8'), before);
});
