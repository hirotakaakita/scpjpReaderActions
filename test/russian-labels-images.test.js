const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { extractImageUrl } = require('../rufoundation-crawler');
const { localizeTags, readDictionary, pendingTranslations } = require('../tag-dictionary');
const { prepare } = require('../prepare-tag-dictionary');

test('Russian attachment paths include their page, cross-page and absolute images survive', () => {
  assert.equal(extractImageUrl('[[image photo.jpg]]', 'scp-002'),
    'https://scpfoundation.net/local--files/scp-002/photo.jpg');
  assert.equal(extractImageUrl('[[image scp-003/photo.jpg]]', 'scp-002'),
    'https://scpfoundation.net/local--files/scp-003/photo.jpg');
  assert.equal(extractImageUrl('[[image https://example.com/photo.jpg]]', 'scp-002'),
    'https://example.com/photo.jpg');
  assert.equal(extractImageUrl('[[image /local--files/scp-003/photo.jpg]]', 'scp-002'),
    'https://scpfoundation.net/local--files/scp-003/photo.jpg');
});

test('Russian tag labels are embedded in catalogs and missing translations remain trackable', () => {
  const dictionary = readDictionary(path.join(__dirname, '../tag-dictionary.json'));
  const tags = localizeTags(['humanoid', 'mind-affecting'], 'ru', dictionary);
  assert.equal(tags.length, 2);
  assert.ok(tags.every(tag => /[а-яА-ЯёЁ]/.test(tag.label)));
  assert.ok(pendingTranslations(dictionary).some(entry => entry.missing.includes('ru')));
});

test('dictionary preparation preserves native labels from retained and fresh Russian tags', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-ru-tags-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('scp-ru-tags-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(root, 'tag-dictionary.json'), JSON.stringify({ version: 1, tags: {} }));
  fs.mkdirSync(path.join(root, 'local-data', 'ru'), { recursive: true });
  const tags = [{ id: 'tag-original-stable-id', label: 'свойство:существо' }, 'аномалия:превращение'];
  fs.writeFileSync(path.join(root, 'local-data', 'ru', 'scp-data.json'), JSON.stringify({ data: [{ tags }] }));
  const dictionary = prepare(root);
  const localized = localizeTags(tags, 'ru', dictionary);
  assert.equal(localized[0].id, 'tag-original-stable-id');
  assert.equal(localized[0].label, 'свойство:существо');
  assert.equal(localized[1].label, 'аномалия:превращение');
  assert.equal(localizeTags(['свойство:существо'], 'ru', dictionary)[0].id, localized[0].id);
  assert.deepEqual(prepare(root), dictionary);
});
