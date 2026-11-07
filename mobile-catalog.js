const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { LANGUAGES } = require('./languages');
const { readDictionary, updateDictionary, localizeTags, indexDictionary } = require('./tag-dictionary');
const { normalize } = require('./related-documents');

// This is a delivery format, never a replacement for the crawler's source data.
const FIELDS = new Set([
  'itemId', 'numericItemId', 'titleJP', 'objectClass', 'rating',
  'descriptionExcerpt', 'urlEN', 'urlJP', 'imageUrl', 'isTranslatedJP',
  'extractedFrom', 'pageType', 'contentType', 'lastUpdated', 'createdAt',
  'mangaLanguages', 'translatedLanguages', 'tags', 'tagLabels',
]);
const REQUIRED_STRINGS = ['itemId', 'titleJP', 'extractedFrom', 'pageType', 'contentType', 'lastUpdated'];

function mobileCatalog(source, language) {
  if (source.language !== language || !Array.isArray(source.data) ||
      !source.data.length || source.totalCount !== source.data.length ||
      !Number.isFinite(Date.parse(source.timestamp))) {
    throw new Error(`Invalid source catalog: ${language}`);
  }
  const ids = new Set();
  const data = source.data.map(article => {
    if (REQUIRED_STRINGS.some(key => typeof article[key] !== 'string') ||
        !article.itemId || ids.has(article.itemId) ||
        typeof article.isTranslatedJP !== 'boolean' ||
        !Number.isFinite(Date.parse(article.lastUpdated))) {
      throw new Error(`Invalid or duplicate article: ${article.itemId}`);
    }
    ids.add(article.itemId);
    return Object.fromEntries(Object.entries(article).filter(([key, value]) =>
      FIELDS.has(key) && value !== null
    ));
  });
  return { schemaVersion: 1, language, timestamp: source.timestamp, totalCount: data.length, data };
}

