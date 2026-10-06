const path = require('node:path');
const fs = require('node:fs');
const { crawlRussianApi } = require('./rufoundation-crawler');
const { mergeLanguage } = require('./merge-data');
const { validate } = require('./validate-staging-catalogs');

async function main() {
  const output = path.join(__dirname, 'local-data');
  if (fs.existsSync(path.join(output, 'ru', 'scp-data.json'))) throw new Error('Russian catalog already exists');
  if (Number(process.env.RU_API_LIMIT || 0) !== 0) throw new Error('Bootstrap requires the full article list');
  // The full API index provides real titles, URLs, tags and ratings. Detailed
  // excerpts/images remain pending until the regular crawl; never publish samples.
  await crawlRussianApi({ metadataOnly: true });
  if (!mergeLanguage('ru', path.join(__dirname, 'partial-data'), output)) throw new Error('Russian merge failed');
  validate();
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
