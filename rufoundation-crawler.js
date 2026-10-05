const fs = require('fs');
const path = require('path');
const axios = require('axios');

const API_BASE_URL = 'https://scpfoundation.net';
const EN_BASE_URL = 'https://scp-wiki.wikidot.com';
const TAG_VERSION = 4;
const API_USER_AGENT = 'SCPReaderCrawler/1.0 (+https://github.com/hirotakaakita/scpjpReaderActions)';

const CLASS_NAMES = new Map([
  ['safe', 'Safe'], ['\u0431\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u044b\u0439', 'Safe'], ['\u0431\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u0430\u044f', 'Safe'],
  ['euclid', 'Euclid'], ['\u0435\u0432\u043a\u043b\u0438\u0434', 'Euclid'],
  ['keter', 'Keter'], ['\u043a\u0435\u0442\u0435\u0440', 'Keter'],
  ['thaumiel', 'Thaumiel'], ['\u0442\u0430\u0443\u043c\u0438\u044d\u043b\u044c', 'Thaumiel'], ['\u0442\u0430\u0443\u043c\u0438\u044d\u043b', 'Thaumiel'],
  ['apollyon', 'Apollyon'], ['\u0430\u043f\u043e\u043b\u043b\u0438\u043e\u043d', 'Apollyon'],
  ['archon', 'Archon'], ['\u0430\u0440\u0445\u043e\u043d\u0442', 'Archon'],
  ['neutralized', 'Neutralized'], ['\u043d\u0435\u0439\u0442\u0440\u0430\u043b\u0438\u0437\u043e\u0432\u0430\u043d\u043d\u044b\u0439', 'Neutralized'], ['\u043d\u0435\u0439\u0442\u0440\u0430\u043b\u0438\u0437\u043e\u0432\u0430\u043d', 'Neutralized'],
  ['decommissioned', 'Decommissioned'], ['\u0440\u0430\u0441\u0444\u043e\u0440\u043c\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u044b\u0439', 'Decommissioned'],
  ['explained', 'Explained'], ['\u043e\u0431\u044a\u044f\u0441\u043d\u0451\u043d\u043d\u044b\u0439', 'Explained'], ['\u043e\u0431\u044a\u044f\u0441\u043d\u0435\u043d\u043d\u044b\u0439', 'Explained'],
  ['uncontained', 'Uncontained'], ['\u043d\u0435 \u0441\u043e\u0434\u0435\u0440\u0436\u0438\u0442\u0441\u044f', 'Uncontained'],
  ['pending', 'Pending'], ['\u043e\u0436\u0438\u0434\u0430\u0435\u0442', 'Pending'],
]);

function envFlag(name) { return process.env[name] === '1'; }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function stripStruck(value) {
  return String(value || '')
    .replace(/~~[\s\S]*?~~/g, ' ')
    .replace(/<del\b[^>]*>[\s\S]*?<\/del>/gi, ' ')
    .replace(/<s\b[^>]*>[\s\S]*?<\/s>/gi, ' ')
    .replace(/<strike\b[^>]*>[\s\S]*?<\/strike>/gi, ' ');
}

function cleanWikiText(value) {
  return stripStruck(value)
    .replace(/\[\[(?:\/|>|<|div\b|span\b|table\b|row\b|col\b|collapsible\b)[^\]]*\]\]/gi, ' ')
    .replace(/\[\[image\s+[^\]]+\]\]/gi, ' ')
    .replace(/\[\[include\s+[^\]]+\]\]/gi, ' ')
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\*\*|__|\/\/|''/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .trim();
}

function chooseClass(value) {
  const normalized = cleanWikiText(value).replace(/[|].*$/, '').trim();
  const matches = [];
  for (const [name, canonical] of CLASS_NAMES) {
    const index = normalized.toLocaleLowerCase('ru').lastIndexOf(name);
    if (index >= 0) matches.push({ index, canonical });
  }
  if (!matches.length) return null;
  matches.sort((a, b) => a.index - b.index);
  return matches[matches.length - 1].canonical;
}

function extractObjectClass(source) {
  const text = stripStruck(source);
  const labeled = [...text.matchAll(/(?:\*\*)?\s*(?:\u043a\u043b\u0430\u0441\u0441\s+\u043e\u0431\u044a\u0435\u043a\u0442\u0430|object\s*class)\s*(?:\*\*)?\s*[:?-]?\s*([^\n]+)/giu)];
  for (let i = labeled.length - 1; i >= 0; i--) {
    const result = chooseClass(labeled[i][1]);
    if (result) return result;
  }
  const acs = [...text.matchAll(/(?:container-class|containment-class|scp-class)\s*=\s*([^|\]\n]+)/gi)];
  for (let i = acs.length - 1; i >= 0; i--) {
    const result = chooseClass(acs[i][1]);
    if (result) return result;
  }
  return null;
}

