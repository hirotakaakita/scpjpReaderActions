'use strict';

// Article type and original branch are independent. A canon's member is not
// necessarily a hub, and a translated work keeps its original branch.
function isFrenchArchivedTranslation(url) {
  try {
    const page = new URL(url);
    // -T is a retired translation on the French publisher, not a branch code
    // or a universal suffix on other Wikis. Tags remain the primary evidence.
    return page.hostname === 'fondationscp.wikidot.com' &&
      /^\/scp-(?:[a-z]+-)?\d+(?:-[a-z\d]+)*-t\/?$/i.test(decodeURIComponent(page.pathname));
  } catch { return false; }
}
function articleCategory(record, evidence = [], url = record.url || '') {
  const tags = new Set((record.tags || []).flatMap(t => typeof t === 'string' ? [t] : [t.id, t.label].filter(Boolean)).map(v => v.normalize('NFC').toLowerCase()));
  const has = values => values.some(t => tags.has(t));
  if (has(['archived','archive','archived-page','archivé','アーカイブ済み']) ||
      /(?:-arc(?:$|[?#])|\/archived:)/i.test(url) || isFrenchArchivedTranslation(url)) return 'archive';
  if (has(['hub','ハブ','中心','结构','структура:хаб','허브','centrum','concentrador','centre','portalseite','hub-vn'])) return 'hub';
  if (has(['goi-format','goiフォーマット','goi格式','формат-goi','format-goi','format-goi-fr','goi-格式','goi서식','структура:свор_формат'])) return 'goi';
  if (has(['experiment-log','exploration-log','interview','incident-report','supplement','実験','実験記録','探査','探査記録','インタビュー','補足','実験ログ'])) return 'record';
  if (has(['tale','tales','conte','relato','racconto','opowiadanie','рассказ','이야기','故事','структура:рассказ','geschichte'])) return 'tale';
  if (has(['personnel','facility','mobile-task-force','department','人物','施設','機動部隊','部門','要注意団体','goi-hub'])) return 'setting';
  const kinds = new Set(evidence.map(e => e.kind));
  if (evidence.some(e => e.kind === 'canon' && e.source === url)) return 'hub';
  if (/(?:experiment|exploration|incident|test)[-_](?:log|record)|(?:^|\/)interview[-_]/i.test(url)) return 'record';
  if (kinds.has('record')) return 'record';
  if (kinds.has('goi-format')) return 'goi';
  if (kinds.has('tale')) return 'tale';
  if (kinds.has('setting')) return 'setting';
  return 'other';
}
// Correct delivery metadata without replacing IDs used by bookmarks/read state.
function scpArticleCategory(record, url = record.url || '', slug = '') {
  const category = articleCategory(record, [], url);
  // SCP-001 entry pages are intentionally hubs inside their numbered series.
  const identifier = slug || decodeURIComponent(new URL(url).pathname).split(':').at(-1).replace(/^\//, '');
  return category === 'hub' && /^scp-(?:[a-z]+-)?001(?:-[a-z]+)?$/i.test(identifier) ? 'other' : category;
}
function reclassifyScpArticle(row) {
  const { branchForPageType } = require('./article-origin');
  const known = new Set(['en', 'zh', 'sk', 'nd', ...Object.keys(require('./languages').LANGUAGES), ...Object.keys(require('./additional-origins.json'))]);
  const validOrigin = value => known.has(value) ? value : null;
  const url = row.urlJP || row.urlEN || row.url;
  if (!url || !branchForPageType(row.pageType)) return row;
  const existingBranch = branchForPageType(row.pageType);
  const category = scpArticleCategory(row, url);
  if (row.pageType.startsWith('related-document-')) {
    return category === 'archive' ? { ...row, contentType: category } : row;
  }
  const slug = decodeURIComponent(new URL(url).pathname).split(':').at(-1).replace(/^\//, '').toLowerCase();
  const match = /^scp-(?:([a-z]+)-)?\d+(?:-(.*))?$/.exec(slug);
  const suffix = (match?.[2] || '').split('-').find(t => validOrigin(t));
  const branch = validOrigin(match?.[1]) || suffix || existingBranch;
  if (category !== 'other') {
    const pageType = 'related-document-' + branch;
    return { ...row, contentType: category, pageType, extractedFrom: pageType };
  }
  if (branch !== existingBranch && row.pageType.startsWith('scp-series')) {
    const pageType = branch === 'en' ? 'scp-series' : 'scp-series-' + branch;
    return { ...row, pageType, extractedFrom: pageType };
  }
  return row;
}
module.exports = { articleCategory, scpArticleCategory, reclassifyScpArticle };
