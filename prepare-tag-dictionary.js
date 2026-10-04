const fs = require('node:fs');
const path = require('node:path');
const { LANGUAGES } = require('./languages');
const { readDictionary, updateDictionary, pendingTranslations, saveDictionary } = require('./tag-dictionary');

function prepare(root = __dirname) {
  const file = path.join(root, 'tag-dictionary.json');
  const dictionary = readDictionary(file);
  const tags = new Set();
  const collect = file => {
    if (!fs.existsSync(file)) return;
    const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const item of catalog.data || []) {
      for (const tag of item.tags || []) tags.add(typeof tag === 'string' ? tag : tag?.id);
    }
  };
  // Include retained catalogs when a language crawl fails.
  for (const lang of Object.keys(LANGUAGES)) collect(path.join(root, 'local-data', lang, 'scp-data.json'));
  const partial = path.join(root, 'partial-data');
  if (fs.existsSync(partial)) {
    for (const file of fs.readdirSync(partial).filter(f => f.endsWith('.json')).sort()) {
      collect(path.join(partial, file));
    }
  }
  updateDictionary(dictionary, [...tags]);
  saveDictionary(file, dictionary);
  const pending = pendingTranslations(dictionary);
  fs.writeFileSync(path.join(root, 'tag-translations-pending.json'), JSON.stringify(pending, null, 2) + '\n');
  console.log(`Tag dictionary: ${Object.keys(dictionary.tags).length} tags; ${pending.length} need translation`);
  return dictionary;
}
if (require.main === module) prepare();
module.exports = { prepare };
