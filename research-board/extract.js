'use strict';
const crypto = require('node:crypto');
const { JSDOM, VirtualConsole } = require('jsdom');
const { LANGUAGES } = require('../languages');
const { removeHtmlNavigation, removeFtmlNavigation } = require('./chapter-navigation');
const { removeAuxiliaryContent, isAuxiliaryClass } = require('./auxiliary-content');

const { assertions } = require('./semantics');
const EXTRACTOR_VERSION = 13;
const FTML_LINK_VERSION = 14;
const HOSTS = new Map(Object.entries(LANGUAGES).map(([lang, config]) =>
  [new URL(config.baseUrl).hostname, lang]));
HOSTS.set('scpfoundation.net', 'ru');
const ALIASES = new Map([
  ['www.scpfoundation.net', 'scpfoundation.net'],
  ['www.scp-wiki.net', 'scp-wiki.wikidot.com'], ['scp-wiki.net', 'scp-wiki.wikidot.com'],
  ['scpwiki.com', 'scp-wiki.wikidot.com'], ['www.scpwiki.com', 'scp-wiki.wikidot.com'],
]);
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

// Page identity, never SCP number: 001 proposals, EX, J, branch suffixes stay distinct.
function normalizePage(value, base) {
  try {
    const u = new URL(value, base);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port) return null;
    const host = ALIASES.get(u.hostname.toLowerCase()) || u.hostname.toLowerCase();
    if (!HOSTS.has(host)) return null;
    const slug = decodeURIComponent(u.pathname).replace(/^\/+|\/+$/g, '').toLowerCase();
    if (!/^[\p{L}\p{N}][\p{L}\p{N}_:-]*$/u.test(slug)) return null;
    if (/^(?:system|admin|forum|user|component|theme|nav|fragment|css|template):/.test(slug)) return null;
    // Queries can invoke Wikidot operations. Never crawl them as ordinary pages.
    if (u.search && ![...u.searchParams.keys()].every(k => ['utm_source', 'utm_medium', 'utm_campaign'].includes(k))) return null;
    return { id: `page:${host}/${slug}`, url: `https://${host}/${encodeURI(slug)}`, host,
      branch: HOSTS.get(host), slug };
  } catch { return null; }
}

const EXCLUDED = [
  'script', 'style', 'iframe', 'noscript', '#toc', '.toc', '.page-tags',
  '.page-rate-widget-box', '.creditRate', '.credit-rate', '.licensebox', '.license-box',
  '.credit', '.credit-box', '#u-credit-view', '.credit-back', '.authorbox', '#u-author_block', '#u-author-block',
  '[class^="licensebox"]', '[class*=" licensebox"]', '.license-area',
  '.footer-wikiwalk-nav', '.scp-footer', '.wikiwalk-nav', '.page-navigation',
  '[role="navigation"]', '.interwiki-box', '#interwiki', '.collapsible-block-link',
  '.acs-hybrid-text-bar', '.classification-decoration', '.translation-source',
  'nav', '.error-block',
].join(',');

function bodyLinks(root, source) {
  removeAuxiliaryContent(root);
  removeHtmlNavigation(root, source, normalizePage);
  const links = new Map();
  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href').trim();
    if (!href || href.startsWith('#') || a.classList.contains('newpage') ||
        a.matches('[rel~="alternate"], [data-translation-source]')) continue;
    const target = normalizePage(href, source.url);
    if (!target || target.id === source.id || links.has(target.id)) continue;
    links.set(target.id, { target: target.url, quote: a.textContent.trim().replace(/\s+/g, ' ').slice(0, 240),
      location: 'article_body', sourceAnchor: a.id || '', method: 'body_hyperlink_v6' });
  }
  return [...links.values()].sort((a,b) => a.target.localeCompare(b.target, 'en'));
}

