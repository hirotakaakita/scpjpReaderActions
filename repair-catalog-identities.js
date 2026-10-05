const fs = require('node:fs');
const path = require('node:path');
const { deduplicateArticles, validateCatalogs } = require('./catalog-identity');
const { LocalSCPCrawler, stringifyAsciiSafe } = require('./local-crawler');
const { readDictionary, indexDictionary, localizeTags } = require('./tag-dictionary');

// One-time repair of the published CN collision and repeated IT listings.
// Fetch both CN articles again: old ID-based caches also mixed their images.
async function repair(baseDir, fetchDetails, now = new Date().toISOString()) {
  const writes = [];
  const changed = [];
  for (const lang of ['cn', 'it']) {
    const file = path.join(baseDir, lang, 'scp-data.json');
    const metaFile = path.join(baseDir, lang, 'meta.json');
    const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
    const before = JSON.stringify(catalog.data);
    const conflicting = lang === 'cn' && catalog.data.some(item =>
      item.itemId === 'scp-series-1380' && new URL(item.urlJP || item.urlEN).pathname === '/scp-1380-ru');
    if (conflicting) {
      const affected = catalog.data.filter(item => item.itemId === 'scp-series-1380');
      if (affected.length !== 2 || !affected.some(item => new URL(item.urlJP || item.urlEN).pathname === '/scp-1380')) {
        throw new Error('Unexpected CN collision; manual inspection required');
      }
      for (const item of affected) {
        const details = await fetchDetails(item.urlJP || item.urlEN);
        if (!details.fetchSucceeded) throw new Error(`Could not refresh ${item.urlJP || item.urlEN}`);
        if (new URL(item.urlJP || item.urlEN).pathname === '/scp-1380-ru') {
          item.itemId = 'scp-series-1380-ru';
          if (item.translatedLanguages) item.translatedLanguages = ['cn'];
        }
        for (const field of ['imageUrl', 'objectClass', 'rating', 'descriptionExcerpt', 'tags', 'tagVersion']) {
          item[field] = details[field];
        }
        if (catalog.tagSchemaVersion === 2) {
          const dictionary = readDictionary(path.join(baseDir, '..', 'tag-dictionary.json'));
          item.tags = localizeTags(item.tags, lang, dictionary, indexDictionary(dictionary));
        }
        item.tagFetchStatus = 'success';
        item.lastUpdated = now;
        // Preserve createdAt: correcting identity does not make this a new article.
      }
    }
    catalog.data = deduplicateArticles(catalog.data, lang);
    if (JSON.stringify(catalog.data) === before) continue;
    catalog.totalCount = catalog.data.length;
    catalog.timestamp = now;
    catalog.statistics = {
      ...catalog.statistics,
      translated: catalog.data.filter(item => item.isTranslatedJP).length,
      untranslated: catalog.data.filter(item => !item.isTranslatedJP).length,
      withImage: catalog.data.filter(item => item.imageUrl).length,
    };
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    Object.assign(meta, { lastUpdated: now, totalCount: catalog.totalCount, statistics: catalog.statistics });
    writes.push([file, catalog], [metaFile, meta]);
    changed.push(lang);
  }
  // Never publish a half-repaired file if either article fetch fails.
  for (const [file, value] of writes) fs.writeFileSync(file, stringifyAsciiSafe(value), 'utf8');
  validateCatalogs(baseDir);
  return changed;
}

if (require.main === module) {
  const crawler = new LocalSCPCrawler('cn');
  repair(path.join(__dirname, 'local-data'), url => crawler.extractScpDetailsFromPage(url))
    .then(changed => console.log(`Repaired catalogs: ${changed.join(', ') || 'none'}`))
    .catch(error => { console.error(error); process.exitCode = 1; });
}

module.exports = { repair };