function extractDescription(source) {
  const text = stripStruck(source);
  const match = text.match(/(?:^|\n)\s*(?:\*\*)?\u043e\u043f\u0438\u0441\u0430\u043d\u0438\u0435\s*:?\s*(?:\*\*)?\s*([\s\S]*)/iu)
    || text.match(/(?:^|\n)\s*(?:\*\*)?description\s*:?\s*(?:\*\*)?\s*([\s\S]*)/iu);
  if (match) {
    const value = cleanWikiText(match[1])
      .split(/\n\s*(?:\*\*)[^\n:]{1,80}:\s*(?:\*\*)?/u)[0]
      .trim();
    if (value) return Array.from(value).slice(0, 500).join('');
  }
  // ACS/structured articles may omit an explicit Description label. Use the first
  // meaningful prose paragraph after removing the FTML header in that case.
  const paragraphs = cleanWikiText(text).split(/\n{2,}/)
    .map(value => value.trim())
    .filter(value => value.length >= 40 && !/^[-=]{3,}$/.test(value));
  const fallback = paragraphs.find(value => !/^(?:scp-number|scp-class|linefirst|linesecond|linethird)\s*=/i.test(value));
  return fallback ? Array.from(fallback).slice(0, 500).join('') : null;
}

function extractImageUrl(source) {
  const match = String(source || '').match(/\[\[image\s+([^\]|\s]+)[^\]]*\]\]/i)
    || String(source || '').match(/(?:^|[|\n])\s*name\s*=\s*([^|\]\n]+?)(?:\s*[|\n])/i);
  if (!match) return null;
  const value = match[1].trim();
  if (/^https?:\/\//i.test(value)) return value;
  return `${API_BASE_URL}/local--files/${value.replace(/^\/+/, '')}`;
}

function branchFromTags(tags, pageId) {
  const branches = (tags || []).map(String).map(tag => {
    const match = tag.match(/^\u0444\u0438\u043b\u0438\u0430\u043b:([a-z-]+)$/iu);
    return match ? match[1].toLowerCase() : null;
  }).filter(Boolean);
  const unique = [...new Set(branches)];
  if (!unique.length && /-ru(?:$|-)/i.test(pageId)) return ['ru'];
  return unique.length ? unique : ['en'];
}

function numericId(pageId) {
  const match = String(pageId).match(/^scp-(\d+)/i);
  return match ? Number(match[1]) : null;
}
function isScpArticle(article) {
  return /^scp-\d+/i.test(article.pageId || '') && /^scp-\d+/i.test(article.title || '');
}
function localUrl(pageId) { return `${API_BASE_URL}/${encodeURIComponent(pageId).replace(/%2F/gi, '/')}`; }
function englishUrl(pageId) { return `${EN_BASE_URL}/${encodeURIComponent(pageId).replace(/%2F/gi, '/')}`; }

async function getJson(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(url, {
        timeout: 120000,
        headers: { Accept: 'application/json', 'User-Agent': API_USER_AGENT },
      });
      return response.data;
    } catch (error) {
      if (attempt === retries) throw error;
      await sleep(Math.min(15000, 2000 * attempt));
    }
  }
}

function readCatalog(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return { data: [] }; }
}

function fallbackItem(item) {
  return {
    ...item,
    urlJP: null,
    urlRU: null,
    isTranslatedJP: false,
    isTranslatedRU: false,
    sourceLanguage: item.sourceLanguage || 'en',
    sourceBranch: item.sourceBranch || 'en',
    isTranslatedFromOtherLanguage: false,
  };
}

