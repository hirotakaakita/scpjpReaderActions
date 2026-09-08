const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');
const crypto = require('crypto');
const { LANGUAGES } = require('./languages');

const LOCAL_DATA_DIR = path.join(__dirname, 'local-data');

/**
 * 新着SCPの週次PUSH通知(FCM)送信スクリプト。
 *
 * scp-crawler.yml の merge-and-deploy ジョブで、apply-manga-flags.js の後
 * (= local-data/ が今回のクロール結果に上書きされた後)かつ git commit の前
 * に実行する。git HEAD(=前回コミット時点のデータ)と現在のファイルの
 * itemId集合を比較し、新規追加された記事がある言語だけに通知を送る。
 *
 * 通知先はデバイストークンではなく言語別のFCMトピック(new_scp_<lang>、
 * langはlanguages.jsのキー = アプリのContentLanguage.codeと一致)。
 * アプリ側は選択中の閲覧言語のトピックだけを購読している。
 *
 * 環境変数 FIREBASE_SERVICE_ACCOUNT_JSON (Firebaseサービスアカウントの
 * 秘密鍵JSONそのもの)が未設定の場合は、通知を送らずに正常終了する
 * (ローカル実行やSecret未設定時にジョブ全体を失敗させないため)。
 */

/** git HEAD時点のファイル内容を取得する(HEADに存在しない場合はnull) */
function readFromHead(relPath) {
  try {
    return execSync(`git show HEAD:${relPath}`, {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      // scp-data.jsonは記事数が多い言語だと数MBになるため、
      // デフォルトのmaxBuffer(1MB)では切り詰められて解析に失敗する
      maxBuffer: 1024 * 1024 * 100,
    });
  } catch (e) {
    return null; // 新規言語などHEADにまだ存在しない場合
  }
}

/** itemId -> 記事データ のMapを作る(通知本文に代表記事名を出すため) */
function extractItemsMap(jsonText) {
  if (!jsonText) return new Map();
  try {
    const parsed = JSON.parse(jsonText);
    return new Map((parsed.data || []).map((item) => [item.itemId, item]));
  } catch (e) {
    return new Map();
  }
}

// アプリ側 PageTypeUtils.formatDisplayId と同じ変換ルール(itemId -> 表示ID)。
// 通知本文に「SCP-173」のような見慣れた表記で代表記事を出すために複製している。
const DISPLAY_ID_PATTERNS = [
  [/^scp-([a-z][a-z-]*)-ex-(\d+(?:-.+)?)$/, (m) => `SCP-EX-${m[1].toUpperCase()}-${m[2].toUpperCase()}`],
  [/^scp-ex-(\d+(?:-.+)?)$/, (m) => `SCP-EX-${m[1].toUpperCase()}`],
  [/^joke-scps-([a-z][a-z-]*)-(\d+(?:-.+)?)$/, (m) => `JOKE-SCP-${m[1].toUpperCase()}-${m[2].toUpperCase()}`],
  [/^joke-scps-(\d+(?:-.+)?)$/, (m) => `JOKE-SCP-${m[1].toUpperCase()}`],
  [/^scp-series-([a-z][a-z-]*)-(\d+(?:-.+)?)$/, (m) => `SCP-${m[1].toUpperCase()}-${m[2].toUpperCase()}`],
  [/^scp-series-(\d+(?:-.+)?)$/, (m) => `SCP-${m[1].toUpperCase()}`],
];

function formatDisplayId(itemId) {
  for (const [pattern, formatter] of DISPLAY_ID_PATTERNS) {
    const match = itemId.match(pattern);
    if (match) return formatter(match);
  }
  return itemId.toUpperCase();
}

function truncate(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}

/** 新着記事のうち代表的な数件を挙げた通知本文を組み立てる */
function buildNotificationBody(newItems) {
  const REPRESENTATIVE_COUNT = 2;
  const representatives = newItems.slice(0, REPRESENTATIVE_COUNT);
  const labels = representatives.map(
    (item) => `${formatDisplayId(item.itemId)}「${truncate(item.titleJP, 20)}」`,
  );
  const listText = labels.join('、');
  const remaining = newItems.length - representatives.length;

  return remaining > 0
    ? `${listText}など、今週${newItems.length}件の新着記事が追加されました`
    : `${listText}が追加されました`;
}

