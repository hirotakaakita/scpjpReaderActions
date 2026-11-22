const { LANGUAGES } = require('./languages');

// Branch tags and their language-code aliases describe origin, not content.
const excludedTags = new Set([
  'scp',
  ...Object.keys(LANGUAGES),
  'ru', 'ja', 'zh', 'zh-cn', 'zh-tw', 'uk', 'vi',
]);

// Keep content tags; omit management, language, and generic SCP tags.
function publicTags(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .map(value => typeof value === 'string' ? value : value?.id)
    .filter(value => typeof value === 'string')
    .map(value => value.replace(/\u00a0/g, ' ').trim())
    .filter(value => value && !value.startsWith('_') &&
      !excludedTags.has(value.toLowerCase())))];
}

// Translation-flag refreshes run after localization as well as before it.
// Filter public tags without discarding labels already embedded in schema v2.
function publicTagEntries(values) {
  const entries = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const [id] = publicTags([value]);
    if (!id) continue;
    if (value && typeof value === 'object' && typeof value.label === 'string' && value.label.trim()) {
      entries.set(id, { id, label: value.label });
    } else if (!entries.has(id)) entries.set(id, id);
  }
  return [...entries.values()];
}

module.exports = { publicTags, publicTagEntries };
