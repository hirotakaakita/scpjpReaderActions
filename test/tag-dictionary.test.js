const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readDictionary, indexDictionary, updateDictionary, localizeTags, pendingTranslations } = require('../tag-dictionary');
const path = require('node:path');
const crypto = require('node:crypto');

function seed() { return readDictionary(path.join(__dirname, '../tag-dictionary.json')); }

test('localized labels keep the same ID and merge aliases', () => {
  const dictionary = seed();
  assert.deepEqual(localizeTags(['humanoid', '人間型', '_cc', 'en', 'scp'], 'jp', dictionary),
    [{ id: 'humanoid', label: '人間型' }]);
  assert.deepEqual(localizeTags(['人型'], 'en', dictionary),
    [{ id: 'humanoid', label: dictionary.tags.humanoid.labels.en }]);
  assert.equal(localizeTags(['humanoid'], 'zh-tr', dictionary)[0].label,
    dictionary.tags.humanoid.labels['zh-Hant']);
});

test('unknown tags get stable IDs and a missing translation report', () => {
  const a = updateDictionary(seed(), ['new-tag-for-test', '未知テストタグ', 'jp', '_hidden']);
  const b = updateDictionary(seed(), ['未知テストタグ', 'new-tag-for-test']);
  assert.deepEqual(localizeTags(['未知テストタグ'], 'jp', a), localizeTags(['未知テストタグ'], 'jp', b));
  assert.ok(pendingTranslations(a).some(entry => entry.id === 'new-tag-for-test'));
  assert.equal(a.tags.jp, undefined);
  const objectTags = localizeTags(['未知テストタグ', 'humanoid'], 'jp', a);
  updateDictionary(a, objectTags);
  assert.deepEqual(localizeTags(objectTags, 'jp', a), objectTags);
});

test('invalid dictionaries and unknown unprepared tags fail visibly', () => {
  const dictionary = seed();
  dictionary.tags.duplicate = { aliases: ['人間型'], labels: {} };
  assert.throws(() => indexDictionary(dictionary), /Ambiguous/);
  assert.throws(() => localizeTags(['unprepared-tag-test'], 'jp', seed()), /Prepare/);
});

test('saved translations are never overwritten by discovery', () => {
  const dictionary = seed();
  const before = JSON.stringify(dictionary.tags.humanoid);
  updateDictionary(dictionary, ['humanoid', '人間型']);
  assert.equal(JSON.stringify(dictionary.tags.humanoid), before);
});

test('original text recovers a retained hash-only placeholder without changing translations', () => {
  const value = '未知テストタグ';
  const id = `tag-${crypto.createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
  const dictionary = { version: 1, tags: { [id]: { aliases: [id], labels: { ja: '保存済みの翻訳' } } } };
  updateDictionary(dictionary, [id, value]);
  assert.deepEqual(dictionary.tags[id].aliases, [value, id]);
  assert.deepEqual(dictionary.tags[id].labels, { ja: '保存済みの翻訳' });
  assert.deepEqual(localizeTags([id, value], 'jp', dictionary), [{ id, label: '保存済みの翻訳' }]);
  const once = JSON.stringify(dictionary);
  updateDictionary(dictionary, [value, id]);
  assert.equal(JSON.stringify(dictionary), once);
});

test('an occupied hash with a different real alias still blocks publication', () => {
  const value = '未知テストタグ';
  const id = `tag-${crypto.createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
  const dictionary = { version: 1, tags: { [id]: { aliases: ['different-tag'], labels: {} } } };
  assert.throws(() => updateDictionary(dictionary, [value]), /Tag ID collision/);
});
