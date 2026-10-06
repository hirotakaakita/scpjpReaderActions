const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { LANGUAGES } = require('./languages');
const { validateCatalogs } = require('./catalog-identity');

function validate(root = __dirname, languages = Object.keys(LANGUAGES)) {
  for (const lang of languages) {
    const dir = path.join(root, 'local-data', lang);
    const catalog = JSON.parse(fs.readFileSync(path.join(dir, 'scp-data.json'), 'utf8'));
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    assert.ok(Array.isArray(catalog.data) && catalog.data.length > 0, `Empty catalog: ${lang}`);
    assert.equal(meta.totalCount, catalog.data.length, `${lang}: meta count`);
    assert.equal(meta.lastUpdated, catalog.timestamp, `${lang}: meta timestamp`);
    for (const item of catalog.data) {
      for (const field of ['itemId', 'titleJP', 'extractedFrom', 'pageType', 'contentType', 'lastUpdated']) {
        assert.equal(typeof item[field], 'string', `${lang}/${item.itemId}: missing ${field}`);
      }
      assert.ok(Number.isFinite(Date.parse(item.lastUpdated)), `${lang}/${item.itemId}: invalid lastUpdated`);
      assert.equal(typeof item.isTranslatedJP, 'boolean', `${lang}/${item.itemId}: missing translation flag`);
    }
  }
  validateCatalogs(path.join(root, 'local-data'));
  const status = JSON.parse(fs.readFileSync(path.join(root, 'app-status.json'), 'utf8'));
  assert.ok(status.androidStoreUrl === '' ||
    status.androidStoreUrl === 'https://play.google.com/store/apps/details?id=com.scp.reader');
  assert.equal(status.maintenance, false);
  console.log(`Validated ${languages.length} language catalogs and app status`);
}

if (require.main === module) validate();
module.exports = { validate };
