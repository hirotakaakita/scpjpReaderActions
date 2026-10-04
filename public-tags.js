// Keep page content tags, never Wikidot's underscore-prefixed management tags.
function publicTags(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .filter(value => typeof value === 'string')
    .map(value => value.replace(/\u00a0/g, ' ').trim())
    .filter(value => value && !value.startsWith('_')))];
}

module.exports = { publicTags };
