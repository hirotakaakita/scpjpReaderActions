'use strict';
const {tagNames,scpMetadata}=require('./article-metadata');

// Article type and original branch are independent. A canon's member is not
// necessarily a hub, and a translated work keeps its original branch.
function isPublisherArchive(url, tags) {
  try {
    const page = new URL(url);
    // Translations retain the retired Russian work's -V identity.
    if (/^\/scp-\d+-ru-v(?:-\d+)?\/?$/i.test(decodeURIComponent(page.pathname))) return true;
    if (page.hostname === 'scp-wiki-de.wikidot.com') {
      return tags.has('archiviert') || /^\/scp-(?:[a-z]+-)?\d+(?:-[a-z\d]+)*-t\/?$/i.test(decodeURIComponent(page.pathname));
    }
    if (page.hostname === 'scpfoundation.net') {
      const markers = new Set(['тип:архив', 'тип:-v']);
      // Retained API catalogs may contain only hashed tag IDs. Resolve their
      // source aliases as well as embedded labels before deciding the type.
      const marked = [...tags].some(tag => markers.has(tag) ||
        (/^tag-[a-f0-9]{24}$/.test(tag) &&
          (require('./tag-dictionary.json').tags[tag]?.aliases || [])
            .some(alias => markers.has(alias.normalize('NFC').toLowerCase()))));
      return marked || /^\/[^/]+-v(?:-\d+)?\/?$/i.test(decodeURIComponent(page.pathname));
    }
    // The Spanish VO category preserves original versions of rewritten works,
    // including Tales, supplements and Joke SCPs, not just numbered articles.
    if (page.hostname === 'lafundacionscp.wikidot.com') {
      return tags.has('vo') || /^\/[^/]+-vo\/?$/i.test(decodeURIComponent(page.pathname));
    }
    // -T is a retired translation on the French publisher. These markers are
    // publisher-specific, not branch codes or universal suffixes on other Wikis.
    return page.hostname === 'fondationscp.wikidot.com' &&
      /^\/scp-(?:[a-z]+-)?\d+(?:-[a-z\d]+)*-t\/?$/i.test(decodeURIComponent(page.pathname));
  } catch { return false; }
}
function articleCategory(record, evidence = [], url = record.url || '') {
  const tags = new Set(tagNames(record.tags));
  const has = values => values.some(t => tags.has(t));
  if (has(['archived','archive','archived-page','archivé','アーカイブ済み']) ||
      /(?:-arc(?:$|[?#])|\/archived:)/i.test(url) || isPublisherArchive(url, tags)) return 'archive';
  if (has(['hub','ハブ','中心','结构','структура:хаб','허브','centrum','concentrador','centre','portalseite','hub-vn'])) return 'hub';
  if (has(['goi-format','goiフォーマット','goi格式','формат-goi','format-goi','format-goi-fr','goi-格式','goi서식','структура:свор_формат'])) return 'goi';
  if (has(['experiment-log','exploration-log','interview','incident-report','supplement','suplemento','структура:дополнение','実験','実験記録','探査','探査記録','インタビュー','補足','実験ログ'])) return 'record';
  // Official 001 proposals can be narrated as stories (e.g. the Factory).
  if (tags.has('тип:001')) return 'other';
  if (has(['tale','tales','conte','relato','racconto','opowiadanie','рассказ','이야기','故事','структура:рассказ','geschichte','truyện'])) return 'tale';
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
// Correct delivery metadata and replace document placeholders for identified SCPs.
function scpArticleCategory(record, url = record.url || '', slug = '') {
  const category = articleCategory(record, [], url);
  // SCP-001 entry pages are intentionally hubs inside their numbered series.
  const identifier = slug || decodeURIComponent(new URL(url).pathname).split(':').at(-1).replace(/^\//, '');
  return category === 'hub' && /^scp-(?:[a-z]+-)?001(?:-[a-z]+)?$/i.test(identifier) ? 'other' : category;
}
function reclassifyScpArticle(row, reservedIds) {
  const { branchForPageType } = require('./article-origin');
  const known = new Set(['en', 'zh', 'sk', 'nd', ...Object.keys(require('./languages').LANGUAGES), ...Object.keys(require('./additional-origins.json'))]);
  const validOrigin = value => known.has(value) ? value : null;
  const url = row.urlJP || row.urlEN || row.url;
  if (!url || !branchForPageType(row.pageType)) return row;
  const existingBranch = branchForPageType(row.pageType);
  const category = scpArticleCategory(row, url);
  const joke = category === 'other' && !['archive','tale','goi','record','setting','hub'].includes(row.contentType) && !row.pageType.startsWith('joke-scps')
    ? require('./russian-joke-identity').russianJokeIdentity(url, row.tags || [], existingBranch) : null;
  if (joke) return { ...row, itemId:joke.itemId, numericItemId:joke.numericItemId,
    pageType:joke.pageType, extractedFrom:joke.pageType, contentType:'scp' };
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
  const metadata=scpMetadata(row,url,'',branch);
  if(metadata && (metadata.pageType!==row.pageType || metadata.canonicalAlias || metadata.decimalAlias)){
    const preserveSeriesId=row.pageType.startsWith('scp-series')&&metadata.pageType.startsWith('scp-series')&&!metadata.canonicalAlias&&!metadata.decimalAlias;
    return {...row,itemId:preserveSeriesId?row.itemId:metadata.itemId,numericItemId:metadata.numericItemId,
      pageType:metadata.pageType,extractedFrom:metadata.pageType,contentType:'scp',
      ...(row.originBranch?{originBranch:metadata.originBranch}:{})};
  }
  if (branch !== existingBranch && row.pageType.startsWith('scp-series')) {
    const pageType = branch === 'en' ? 'scp-series' : 'scp-series-' + branch;
    row = { ...row, pageType, extractedFrom: pageType };
  }
  if (row.contentType === 'scp' && row.itemId.startsWith('document-')) {
    const scp = require('./merge-catalog-indexes').scpIdentity({ slug, url }, row, branch, new Map());
    // Distinct published URLs can share a printed SCP number.
    if (scp?.pageType === row.pageType && !(reservedIds instanceof Set && reservedIds.has(scp.itemId))) {
      return { ...row, itemId:scp.itemId, numericItemId:scp.numericItemId };
    }
  }
  return row;
}
module.exports = { articleCategory, scpArticleCategory, reclassifyScpArticle };