function ftmlLinks(text, source) {
  // Parse explicit links only. Includes, code/HTML and link-looking comments are
  // not expanded or crawled; plain SCP identifiers never become connections.
  let body = text.replace(/\[!--[\s\S]*?--\]/g, '')
    .replace(/\[\[(code|html)\b[^\]]*\]\][\s\S]*?\[\[\/\1\]\]/gi, '')
    .replace(/@@[\s\S]*?@@/g,'');
  // Respect explicit credit/navigation containers, including nested divs.
  const tokens=/(?<!\[)\[\[(\/)?(div|span|section)\b([^\]]*)\]\]/gi,stack=[];
  let filtered='',cursor=0;
  for(const m of body.matchAll(tokens)){
    if(!stack.at(-1)?.drop)filtered+=body.slice(cursor,m.index);
    const tag=m[2].toLowerCase();
    if(m[1]){const i=stack.map(x=>x.tag).lastIndexOf(tag);if(i>=0)stack.splice(i);}
    else {
      const classes=/\bclass\s*=\s*["']([^"']*)["']/i.exec(m[3])?.[1]?.toLowerCase().split(/\s+/)||[];
      const drop=isAuxiliaryClass(classes)||classes.some(c=>/^(?:licensebox.*|license-box|credit|credit-box|creditrate|credit-rate|footer-wikiwalk-nav|wikiwalk-nav|scp-footer|page-navigation|interwiki-box|toc)$/.test(c))||/\brole\s*=\s*["']navigation["']/i.test(m[3]);
      stack.push({tag,drop:drop||!!stack.at(-1)?.drop});
    }
    cursor=m.index+m[0].length;
  }
  if(!stack.at(-1)?.drop)filtered+=body.slice(cursor);body=filtered;
  body = removeFtmlNavigation(body, source, normalizePage);
  // Handwritten chapter controls are not wrapped in a navigation class. Only
  // remove a terminal centered block made solely of links and separators.
  for(const m of [...body.matchAll(/\[\[=\]\]([\s\S]*?)\[\[\/=\]\]/g)].reverse()){
    if(body.slice(m.index+m[0].length).trim())continue;
    const links=[...m[1].matchAll(/\[\[\[([^\]|]+)(?:\|([^\]]*))?\]\]\]/g)];
    const controls=links.some(x=>/^(?:назад|далее|previous|next|back)$/iu.test((x[2]||'').trim()));
    const remainder=m[1].replace(/\[\[\[([^\]|]+)(?:\|([^\]]*))?\]\]\]/g,'');
    if(controls&&links.length<=5&&/^[\s*|<>«»←→-]*$/u.test(remainder))body=body.slice(0,m.index);
    break;
  }
  const links = new Map();
  const add = (href, label) => {
    href = href.trim().replace(/^\*/, '');
    if (href.startsWith('#')) return;
    const target = normalizePage(href, source.url);
    if (!target || target.id === source.id || links.has(target.id)) return;
    links.set(target.id, { target: target.url, quote: (label || href).trim().slice(0,240),
      location: 'ftml_source', sourceAnchor: '', method: 'body_hyperlink_v6' });
  };
  for (const m of body.matchAll(/\[\[\[([^\]|]+)(?:\|([^\]]*))?\]\]\]/g)) add(m[1], m[2]);
  for (const m of body.matchAll(/(?<!\[)\[(https?:\/\/[^\s\]]+)(?:\s+([^\]]*))?\](?!\])/g)) add(m[1],m[2]);
  return [...links.values()].sort((a,b)=>a.target.localeCompare(b.target,'en'));
}

