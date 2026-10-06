const fs = require('node:fs');
const path = require('node:path');
const { LANGUAGES } = require('./languages');
const { readDictionary, updateDictionary, pendingTranslations, saveDictionary, indexDictionary } = require('./tag-dictionary');

function prepare(root = __dirname) {
  const file = path.join(root, 'tag-dictionary.json');
  const dictionary = readDictionary(file);
  const tags = new Set();
  const retained = [];
  const collect = (file, branch) => {
    if (!fs.existsSync(file)) return;
    const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const item of catalog.data || []) {
      for (const tag of item.tags || []) {
        tags.add(typeof tag === 'string' ? tag : tag?.id);
        if (tag && typeof tag === 'object') retained.push({ ...tag, branch });
        if (branch === 'ru' && typeof tag === 'string' && /[а-яё]/i.test(tag)) {
          retained.push({ id: tag, label: tag, branch });
        }
      }
    }
  };
  // Include retained catalogs when a language crawl fails.
  for (const lang of Object.keys(LANGUAGES)) collect(path.join(root, 'local-data', lang, 'scp-data.json'), lang);
  const partial = path.join(root, 'partial-data');
  if (fs.existsSync(partial)) {
    for (const file of fs.readdirSync(partial).filter(f => f.endsWith('.json')).sort()) {
      collect(path.join(partial, file), file.split('--')[0]);
    }
  }
  updateDictionary(dictionary, [...tags]);
  const index = indexDictionary(dictionary);
  for (const { id, label, branch } of retained) {
    const entry = dictionary.tags[index.get(id)];
    if (!entry || typeof label !== 'string' || !label.trim()) continue;
    // A retained schema-v2 catalog can precede its dictionary. Recover its
    // original tag text instead of displaying an opaque tag hash after merging.
    if (entry.aliases.length === 1 && entry.aliases[0] === id && !index.has(label)) {
      entry.aliases.unshift(label);
      index.set(label, index.get(id));
    }
    // Native Russian API tags are already Russian; this is not a translation
    // guess for English fallback tags or cross-language semantic equivalence.
    if (branch === 'ru' && /[а-яё]/i.test(label) && !entry.labels.ru) entry.labels.ru = label;
  }
  saveDictionary(file, dictionary);
  const pending = pendingTranslations(dictionary);
  fs.writeFileSync(path.join(root, 'tag-translations-pending.json'), JSON.stringify(pending, null, 2) + '\n');
  console.log(`Tag dictionary: ${Object.keys(dictionary.tags).length} tags; ${pending.length} need translation`);
  return dictionary;
}
if (require.main === module) prepare();
module.exports = { prepare };
