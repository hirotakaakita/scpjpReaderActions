const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { readLedger, reconcile, gitPersistence } = require('./notification-state');

const QUEUE_PATH = path.join(__dirname, 'local-data', 'notification-queue.json');
const TIMEZONES = { jp: 'Asia/Tokyo', en: 'America/New_York', ru: 'Europe/Moscow', cn: 'Asia/Shanghai', cs: 'Europe/Prague', de: 'Europe/Berlin', es: 'Europe/Madrid', fr: 'Europe/Paris', int: 'UTC', it: 'Europe/Rome', ko: 'Asia/Seoul', pl: 'Europe/Warsaw', pt: 'America/Sao_Paulo', th: 'Asia/Bangkok', ua: 'Europe/Kyiv', vn: 'Asia/Ho_Chi_Minh', 'zh-tr': 'Asia/Taipei' };

function request(hostname, requestPath, method, body, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path: requestPath, method, headers: body ? { ...headers, 'Content-Length': Buffer.byteLength(body) } : headers }, res => {
      let data = ''; res.on('data', chunk => { data += chunk; });
      res.on('end', () => res.statusCode >= 200 && res.statusCode < 300 ? resolve(data) : reject(new Error(`HTTP ${res.statusCode}: ${data}`)));
    });
    req.setTimeout(30000, () => req.destroy(new Error('Notification request timed out')));
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}

async function accessToken(account) {
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const jwt = `${unsigned}.${crypto.sign('RSA-SHA256', Buffer.from(unsigned), account.private_key).toString('base64url')}`;
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }).toString();
  const result = JSON.parse(await request('oauth2.googleapis.com', '/token', 'POST', body, { 'Content-Type': 'application/x-www-form-urlencoded' }));
  if (!result.access_token) throw new Error('Firebase access tokenを取得できませんでした');
  return result.access_token;
}

function localParts(now, timeZone) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}

function body(items) {
  const labels = items.slice(0, 2).map(item => `${item.itemId.toUpperCase()} ${item.titleJP.slice(0, 20)}`);
  return items.length > labels.length ? `${labels.join(' / ')} など${items.length}件の新着SCPがあります` : `${labels.join(' / ')} が追加されました`;
}

async function main({
  queuePath = QUEUE_PATH,
  ledgerPath = path.join(path.dirname(queuePath), 'notification-deliveries.json'),
  secret = process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
  now = new Date(),
  getAccessToken = accessToken,
  sendRequest = request,
  persist = gitPersistence(queuePath, ledgerPath),
} = {}) {
  if (!fs.existsSync(queuePath)) { console.log('通知キュー未生成のため通知をスキップします'); return; }
  const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  const ledger = readLedger(ledgerPath);
  if (reconcile(queue, ledger)) await persist(queue, ledger);
  const blocked = new Set(ledger.deliveries.filter(record =>
    record.status === 'sending' || record.status === 'unknown').map(record => record.lang));
  const failures = [...blocked].map(lang => `${lang}: unresolved delivery; manual recovery required`);
  if (!secret) {
    if (failures.length) throw new Error(failures.join('; '));
    console.log('Firebase Secret未設定のため通知をスキップします'); return;
  }
  const due = [];
  for (const [lang, state] of Object.entries(queue.pending || {})) {
    if (!state.items?.length || !TIMEZONES[lang] || blocked.has(lang)) continue;
    const parts = localParts(now, TIMEZONES[lang]); const window = `${parts.year}-${parts.month}-${parts.day}`;
    if (parts.weekday === 'Sun' && Number(parts.hour) >= 20 && state.lastSentWindow !== window) due.push({ lang, state, window });
  }
  if (due.length) {
    const account = JSON.parse(secret); const token = await getAccessToken(account);
    for (const { lang, state, window } of due) {
      // A manually authorized retry retains its original item snapshot/window.
      let record = ledger.deliveries.find(item => item.lang === lang && item.status === 'retry');
      if (!record) {
        record = { id: `${lang}/${window}`, lang, window,
          items: state.items.map(item => ({ itemId: item.itemId, titleJP: item.titleJP || '' })), attempts: 0 };
        ledger.deliveries.push(record);
      }
      record.status = 'sending'; record.attempts++; record.startedAt = now.toISOString();
      await persist(queue, ledger); // No FCM call until this push succeeds.
      try {
        const payload = JSON.stringify({ message: { topic: `new_scp_${lang}`,
          data: { delivery_id: record.id },
          notification: { title: '新着SCPのお知らせ', body: body(record.items) } } });
        const response = JSON.parse(await sendRequest('fcm.googleapis.com', `/v1/projects/${account.project_id}/messages:send`, 'POST', payload,
          { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }));
        if (typeof response.name !== 'string' || !response.name) throw new Error('FCM response has no message ID');
        record.status = 'sent'; record.messageName = response.name; record.sentAt = new Date().toISOString();
        reconcile(queue, ledger);
        // Also prevent another weekly notification in the retry's current window.
        state.lastSentWindow = window;
        console.log(`[${lang}] FCM accepted ${record.id}: ${response.name}`);
      } catch (error) {
        record.status = 'unknown';
        // Do not store raw service errors (which could contain credentials).
        failures.push(`${record.id}: FCM outcome unknown; manual recovery required`);
      }
      queue.updatedAt = now.toISOString();
      await persist(queue, ledger); // A failed push leaves remote status 'sending'.
    }
  } else {
    console.log('現在送信時刻に該当する言語はありません');
  }
  if (failures.length) throw new Error(failures.join('; '));
}

if (require.main === module) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}

module.exports = { main };