async function crawlRussianApi() {
  const startedAt = new Date();
  const outputDir = path.join(__dirname, 'partial-data');
  fs.mkdirSync(outputDir, { recursive: true });
  const existing = readCatalog(path.join(__dirname, 'local-data', 'ru', 'scp-data.json'));
  const existingMap = new Map((existing.data || []).map(item => [item.itemId, item]));
  const english = readCatalog(path.join(__dirname, 'local-data', 'en', 'scp-data.json'));

  const allArticles = await getJson(`${API_BASE_URL}/api/articles`);
  if (!Array.isArray(allArticles) || allArticles.length === 0) throw new Error('RuFoundation API returned no articles');
  const allScpArticles = allArticles.filter(isScpArticle);
  const apiLimit = Number(process.env.RU_API_LIMIT || 0);
  const articles = apiLimit > 0 ? allScpArticles.slice(0, apiLimit) : allScpArticles;
  const result = [];
  const forceDetails = envFlag('FORCE_REFRESH_SCP_DETAILS');
  const forceObjectClass = envFlag('FORCE_REFRESH_OBJECT_CLASS');
  const forceDescription = envFlag('FORCE_REFRESH_DESCRIPTION');
  const forceTags = envFlag('FORCE_REFRESH_TAGS');

  const processArticle = async article => {
    const pageId = String(article.pageId).toLowerCase();
    const old = existingMap.get(pageId);
    const branches = branchFromTags(article.tags, pageId);
    const sourceBranch = branches.includes('ru') ? 'ru' : branches[0];
    const sourceChanged = Boolean(article.updatedAt && article.updatedAt != old?.sourceUpdatedAt);
    const needsDetails = !old || sourceChanged || forceDetails || forceObjectClass || forceDescription || !old.objectClass || !old.descriptionExcerpt;
    let detail = null;
    if (needsDetails) {
      await sleep(Number(process.env.RU_API_REQUEST_INTERVAL_MS || 150));
      detail = await getJson(`${API_BASE_URL}/api/articles/${encodeURIComponent(pageId)}`);
    }
    const source = detail?.source || old?.source || '';
    const objectClass = needsDetails ? (extractObjectClass(source) || old?.objectClass || null) : old.objectClass;
    const descriptionExcerpt = needsDetails ? (extractDescription(source) || old?.descriptionExcerpt || null) : old.descriptionExcerpt;
    const tags = Array.isArray(article.tags)
      ? article.tags.filter(tag => !/^\u0444\u0438\u043b\u0438\u0430\u043b:/iu.test(String(tag)))
      : (old?.tags || []);
    return {
      itemId: pageId,
      numericItemId: numericId(pageId),
      titleJP: article.title || old?.titleJP || pageId,
      urlEN: branches.includes('en') ? englishUrl(pageId) : (old?.urlEN || ''),
      urlJP: localUrl(pageId),
      urlRU: localUrl(pageId),
      imageUrl: needsDetails ? (extractImageUrl(source) || old?.imageUrl || null) : (old?.imageUrl || null),
      objectClass,
      rating: article.rating?.value ?? old?.rating ?? null,
      descriptionExcerpt,
      tags,
      tagVersion: forceTags || !old?.tagVersion ? TAG_VERSION : Math.max(old.tagVersion, TAG_VERSION),
      isTranslatedJP: true,
      isTranslatedRU: true,
      sourceLanguage: sourceBranch,
      sourceBranch,
      sourceBranches: branches,
      isTranslatedFromOtherLanguage: sourceBranch !== 'ru',
      sourceUpdatedAt: article.updatedAt || null,
    };
  };
  const concurrency = Math.max(1, Number(process.env.RU_API_DETAIL_CONCURRENCY || 3));
  const cursor = { value: 0 };
  const workers = Array.from({ length: Math.min(concurrency, articles.length) }, async () => {
    while (true) {
      const index = cursor.value++;
      if (index >= articles.length) return;
      result[index] = await processArticle(articles[index]);
      if ((index + 1) % 25 === 0) console.log(`[ru] detail ${index + 1}/${articles.length}`);
    }
  });
  await Promise.all(workers);
  const translatedIds = new Set(result.map(item => item.itemId));
  for (const item of english.data || []) {
    if (!item.itemId || !/^scp-\d+/i.test(item.itemId) || translatedIds.has(item.itemId)) continue;
    result.push(fallbackItem(item));
  }
  result.sort((a, b) => String(a.itemId).localeCompare(String(b.itemId), 'en', { numeric: true }));

  const duration = Math.round((Date.now() - startedAt.getTime()) / 1000);
  const partial = {
    lang: 'ru', page: 'api', url: `${API_BASE_URL}/api/articles`,
    timestamp: startedAt.toISOString(), duration, totalCount: result.length, data: result,
  };
  fs.writeFileSync(path.join(outputDir, 'ru--api.json'), JSON.stringify(partial, null, 2), 'utf8');
  console.log(`[ru] API articles=${allArticles.length}, SCP=${articles.length}${apiLimit > 0 ? ` (limit ${apiLimit})` : ''}, output=${result.length}`);
}

module.exports = { crawlRussianApi, extractObjectClass, extractDescription, extractImageUrl, branchFromTags };

if (require.main === module) crawlRussianApi().catch(error => { console.error(error); process.exitCode = 1; });
