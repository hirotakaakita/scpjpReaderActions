const { test } = require('node:test');
const assert = require('node:assert/strict');
const { publicTags } = require('../public-tags');

test('drops management tags after trimming whitespace, including NBSP', () => {
  assert.deepEqual(publicTags(['_licensebox', ' _cc ', '\u00a0_hidden', '_', 'scp', '人間型']),
    ['scp', '人間型']);
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
