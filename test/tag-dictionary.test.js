const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readDictionary, indexDictionary, updateDictionary, localizeTags, restoreTagLabels, pendingTranslations } = require('../tag-dictionary');
const path = require('node:path');

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

test('ID-only tags recover readable names without changing IDs or embedded labels', () => {
  const dictionary=seed(), id='tag-7f558808845f404857963c5b';
  const explicit={id:'another-tag',label:'Author supplied label'};
  const tags=[id,'humanoid',explicit,'new-untranslated-tag',{id},{id,label:id}];
  const before=JSON.stringify(tags), result=restoreTagLabels(tags,'cn',dictionary);
  assert.deepEqual(result[0],{id,label:'人造物品'});
  assert.deepEqual(result[1],{id:'humanoid',label:dictionary.tags.humanoid.labels.zh});
  assert.equal(result[2],explicit);
  assert.deepEqual(result[3],{id:'new-untranslated-tag',label:'new-untranslated-tag'});
  assert.deepEqual(result[4],{id,label:'人造物品'});
  assert.deepEqual(result[5],{id,label:'人造物品'});
  assert.equal(JSON.stringify(tags),before);
  assert.equal(restoreTagLabels([id],'jp',dictionary)[0].label,'人造物品');
  assert.equal(restoreTagLabels([id],'cn',dictionary,undefined,{[id]:'Saved readable label'})[0].label,'Saved readable label');
});