function httpsRequest(hostname, requestPath, method, body, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path: requestPath,
        method,
        headers: body
          ? { ...headers, 'Content-Length': Buffer.byteLength(body) }
          : headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/** サービスアカウントの秘密鍵からFCM送信用のOAuth2アクセストークンを取得する */
async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const base64url = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${base64url(header)}.${base64url(claim)}`;
  const signature = crypto
    .sign('RSA-SHA256', Buffer.from(unsigned), serviceAccount.private_key)
    .toString('base64url');
  const jwt = `${unsigned}.${signature}`;

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  }).toString();

  const res = await httpsRequest('oauth2.googleapis.com', '/token', 'POST', body, {
    'Content-Type': 'application/x-www-form-urlencoded',
  });
  const json = JSON.parse(res);
  if (!json.access_token) {
    throw new Error(`アクセストークンを取得できませんでした: ${res}`);
  }
  return json.access_token;
}

async function sendTopicNotification(accessToken, projectId, topic, title, body) {
  const payload = JSON.stringify({
    message: {
      topic,
      notification: { title, body },
    },
  });
  return httpsRequest(
    'fcm.googleapis.com',
    `/v1/projects/${projectId}/messages:send`,
    'POST',
    payload,
    {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  );
}

async function main() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    console.log(
      'FIREBASE_SERVICE_ACCOUNT_JSON が未設定のため、通知送信をスキップします。',
    );
    return;
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountJson);
  } catch (e) {
    console.error('FIREBASE_SERVICE_ACCOUNT_JSON のJSON解析に失敗しました。通知送信をスキップします。');
    return;
  }
  const projectId = serviceAccount.project_id;

  const langsToNotify = [];
  for (const lang of Object.keys(LANGUAGES)) {
    const dataPath = path.join(LOCAL_DATA_DIR, lang, 'scp-data.json');
    if (!fs.existsSync(dataPath)) continue;

    const relPath = `local-data/${lang}/scp-data.json`;
    const previousMap = extractItemsMap(readFromHead(relPath));
    const currentMap = extractItemsMap(fs.readFileSync(dataPath, 'utf8'));
    const newItems = [...currentMap.values()].filter(
      (item) => !previousMap.has(item.itemId),
    );

    if (newItems.length > 0) {
      langsToNotify.push({ lang, newItems });
    }
  }

  if (langsToNotify.length === 0) {
    console.log('新着記事がある言語はありませんでした。通知は送信しません。');
    return;
  }

  console.log(
    `通知対象: ${langsToNotify.map((l) => `${l.lang}(${l.newItems.length}件)`).join(', ')}`,
  );

  let accessToken;
  try {
    accessToken = await getAccessToken(serviceAccount);
  } catch (e) {
    console.error(`アクセストークン取得に失敗したため通知送信を中止します: ${e.message}`);
    return;
  }

  for (const { lang, newItems } of langsToNotify) {
    const topic = `new_scp_${lang}`;
    const body = buildNotificationBody(newItems);
    try {
      await sendTopicNotification(
        accessToken,
        projectId,
        topic,
        '新着SCPのお知らせ',
        body,
      );
      console.log(`[${lang}] 通知送信完了 (トピック: ${topic}, ${newItems.length}件): ${body}`);
    } catch (e) {
      console.error(`[${lang}] 通知送信失敗: ${e.message}`);
    }
  }
}

if (require.main === module) {
  main().catch((e) => {
    // 通知送信の失敗でジョブ全体(データのcommit/push)を失敗扱いにはしない
    console.error('通知送信処理で予期しないエラーが発生しました:', e);
  });
}

module.exports = { extractItemsMap, formatDisplayId, buildNotificationBody };
