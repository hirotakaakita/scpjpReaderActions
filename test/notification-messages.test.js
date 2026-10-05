const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LANGUAGES } = require('../languages');
const { buildNotification, MESSAGES } = require('../notification-messages');
const { buildNotificationBody } = require('../send-new-scp-notifications');

const items = [
  { itemId: 'scp-series-002', titleJP: 'First article' },
  { itemId: 'scp-series-jp-003', titleJP: 'Second article' },
  { itemId: 'scp-series-004', titleJP: 'Third article' },
];

const summaries = {
  jp: '新着記事：3件。', en: 'New articles: 3.', ru: 'Новых статей: 3.',
  cn: '新文章：3篇。', cs: 'Nové články: 3.', de: 'Neue Artikel: 3.',
  es: 'Artículos nuevos: 3.', fr: 'Nouveaux articles : 3.', int: 'New articles: 3.',
  it: 'Nuovi articoli: 3.', ko: '새 문서 3개:', pl: 'Nowe artykuły: 3.',
  pt: 'Novos artigos: 3.', th: 'บทความใหม่ 3 บทความ:', ua: 'Нових статей: 3.',
  vn: 'Số bài viết mới: 3.', 'zh-tr': '新增文章：3篇。',
};

test('every supported branch has an explicit notification translation', () => {
  for (const lang of Object.keys(LANGUAGES)) {
    assert.ok(Object.hasOwn(MESSAGES, lang), `Missing notification translation: ${lang}`);
  }
  for (const [lang, summary] of Object.entries(summaries)) {
    const message = buildNotification(lang, items);
    assert.ok(message.title.length > 0);
    assert.equal(message.body, `${summary} SCP-002 First article / SCP-JP-003 Second article / …`);
    if (lang !== 'jp') {
      assert.doesNotMatch(message.title + message.body, /新着|追加されました|など/);
    }
  }
});

test('one and two article notifications show the exact count without an omitted-item marker', () => {
  for (const lang of Object.keys(MESSAGES)) {
    for (const count of [1, 2]) {
      const message = buildNotification(lang, items.slice(0, count));
      assert.match(message.body, new RegExp(String(count)));
      assert.doesNotMatch(message.body, /…/);
      assert.equal(message.body.includes('Second article'), count === 2);
    }
  }
  assert.equal(buildNotification('en', items.slice(0, 1)).body, 'New articles: 1. SCP-002 First article');
});

test('INT uses English, Chinese scripts differ, and unknown branches fall back to English', () => {
  assert.deepEqual(buildNotification('int', items), buildNotification('en', items));
  assert.deepEqual(buildNotification('unknown', items), buildNotification('en', items));
  assert.deepEqual(buildNotification('constructor', items), buildNotification('en', items));
  assert.notEqual(buildNotification('cn', items).body, buildNotification('zh-tr', items).body);
  assert.equal(buildNotification('ko', items).title, '새 SCP 문서');
  assert.equal(buildNotification('en', items).title, 'New SCP articles');
});

test('article titles preserve grapheme clusters, local text and missing titles', () => {
  const emoji = '👩🏽‍🔬';
  const message = buildNotification('en', [{ itemId: 'scp-series-002', titleJP: emoji.repeat(21) }]);
  assert.equal(message.body, `New articles: 1. SCP-002 ${emoji.repeat(20)}…`);
  const accents = 'e\u0301'.repeat(20);
  assert.ok(buildNotification('fr', [{ itemId: 'scp-series-002', titleJP: accents }]).body.endsWith(accents));
  assert.ok(buildNotification('ko', [{ itemId: 'scp-series-002', titleJP: '현지 제목' }]).body.endsWith('현지 제목'));
  assert.equal(buildNotification('en', [{ itemId: 'scp-series-002' }]).body, 'New articles: 1. SCP-002');
});

test('legacy sender uses the same localized formatter', () => {
  for (const lang of Object.keys(MESSAGES)) {
    assert.equal(buildNotificationBody(items, lang), buildNotification(lang, items).body);
  }
  assert.equal(buildNotificationBody(items), buildNotification('jp', items).body);
});
