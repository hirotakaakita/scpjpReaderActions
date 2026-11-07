const fs = require('node:fs');
const crypto = require('node:crypto');
const { publicTags } = require('./public-tags');

const locales = ['ru', 'en', 'ja', 'zh', 'cs', 'de', 'es', 'fr', 'it', 'ko', 'pl', 'pt', 'th', 'uk', 'vi', 'zh-Hant'];
const branchLocales = { jp: 'ja', cn: 'zh', ua: 'uk', vn: 'vi', 'zh-tr': 'zh-Hant', int: 'en' };
function readDictionary(file) {
  const dictionary = JSON.parse(fs.readFileSync(file, 'utf8'));
  indexDictionary(dictionary);
  return dictionary;
}
function indexDictionary(dictionary) {
  if (dictionary.version !== 1 || !dictionary.tags || Array.isArray(dictionary.tags)) {
    throw new Error('Invalid tag dictionary schema');
  }
  const index = new Map();
  for (const [id, entry] of Object.entries(dictionary.tags)) {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(id) || !Array.isArray(entry.aliases) ||
        !entry.labels || typeof entry.labels !== 'object' || Array.isArray(entry.labels)) {
      throw new Error(`Invalid tag entry: ${id}`);
    }
    for (const [locale, label] of Object.entries(entry.labels)) {
      if (!locales.includes(locale) || typeof label !== 'string' || !label.trim()) {
        throw new Error(`Invalid tag label: ${id}/${locale}`);
      }
    }
    for (const alias of [id, ...entry.aliases]) {
      if (typeof alias !== 'string' || !publicTags([alias]).length) {
        throw new Error(`Invalid tag alias: ${id}`);
      }
      const value = alias.trim();
      if (index.has(value) && index.get(value) !== id) {
        throw new Error(`Ambiguous tag alias: ${value}`);
      }
      index.set(value, id);
    }
  }
  return index;
}
function updateDictionary(dictionary, values) {
  const index = indexDictionary(dictionary);
  for (const value of publicTags(values).sort()) {
    if (index.has(value)) continue;
    // Unknown tags keep stable IDs. Do not guess cross-language equivalence.
    let id = /^[a-z][a-z0-9_-]*$/.test(value) ? value :
      `tag-${crypto.createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
    if (dictionary.tags[id]) throw new Error(`Tag ID collision: ${id}`);
    dictionary.tags[id] = { aliases: [value], labels: {} };
    index.set(value, id);
    index.set(id, id);
  }
  return dictionary;
}
function localizeTags(values, branch, dictionary, index = indexDictionary(dictionary)) {
  const locale = branchLocales[branch] || branch;
  const result = new Map();
  for (const value of publicTags(values)) {
    const id = index.get(value);
    if (!id) throw new Error(`Prepare tag dictionary before merging: ${value}`);
    const entry = dictionary.tags[id];
    const label = entry.labels[locale];
    // Missing translations remain explicit in the report; never fabricate one.
    result.set(id, { id, label: label || entry.aliases[0] || id });
  }
  return [...result.values()];
}
function pendingTranslations(dictionary) {
  return Object.entries(dictionary.tags).flatMap(([id, entry]) => {
    const missing = locales.filter(locale => !entry.labels[locale]);
    return missing.length ? [{ id, aliases: entry.aliases, missing }] : [];
  });
}
function saveDictionary(file, dictionary) {
  indexDictionary(dictionary);
  const sorted = { version: 1, tags: Object.fromEntries(
    Object.entries(dictionary.tags).sort(([a], [b]) => a.localeCompare(b, 'en'))) };
  fs.writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n');
}
module.exports = { locales, readDictionary, indexDictionary, updateDictionary,
  localizeTags, pendingTranslations, saveDictionary };
