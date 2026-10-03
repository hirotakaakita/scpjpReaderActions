const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const QUEUE_PATH = path.join(__dirname, 'local-data', 'notification-queue.json');
const TIMEZONES = { jp: 'Asia/Tokyo', en: 'America/New_York', cn: 'Asia/Shanghai', cs: 'Europe/Prague', de: 'Europe/Berlin', es: 'Europe/Madrid', fr: 'Europe/Paris', int: 'UTC', it: 'Europe/Rome', ko: 'Asia/Seoul', pl: 'Europe/Warsaw', pt: 'America/Sao_Paulo', th: 'Asia/Bangkok', ua: 'Europe/Kyiv', vn: 'Asia/Ho_Chi_Minh', 'zh-tr': 'Asia/Taipei' };

function request(hostname, requestPath, method, body, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path: requestPath, method, headers: body ? { ...headers, 'Content-Length': Buffer.byteLength(body) } : headers }, res => {
      let data = ''; res.on('data', chunk => { data += chunk; });
      res.on('end', () => res.statusCode >= 200 && res.statusCode < 300 ? resolve(data) : reject(new Error(`HTTP ${res.statusCode}: ${data}`)));
    });
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

async function main() {
  if (!fs.existsSync(QUEUE_PATH)) return;
  const secret = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!secret) { console.log('Firebase Secret未設定のため通知をスキップします'); return; }
  const queue = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'));
  const now = new Date(); const due = [];
  for (const [lang, state] of Object.entries(queue.pending || {})) {
    if (!state.items?.length || !TIMEZONES[lang]) continue;
    const parts = localParts(now, TIMEZONES[lang]); const window = `${parts.year}-${parts.month}-${parts.day}`;
    if (parts.weekday === 'Sun' && Number(parts.hour) >= 20 && state.lastSentWindow !== window) due.push({ lang, state, window });
  }
  if (!due.length) { console.log('現在送信時刻に該当する言語はありません'); return; }
  const account = JSON.parse(secret); const token = await accessToken(account);
  for (const { lang, state, window } of due) {
    const payload = JSON.stringify({ message: { topic: `new_scp_${lang}`, notification: { title: '新着SCPのお知らせ', body: body(state.items) } } });
    await request('fcm.googleapis.com', `/v1/projects/${account.project_id}/messages:send`, 'POST', payload, { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });
    state.items = []; state.lastSentWindow = window; console.log(`[${lang}] 通知送信完了`);
  }
  queue.updatedAt = now.toISOString(); fs.writeFileSync(QUEUE_PATH, `${JSON.stringify(queue, null, 2)}\n`, 'utf8');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
