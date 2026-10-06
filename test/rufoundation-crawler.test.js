const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractObjectClass,
  extractDescription,
  branchFromTags,
  normalizeRating,
} = require('../rufoundation-crawler');

test('RuFoundation object class uses the current non-struck value', () => {
  const source = '**\u041a\u043b\u0430\u0441\u0441 \u043e\u0431\u044a\u0435\u043a\u0442\u0430:** ~~\u0415\u0432\u043a\u043b\u0438\u0434~~ \u041a\u0435\u0442\u0435\u0440';
  assert.equal(extractObjectClass(source), 'Keter');
});

test('RuFoundation star ratings become integer vote-like scores', () => {
  assert.equal(normalizeRating({ mode: 'stars', value: 3.9, votes: 13, popularity: 85 }), 9);
  assert.equal(normalizeRating({ mode: 'stars', value: 1.4, votes: 18, popularity: 28 }), -8);
});

test('RuFoundation description excerpt is Unicode-limited to 500 characters', () => {
  const source = '**\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435:** ' + '\u044f'.repeat(700) + '\\n\\n**\u041f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435:** ignored';
  const excerpt = extractDescription(source);
  assert.equal(Array.from(excerpt).length, 500);
});

test('RuFoundation branch tags identify original and translated branches', () => {
  assert.deepEqual(branchFromTags(['\u0444\u0438\u043b\u0438\u0430\u043b:en'], 'scp-5538'), ['en']);
  assert.deepEqual(branchFromTags(['\u0444\u0438\u043b\u0438\u0430\u043b:en', '\u0444\u0438\u043b\u0438\u0430\u043b:ru'], 'scp-1001-ru'), ['en', 'ru']);
});
