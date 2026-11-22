const { test } = require('node:test');
const assert = require('node:assert/strict');
const { publicTags } = require('../public-tags');
const { publicTagEntries } = require('../public-tags');

test('public tag entries retain labels while filtering and deduplicating mixed cached tags', () => {
  const label = { id: ' humanoid ', label: '人間型' };
  assert.deepEqual(publicTagEntries([
    'humanoid', label, 'humanoid', { id: '_cc', label: 'Hidden' },
    { id: 'jp', label: 'Branch' }, 'unknown', null,
  ]), [{ id: 'humanoid', label: '人間型' }, 'unknown']);
  assert.equal(label.id, ' humanoid ');
  assert.deepEqual(publicTagEntries(null), []);
});

test('drops management tags after trimming whitespace, including NBSP', () => {
  assert.deepEqual(publicTags(['_licensebox', ' _cc ', '\u00a0_hidden', '_', 'scp', '人間型']),
    ['人間型']);
});

test('preserves internal underscores and source order without duplicates', () => {
  const input = ['mind_affecting', ' 人間型 ', 'humanoid', '人間型', 'mind-affecting'];
  assert.deepEqual(publicTags(input), ['mind_affecting', '人間型', 'humanoid', 'mind-affecting']);
  assert.equal(input[1], ' 人間型 ');
});

test('empty and malformed tag values do not enter generated JSON', () => {
  for (const value of [null, undefined, '_cc', {}]) assert.deepEqual(publicTags(value), []);
  assert.deepEqual(publicTags(['', ' ', null, 4, {}, false]), []);
});

test('drops configured branch tags, language aliases, and the generic SCP tag', () => {
  const { LANGUAGES } = require('../languages');
  assert.deepEqual(publicTags([
    ...Object.keys(LANGUAGES),
    'ru', 'ja', 'zh', 'zh-cn', 'zh-tw', 'uk', 'vi',
    'scp', ' SCP ', ' EN ', ' JP ',
    'safe', 'euclid', 'humanoid', 'mind-affecting',
  ]), ['safe', 'euclid', 'humanoid', 'mind-affecting']);
});

test('matches whole tags without excluding short content tags or SCP-related names', () => {
  assert.deepEqual(publicTags(['toy', 'sun', 'en-tag', 'scp-173', 'scp-jp']),
    ['toy', 'sun', 'en-tag', 'scp-173', 'scp-jp']);
});
