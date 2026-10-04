const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepare } = require('../prepare-tag-dictionary');
const { LANGUAGES } = require('../languages');
const { mergeLanguage, addTranslatedLanguages, applyTagDictionary } = require('../merge-data');

test('prepare then merge embeds labels and preserves cached object tags and failed languages', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-tag-catalog-'));
  try {
    fs.copyFileSync(path.join(__dirname, '../tag-dictionary.json'), path.join(root, 'tag-dictionary.json'));
    const partial = path.join(root, 'partial-data');
    const output = path.join(root, 'local-data');
    fs.mkdirSync(partial);
    fs.mkdirSync(path.join(output, 'en'), { recursive: true });
    fs.writeFileSync(path.join(output, 'en', 'scp-data.json'), JSON.stringify({data: [{
      itemId: 'scp-0', isTranslatedJP: true,
      tags: [{id: 'humanoid', label: 'Previous label'}, '_cc', 'scp', 'en'],
    }]}));
    for (const [i, page] of LANGUAGES.jp.pages.entries()) {
      fs.writeFileSync(path.join(partial, `jp--${page.path}.json`), JSON.stringify({
        timestamp: '2026-10-04T00:00:00Z', data: [{ itemId: `scp-${i}`,
          tags: ['人間型', 'humanoid', 'unknown-integration-tag', '_hidden', 'jp'], isTranslatedJP: true }],
      }));
    }
    const dictionary = prepare(root);
    assert.equal(mergeLanguage('jp', partial, output), true);
    addTranslatedLanguages(output, ['jp']);
    applyTagDictionary(output, dictionary);
    const jpFile = path.join(output, 'jp', 'scp-data.json');
    const jp = JSON.parse(fs.readFileSync(jpFile));
    assert.equal(jp.tagSchemaVersion, 2);
    assert.deepEqual(jp.data[0].tags, [
      {id: 'humanoid', label: '人間型'},
      {id: 'unknown-integration-tag', label: 'unknown-integration-tag'},
    ]);
    assert.equal(fs.readFileSync(jpFile, 'utf8'), fs.readFileSync(path.join(output, 'scp-data.json'), 'utf8'));
    const en = JSON.parse(fs.readFileSync(path.join(output, 'en', 'scp-data.json')));
    assert.equal(en.data[0].tags.length, 1);
    assert.equal(en.data[0].tags[0].label, dictionary.tags.humanoid.labels.en);
    assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'jp', 'meta.json'))).lastUpdated, jp.timestamp);
    // The next crawl can reuse object tags without losing IDs or labels.
    const again = prepare(root);
    addTranslatedLanguages(output, ['jp']);
    applyTagDictionary(output, again);
    assert.deepEqual(JSON.parse(fs.readFileSync(jpFile)).data, jp.data);
  } finally {
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('scp-tag-catalog-')) {
      throw new Error('Unexpected test directory');
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
