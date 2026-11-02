const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { LANGUAGES } = require('./languages');

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

function generateMobileCatalogs(input, output = path.join(input, 'mobile-v1')) {
  const reports = [];
  for (const language of Object.keys(LANGUAGES)) {
    const file = path.join(input, language, 'scp-data.json');
    if (!fs.existsSync(file)) continue;
    const sourceBytes = fs.readFileSync(file);
    const source = JSON.parse(sourceBytes.toString('utf8'));
    const meta = JSON.parse(fs.readFileSync(path.join(input, language, 'meta.json'), 'utf8'));
    if (meta.lastUpdated !== source.timestamp || meta.totalCount !== source.totalCount) {
      throw new Error(`Source/meta mismatch: ${language}`);
    }
    const json = Buffer.from(JSON.stringify(mobileCatalog(source, language)), 'utf8');
    const compressed = zlib.gzipSync(json, { level: 9 });
    if (source.totalCount > 200000 || json.length > 128 * 1024 * 1024 || compressed.length > 32 * 1024 * 1024) {
      throw new Error(`Mobile client limits exceeded: ${language}`);
    }
    const sha256 = crypto.createHash('sha256').update(compressed).digest('hex');
    const fileName = `catalog-${sha256}.json.gz`;
    const directory = path.join(output, language);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, fileName), compressed);
    const manifest = {
      schemaVersion: 1, language, timestamp: source.timestamp, totalCount: source.totalCount,
      fileName, bytes: compressed.length, decodedBytes: json.length, sha256,
    };
    // Publish the pointer last. Hash filenames prevent mixed CDN cache revisions.
    const pending = path.join(directory, 'manifest.json.tmp');
    fs.writeFileSync(pending, JSON.stringify(manifest) + '\n', 'utf8');
    fs.renameSync(pending, path.join(directory, 'manifest.json'));
    for (const name of fs.readdirSync(directory)) {
      if (/^catalog-[a-f0-9]{64}\.json\.gz$/.test(name) && name !== fileName) {
        fs.unlinkSync(path.join(directory, name));
      }
    }
    reports.push({ language, sourceBytes: sourceBytes.length, jsonBytes: json.length, gzipBytes: compressed.length });
  }
  if (!reports.length) throw new Error('No source catalogs found');
  return reports;
}

if (require.main === module) {
  const input = path.resolve(process.argv[2] || path.join(__dirname, 'local-data'));
  const output = process.argv[3] && path.resolve(process.argv[3]);
  console.log(JSON.stringify(generateMobileCatalogs(input, output), null, 2));
}
module.exports = { mobileCatalog, generateMobileCatalogs };