function extractHtml(html, url, existingDocument = null) {
  const source = normalizePage(url);
  if (!source) throw new Error('Unsupported source URL');
  const dom = existingDocument ? null : new JSDOM(html, { url: source.url, virtualConsole: new VirtualConsole() });
  try {
    const document = existingDocument || dom.window.document;
    const root = document.querySelector('#page-content')?.cloneNode(true);
    if (!root) {
      throw new Error('Missing article content or soft error');
    }
    if (!require('../article-page').inspectArticlePage(document).usable) throw new Error('Unavailable article');
    const title = (document.querySelector('#page-title')?.textContent || document.title || source.slug).trim();
    if (/^(?:page not found|page does not exist|access denied|security check)/i.test(title)) throw new Error('Soft error page');
    const tags = [...document.querySelectorAll('.page-tags a')].map(a => a.textContent.trim()).filter(Boolean);
    const authors = [...document.querySelectorAll('.licensebox a, .credit a, #u-credit-view a')]
      .filter(a => /wikidot\.com\/user:info\//i.test(a.href))
      .map(a => ({ name: a.textContent.trim(), url: a.href }));
    const translations = [];
    // Only an explicit publisher assertion; a guessed urlEN or matching number is not evidence.
    for (const a of document.querySelectorAll('a[rel~="alternate"][hreflang], link[rel~="alternate"][hreflang], .translation-source a[href], a[data-translation-source]')) {
      const target = normalizePage(a.getAttribute('href'), source.url);
      if (target && target.id !== source.id) translations.push({ target: target.url,
        location: 'explicit_translation_metadata', language: a.getAttribute('hreflang') || null });
    }
    const includes = root.querySelectorAll('iframe').length;
    removeAuxiliaryContent(root);
    for (const node of root.querySelectorAll(EXCLUDED)) node.remove();
    const semanticRelations = assertions(source.url, root.textContent);
    // Only explicit publisher canon breadcrumbs, with a reviewed hub allowlist.
    const breadcrumbLinks=[...document.querySelectorAll('#breadcrumbs a[href]')].map(a=>normalizePage(a.getAttribute('href'),source.url)).filter(Boolean);
    if(source.host==='scp-wiki.wikidot.com' && breadcrumbLinks[0]?.slug==='canon-hub' && breadcrumbLinks[1]?.slug==='resurrection') {
      semanticRelations.push({target:breadcrumbLinks[1].url,type:'canon_member',quote:document.querySelector('#breadcrumbs').textContent.trim().replace(/\s+/g,' '),note:'出版社のカノン階層。本文中に登場する全SCPへカノンを転写しない。',location:'publisher_breadcrumb',sourceAnchor:'breadcrumbs',method:'explicit_canon_breadcrumb'});
    }
    return { ...require('./reviewed-identity-evidence').captureEvidence(document,source.url,digest(html)),
      title, tags: [...new Set(tags)].sort(), authors, links:bodyLinks(root, {...source, title}),
      linkExtractionVersion: EXTRACTOR_VERSION,
      originalSources: require('../origin-provenance').extractOriginalSources(document,source.url),
      ...require('../origin-provenance').extractAuthorCredits(document),
      translations, semanticRelations, limitations: includes ? ['iframe_content_not_expanded'] : [] };
  } finally { dom?.window.close(); }
}

// RuFoundation publishes FTML source through its API. Plain SCP-number text is not a link.
function extractFtml(detail, url) {
  if (!detail || typeof detail.source !== 'string') throw new Error('Invalid RuFoundation article');
  const source = normalizePage(url);
  if (!source || (detail.pageId && (typeof detail.pageId !== 'string' || detail.pageId.toLowerCase() !== source.slug))) throw new Error('RuFoundation page mismatch');
  return { title: detail.title || source.slug, tags: (detail.tags || []).map(t => typeof t === 'string' ? t : t.name).filter(Boolean),
    authors: [detail.author, ...(detail.authors || [])].filter(Boolean).map(a => ({ name: typeof a === 'string' ? a : a.name || a.username || '', url: null })),
    links:ftmlLinks(detail.source, {...source, title:detail.title}), linkExtractionVersion: FTML_LINK_VERSION,
    translations: [], limitations: ['ftml_templates_not_expanded'] };
}

function makeRecord(url, body, format = 'html', now = new Date().toISOString(), response = {}, existingDocument = null) {
  const page = normalizePage(url);
  if (!page) throw new Error('Unsupported source URL');
  const content = format === 'ftml' ? extractFtml(JSON.parse(body), page.url) : extractHtml(body, page.url, existingDocument);
  return { schemaVersion: 1, extractorVersion: format==='ftml'?FTML_LINK_VERSION:EXTRACTOR_VERSION, identityMetadataVersion:1, pageId: page.id, url: page.url,
    fetchedAt: now, checkedAt: now, contentSha256: digest(body), format,
    etag: response.etag || null, lastModified: response.lastModified || null,
    ...content };
}
module.exports = { EXTRACTOR_VERSION, FTML_LINK_VERSION, HOSTS, normalizePage, digest, extractHtml, extractFtml, makeRecord, EXCLUDED, bodyLinks, ftmlLinks, removeAuxiliaryContent };