function generateCatalogChannel(input, output, includeAdditional) {
  const reports = [];
  const additionalFile = path.join(input, 'related-documents', 'catalog.json');
  const additional = !includeAdditional ? null : fs.existsSync(additionalFile) ? JSON.parse(fs.readFileSync(additionalFile)) :
    fs.existsSync(`${additionalFile}.gz`) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(`${additionalFile}.gz`))) : null;
  if (additional && (additional.schemaVersion !== 1 || !Array.isArray(additional.data) || additional.totalCount !== additional.data.length || !Number.isFinite(Date.parse(additional.timestamp)))) throw Error('Invalid additional document catalog');
  const dictionaryFile = path.join(input, '..', 'tag-dictionary.json');
  const dictionary = fs.existsSync(dictionaryFile) ? readDictionary(dictionaryFile) : { version: 1, tags: {} };
  if (additional) updateDictionary(dictionary, additional.data.flatMap(r => r.tags || []));
  const tagIndex = indexDictionary(dictionary);
  const translations = new Map();
  function addTranslation(id, language) {
    if (!translations.has(id)) translations.set(id, new Set());
    translations.get(id).add(language);
  }
  if (includeAdditional) {
    for (const language of Object.keys(LANGUAGES)) {
      const file = path.join(input, language, 'scp-data.json');
      if (!fs.existsSync(file)) continue;
      for (const row of JSON.parse(fs.readFileSync(file)).data) {
        if (row.isTranslatedJP !== false) addTranslation(row.itemId, language);
        for (const code of row.translatedLanguages || []) addTranslation(row.itemId, code);
      }
    }
    for (const row of additional?.data || []) addTranslation(row.itemId, row.language);
  }
  for (const language of Object.keys(LANGUAGES)) {
    const file = path.join(input, language, 'scp-data.json');
    if (!fs.existsSync(file)) continue;
    const sourceBytes = fs.readFileSync(file);
    const source = JSON.parse(sourceBytes.toString('utf8'));
    const meta = JSON.parse(fs.readFileSync(path.join(input, language, 'meta.json'), 'utf8'));
    if (meta.lastUpdated !== source.timestamp || meta.totalCount !== source.totalCount) {
      throw new Error(`Source/meta mismatch: ${language}`);
    }
    const delivery = mobileCatalog(source, language);
    const ids = new Set(delivery.data.map(r => r.itemId));
    const pageUrls = new Set(source.data.map(r => normalize(r.isTranslatedJP !== false && r.urlJP ? r.urlJP : r.urlEN)?.url));
    const documents = (additional?.data || []).filter(r => r.language === language && !pageUrls.has(r.url) && !ids.has(r.itemId)).map(r => ({
      itemId: r.itemId, titleJP: r.title, urlJP: r.url, isTranslatedJP: true,
      extractedFrom: r.pageType, pageType: r.pageType, contentType: r.contentType,
      lastUpdated: r.lastUpdated, descriptionExcerpt: r.descriptionExcerpt,
      ...(r.objectClass ? { objectClass:r.objectClass } : {}),
      ...(r.rating != null ? { rating:r.rating } : {}),
      ...(r.imageUrl ? { imageUrl:r.imageUrl } : {}),
      ...(r.contentType === 'scp' ? { numericItemId: r.numericItemId } : {}),
      tags: localizeTags(r.tags || [], language, dictionary, tagIndex),
    }));
    for (const row of documents) {
      const validId = row.itemId.startsWith('document-') || (row.contentType === 'scp' && /^(?:scp-series|joke-scps|scp-(?:[a-z]+-)?ex)/.test(row.pageType) && /^scp-|^joke-scps-/.test(row.itemId));
      if (!validId || ids.has(row.itemId) || REQUIRED_STRINGS.some(k => typeof row[k] !== 'string') || !row.titleJP || !Number.isFinite(Date.parse(row.lastUpdated)) || !normalize(row.urlJP)) throw Error(`Invalid additional article: ${row.itemId}`);
      ids.add(row.itemId);
    }
    delivery.data.push(...documents);
    if (includeAdditional) for (const row of delivery.data) {
      row.translatedLanguages = [...new Set([
        ...(row.translatedLanguages || []), ...(translations.get(row.itemId) || []),
      ])].sort();
    }
    delivery.totalCount = delivery.data.length;
    if (additional && Date.parse(additional.timestamp) > Date.parse(delivery.timestamp)) delivery.timestamp = additional.timestamp;
    const json = Buffer.from(JSON.stringify(delivery), 'utf8');
    const compressed = zlib.gzipSync(json, { level: 9 });
    if (delivery.totalCount > 200000 || json.length > 128 * 1024 * 1024 || compressed.length > 32 * 1024 * 1024) {
      throw new Error(`Mobile client limits exceeded: ${language}`);
    }
    const sha256 = crypto.createHash('sha256').update(compressed).digest('hex');
    const fileName = `catalog-${sha256}.json.gz`;
    const directory = path.join(output, language);
    fs.mkdirSync(directory, { recursive: true });
    const pointer = path.join(directory, 'manifest.json');
    const previousFile = fs.existsSync(pointer) ? JSON.parse(fs.readFileSync(pointer)).fileName : null;
    fs.writeFileSync(path.join(directory, fileName), compressed);
    const manifest = {
      schemaVersion: 1, language, timestamp: delivery.timestamp, totalCount: delivery.totalCount,
      fileName, bytes: compressed.length, decodedBytes: json.length, sha256,
    };
    // Publish the pointer last. Hash filenames prevent mixed CDN cache revisions.
    const pending = path.join(directory, 'manifest.json.tmp');
    fs.writeFileSync(pending, JSON.stringify(manifest) + '\n', 'utf8');
    fs.renameSync(pending, path.join(directory, 'manifest.json'));
    for (const name of fs.readdirSync(directory)) {
      if (previousFile !== fileName && /^catalog-[a-f0-9]{64}\.json\.gz$/.test(name) && name !== fileName && name !== previousFile) {
        fs.unlinkSync(path.join(directory, name));
      }
    }
    reports.push({ language, additionalCount: documents.length, totalCount: delivery.totalCount, sourceBytes: sourceBytes.length, jsonBytes: json.length, gzipBytes: compressed.length });
  }
  if (!reports.length) throw new Error('No source catalogs found');
  return reports;
}

function generateMobileCatalogs(input, output = path.join(input, 'mobile-v1')) {
  // Keep the released app's endpoint and metadata contract unchanged.
  const legacy = generateCatalogChannel(input, output, false);
  const extended = generateCatalogChannel(input, path.join(path.dirname(output), 'mobile-v2'), true);
  return [
    ...legacy.map(report => ({ channel: 'mobile-v1', ...report })),
    ...extended.map(report => ({ channel: 'mobile-v2', ...report })),
  ];
}

if (require.main === module) {
  const input = path.resolve(process.argv[2] || path.join(__dirname, 'local-data'));
  const output = process.argv[3] && path.resolve(process.argv[3]);
  const catalogs = generateMobileCatalogs(input, output);
  console.log(JSON.stringify(catalogs, null, 2));
}
module.exports = { mobileCatalog, generateMobileCatalogs };
