'use strict';
const crypto = require('node:crypto');
const { JSDOM, VirtualConsole } = require('jsdom');
const { LANGUAGES } = require('../languages');

const { assertions } = require('./semantics');
const EXTRACTOR_VERSION = 4;
const HOSTS = new Map(Object.entries(LANGUAGES).map(([lang, config]) =>
  [new URL(config.baseUrl).hostname, lang]));
HOSTS.set('scpfoundation.net', 'ru');
const ALIASES = new Map([
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
  '.acs-hybrid-text-bar', '.classification-decoration',
].join(',');

function extractHtml(html, url) {
  const source = normalizePage(url);
  if (!source) throw new Error('Unsupported source URL');
  const dom = new JSDOM(html, { url: source.url, virtualConsole: new VirtualConsole() });
  try {
    const document = dom.window.document;
    const root = document.querySelector('#page-content');
    if (!root || document.querySelector('#page-content .error-block, #page-content .page-not-found')) {
      throw new Error('Missing article content or soft error');
    }
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
    for (const node of root.querySelectorAll(EXCLUDED)) node.remove();
    const semanticRelations = assertions(source.url, root.textContent);
    // Only explicit publisher canon breadcrumbs, with a reviewed hub allowlist.
    const breadcrumbLinks=[...document.querySelectorAll('#breadcrumbs a[href]')].map(a=>normalizePage(a.getAttribute('href'),source.url)).filter(Boolean);
    if(source.host==='scp-wiki.wikidot.com' && breadcrumbLinks[0]?.slug==='canon-hub' && breadcrumbLinks[1]?.slug==='resurrection') {
      semanticRelations.push({target:breadcrumbLinks[1].url,type:'canon_member',quote:document.querySelector('#breadcrumbs').textContent.trim().replace(/\s+/g,' '),note:'出版社のカノン階層。本文中に登場する全SCPへカノンを転写しない。',location:'publisher_breadcrumb',sourceAnchor:'breadcrumbs',method:'explicit_canon_breadcrumb'});
    }
    const headings = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,strong,b')].filter(n => /^H[1-6]$/.test(n.tagName) || (/^(STRONG|B)$/.test(n.tagName) && n.textContent.length < 100 && /[:：]$/.test(n.textContent.trim())) || (/^(?:Addendum\b|補遺|付録|附录|附錄)/i.test(n.textContent.trim()) && n.textContent.length < 180));
    const links = new Map();
    for (const a of root.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || a.classList.contains('newpage')) continue;
      const target = normalizePage(href, source.url);
      if (!target || target.id === source.id) continue;
      const location = a.closest('.footnotes-footer') ? 'footnote' : 'article_body';
      const anchor = a.id || a.closest('[id]')?.id;
      const evidence = { target: target.url, location,
        sourceAnchor: anchor && /^[\w:-]{1,100}$/.test(anchor) ? anchor : null };
      const heading = headings.filter(h => !!(h.compareDocumentPosition(a) & 4)).at(-1);
      if (heading && /^(?:Addendum\b|補遺|付録|附录|附錄)/i.test(heading.textContent.trim()) && location === 'article_body') evidence.section = {kind:'addendum', title:heading.textContent.trim()};
      links.set(`${target.id}:${location}:${evidence.sourceAnchor || ''}:${evidence.section?.title || ''}`, evidence);
    }
    return { title, tags: [...new Set(tags)].sort(), authors, links: [...links.values()],
      translations, semanticRelations, limitations: includes ? ['iframe_content_not_expanded'] : [] };
  } finally { dom.window.close(); }
}

// RuFoundation publishes FTML source through its API. Plain SCP-number text is not a link.
function extractFtml(detail, url) {
  if (!detail || typeof detail.source !== 'string' || !detail.pageId) throw new Error('Invalid RuFoundation article');
  const source = normalizePage(url);
  if (!source || detail.pageId.toLowerCase() !== source.slug) throw new Error('RuFoundation page mismatch');
  const text = detail.source.replace(/\[\[(?:code|html)[^\]]*\]\][\s\S]*?\[\[\/(?:code|html)\]\]/gi, '')
    .replace(/\[!--[\s\S]*?--\]/g, '')
    .replace(/^.*<<[^\n]*\|[^\n]*>>.*$/gm, '');
  const links = new Map();
  for (const match of text.matchAll(/\[\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\]|\[(https?:\/\/[^\s\]]+)(?:\s[^\]]*)?\]/g)) {
    let href = (match[1] || match[2]).trim();
    if (!/^(?:https?:|\/)/i.test(href)) href = `/${href}`;
    const target = normalizePage(href, source.url);
    if (target && target.id !== source.id) links.set(target.id, { target: target.url,
      location: 'ftml_link', sourceAnchor: null });
  }
  return { title: detail.title || source.slug, tags: (detail.tags || []).map(t => typeof t === 'string' ? t : t.name).filter(Boolean),
    authors: [detail.author, ...(detail.authors || [])].filter(Boolean).map(a => ({ name: typeof a === 'string' ? a : a.name || a.username || '', url: null })),
    links: [...links.values()], translations: [], limitations: ['ftml_templates_not_expanded'] };
}

function makeRecord(url, body, format = 'html', now = new Date().toISOString(), response = {}) {
  const page = normalizePage(url);
  if (!page) throw new Error('Unsupported source URL');
  const content = format === 'ftml' ? extractFtml(JSON.parse(body), page.url) : extractHtml(body, page.url);
  return { schemaVersion: 1, extractorVersion: EXTRACTOR_VERSION, pageId: page.id, url: page.url,
    fetchedAt: now, checkedAt: now, contentSha256: digest(body), format,
    etag: response.etag || null, lastModified: response.lastModified || null,
    ...content };
}
module.exports = { EXTRACTOR_VERSION, HOSTS, normalizePage, digest, extractHtml, extractFtml, makeRecord, EXCLUDED };
