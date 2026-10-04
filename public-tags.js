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

module.exports = { publicTags };
