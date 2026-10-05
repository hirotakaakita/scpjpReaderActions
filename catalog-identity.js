const fs = require('node:fs');
const path = require('node:path');

function articleUrl(item) {
  const value = item.urlJP || item.urlEN;
  if (!value) return null;
  const url = new URL(value);
  // HTTP/HTTPS and anchor links identify the same Wikidot article.
  return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, '')}${url.search}`;
}

function deduplicateArticles(items, context = 'catalog') {
  const byId = new Map();
  for (const item of items) {
    if (typeof item.itemId !== 'string' || !item.itemId) {
      throw new Error(`${context}: missing itemId`);
    }
    const previous = byId.get(item.itemId);
    if (!previous) {
      byId.set(item.itemId, item);
      continue;
    }
    const previousUrl = articleUrl(previous);
    const currentUrl = articleUrl(item);
    if (!previousUrl || previousUrl !== currentUrl) {
      throw new Error(`${context}: conflicting itemId ${item.itemId}: ${previousUrl} / ${currentUrl}`);
    }
    // Same article listed on several pages: keep the most recent crawl result.
    if ((item.lastUpdated || '') > (previous.lastUpdated || '')) byId.set(item.itemId, item);
  }
  return [...byId.values()];
}

function validateCatalogs(baseDir) {
  let count = 0;
  const files = fs.readdirSync(baseDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(baseDir, entry.name, 'scp-data.json'));
  files.push(path.join(baseDir, 'scp-data.json'));
  for (const file of files.filter(file => fs.existsSync(file))) {
    const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(catalog.data) || !catalog.data.length) throw new Error(`${file}: empty catalog`);
    const unique = deduplicateArticles(catalog.data, file);
    if (unique.length !== catalog.data.length) throw new Error(`${file}: duplicate itemId remains`);
    if (catalog.totalCount !== catalog.data.length) throw new Error(`${file}: totalCount mismatch`);
    count++;
  }
  if (!count) throw new Error('No catalogs to validate');
  return count;
}

if (require.main === module) {
  console.log(`Validated ${validateCatalogs(path.join(__dirname, 'local-data'))} catalogs`);
}

module.exports = { articleUrl, deduplicateArticles, validateCatalogs };
