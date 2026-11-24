'use strict';
// Independently examines live publisher content. NEVER import extract.js / catalog.js.
const {JSDOM, VirtualConsole} = require('jsdom');

const HOST_ALIASES = new Map([
  ['www.scpfoundation.net','scpfoundation.net'],
  ['www.scp-wiki.net','scp-wiki.wikidot.com'],
  ['scp-wiki.net','scp-wiki.wikidot.com'],
  ['scpwiki.com','scp-wiki.wikidot.com'],
  ['www.scpwiki.com','scp-wiki.wikidot.com']
]);
const AUX_SELECTORS = [
  'nav', '[role="navigation"]', '#toc', '.toc', '.page-tags',
  '.page-rate-widget-box', '.creditRate', '.credit-rate', '.credit',
  '.credit-box', '.licensebox', '.license-box', '.license-area',
  '.authorbox', '#u-author_block', '#u-author-block', '#u-credit-view',
  '.footer-wikiwalk-nav', '.wikiwalk-nav', '.page-navigation', '.scp-footer',
  '.interwiki-box', '#interwiki', '.translation-source',
  '.credit-back', '.acs-hybrid-text-bar', '.classification-decoration',
  '.error-block', '.collapsible-block-link', 'script', 'style',
  '.licensebox-credits', '.multibranch-wrapper', '.rnb-navbar',
  '.earthworm', '[class*="earthworm__"]'
].join(',');

// A repeated image-only gallery linking to category directories is a site menu,
// not a story reference. Require a cluster of >=8 distinct targets, not merely
// an image anchor: image-based narrative links must remain eligible.
const DIRECTORY_SLUG=/^(?:groups-of-interest|task-forces|personnel-and-character-dossier|canon-hub|log-of-anomalous-items|log-of-extranormal-events|log-of-unexplained-locations|secure-facilities-locations)(?:-[a-z\d-]+)?$/i;
function isDirectoryIcon(anchor) {
  if (!anchor.querySelector('img') || anchor.textContent.trim()) return false;
  try {return DIRECTORY_SLUG.test(decodeURIComponent(new URL(anchor.getAttribute('href'),anchor.ownerDocument.baseURI).pathname).replace(/^\/+|\/+$/g,''));}
  catch (_) {return false;}
}
function isImageDirectoryMenu(anchor,root) {
  if (!isDirectoryIcon(anchor)) return false;
  for(let parent=anchor.parentElement;parent&&parent!==root;parent=parent.parentElement){
    const icons=[...parent.querySelectorAll('a[href]')].filter(isDirectoryIcon);
    if(new Set(icons.map(a=>a.getAttribute('href'))).size>=8) return true;
  }
  return false;
}

function normalizedUrl(raw, from) {
  try {
    const u = new URL(raw, from);
    if (!['http:','https:'].includes(u.protocol) || u.username || u.password || u.port) return null;
    if ([...u.searchParams.keys()].some(k => !['utm_source','utm_medium','utm_campaign'].includes(k))) return null;
    const host = HOST_ALIASES.get(u.hostname.toLowerCase()) || u.hostname.toLowerCase();
    const slug = decodeURIComponent(u.pathname).replace(/^\/+|\/+$/g,'').toLowerCase();
    if (!/^[\p{L}\p{N}][\p{L}\p{N}_:-]*$/u.test(slug)) return null;
    if (/^(?:system|admin|forum|user|component|theme|nav|fragment|css|template):/.test(slug)) return null;
    return 'https://' + host + '/' + encodeURI(slug);
  } catch (_) { return null; }
}
function hostOf(url) {
  try { return new URL(url).hostname; } catch (_) { return ''; }
}
function selectorFor(anchor) {
  const nodes = [];
  let node = anchor;
  for (let i=0; node && i<7 && node.nodeType===1; i++,node=node.parentElement) {
    let part = node.localName;
    if (node.id) { part += '#' + node.id.replace(/[^\w-]/g,'_'); nodes.unshift(part); break; }
    const siblings = node.parentElement ? [...node.parentElement.children].filter(n=>n.localName===node.localName) : [];
    if (siblings.length>1) part += ':nth-of-type(' + (siblings.indexOf(node)+1) + ')';
    nodes.unshift(part);
  }
  return nodes.join(' > ');
}
function evaluate(candidate, source, workByUrl, supportedHosts) {
  const targetUrl = normalizedUrl(candidate.href, source);
  if (!targetUrl) return {...candidate, reason:'unresolvable_url', targetUrl:null, targetWork:null};
  const work = workByUrl.get(targetUrl) || null;
  if (!work) {
    const why = supportedHosts.has(hostOf(targetUrl)) ? 'outside_catalog' : 'external_site';
    return {...candidate, reason:why, targetUrl, targetWork:null};
  }
  if (work === workByUrl.get(normalizedUrl(source,source))) {
    return {...candidate, reason:'same_work', targetUrl, targetWork:work};
  }
  return {...candidate, reason:'reference', targetUrl, targetWork:work};
}
function resultFromRaw(raw, source, workByUrl, supportedHosts, warnings) {
  const all = raw.map(c=>c.skip ? {...c,reason:c.skip,targetUrl:null,targetWork:null} : evaluate(c,source,workByUrl,supportedHosts));
  const links = new Map(), counts = {};
  for (const c of all) {
    counts[c.reason] = (counts[c.reason]||0)+1;
    if (c.reason!=='reference') continue;
    if (!links.has(c.targetWork)) links.set(c.targetWork,[]);
    links.get(c.targetWork).push({href:c.href,quote:c.quote,selector:c.selector,sourceElement:c.sourceElement});
  }
  return {links,all,counts,warnings};
}
// These are independently recognized publisher UI blocks. We do not import
// chapter-navigation.js: independent extraction must not share its bug surface.
function isChapterBar(anchor) {
  const parent=anchor.closest('p');
  if(!parent)return false;
  const links=[...parent.querySelectorAll('a[href]')];
  if(links.length<2||links.length>5)return false;
  const clone=parent.cloneNode(true);
  for(const link of clone.querySelectorAll('a[href]'))link.replaceWith('\uFFFC');
  const flat=clone.textContent.normalize('NFKC').replace(/\s+/g,'').trim();
  if(!/^[«‹<]/.test(flat)||!/[»›>]$/.test(flat))return false;
  if(!flat.includes('|'))return false;
  // Two outer chapter links may surround a plain-text hub title. This is
  // still a navigation bar; a narrative paragraph lacks the bounded triplet.
  const slots=flat.replace(/^[«‹<]+|[»›>]+$/gu,'').split('|');
  if(slots.length===3&&slots[0]==='\uFFFC'&&slots[2]==='\uFFFC'&&
      slots[1].length>0&&slots[1].length<=160)return true;
  return /^[«»‹›<>|\/.,:;·•\-\u2013\u2014\u2190\u2192\uFFFC]+$/u.test(flat);
}
function isBreadcrumbBanner(anchor,title) {
  const p=anchor.closest('p');
  if(!p||p.querySelectorAll('a[href]').length!==1||!title)return false;
  const text=p.textContent.replace(/\s+/g,' ').trim(),label=anchor.textContent.replace(/\s+/g,' ').trim();
  return label.length>0&&text.startsWith(label+' » ')&&
    text.slice(label.length+3).trim().toLowerCase()===title.trim().toLowerCase();
}
function isAttributionParagraph(anchor) {
  const p=anchor.closest('p');
  if(!p)return false;
  const text=p.textContent.replace(/\s+/g,' ').trim();
  if(/\bFilename\s*:/i.test(text)&&/\bAuthor\s*:/i.test(text)&&
      /\bSource Link\s*:/i.test(text)&&/\bLicense\s*:\s*CC[\s-]*BY[\s-]*SA/i.test(text))return true;
  return /(?:原文來源|original source|original article)/i.test(text) &&
    /(?:CC[\s-]*BY[\s-]*SA|授權方式|license)/i.test(text);
}
function isAuthorCollection(anchor) {
  const panel=anchor.closest('.collection');
  if(!panel)return false;
  const titles=[...panel.querySelectorAll('.collapsible-block-link,summary,h1,h2,h3,h4,h5,h6')];
  return titles.some(n=>/\bmore (?:from|by) (?:this|the) author\b/i.test(n.textContent.replace(/\s+/g,' ')))||
    !!panel.querySelector('th.articlecolumn,td.articlecolumn');
}
function fromHtml(html,source,workByUrl,supportedHosts) {
  const doc = new JSDOM(html,{url:source,virtualConsole:new VirtualConsole()});
  try {
    const root = doc.window.document.querySelector('#page-content');
    if (!root) throw new Error('missing_article_body');
    const title = (doc.window.document.querySelector('#page-title')?.textContent||doc.window.document.title||'').trim();
    if (/^(?:page not found|page does not exist|access denied|security check)$/i.test(title)) throw new Error('not_article');
    const raw = [];
    for (const a of root.querySelectorAll('a[href]')) {
      const href = (a.getAttribute('href')||'').trim();
      let skip = null;
      if (!href || href.startsWith('#')) skip='fragment_or_empty';
      else if (a.classList.contains('newpage')) skip='missing_page_link';
      else if (a.matches('[rel~="alternate"],[data-translation-source]')) skip='translation_metadata';
      else if (a.closest(AUX_SELECTORS) || [...a.parentElement?.classList||[]].some(c=>/^(licensebox|creditRate)/i.test(c))) skip='auxiliary_content';
      else if (isImageDirectoryMenu(a,root)) skip='image_directory_navigation';
      else if (isAuthorCollection(a)) skip='author_collection';
      else if (isChapterBar(a)) skip='chapter_navigation';
      else if (isBreadcrumbBanner(a,title)) skip='breadcrumb_navigation';
      else if (isAttributionParagraph(a)) skip='source_credit_metadata';
      raw.push({
        href,quote:(a.textContent||'').replace(/\s+/g,' ').trim().slice(0,180),
        selector:selectorFor(a),sourceElement:a.outerHTML.slice(0,450),skip
      });
    }
    const warnings = [];
    if (root.querySelector('iframe')) warnings.push('iframe_not_expanded');
    if (root.querySelector('script')) warnings.push('dynamic_script_content');
    return resultFromRaw(raw,source,workByUrl,supportedHosts,warnings);
  } finally { doc.window.close(); }
}
function ftmlNavigationRanges(text,source,title='') {
  const ranges=[],identity=s=>s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  const slug=decodeURIComponent(new URL(source).pathname).split('/').at(-1);
  function inspect(value,start,end){
    const labels=[];let self=false;
    let flat=value.replace(/\[\[\[([^\]|]+)(?:\|([^\]]*))?\]\]\]|\[(https?:\/\/[^\s\]]+)(?:\s+([^\]]*))?\]/gi,
      (_,href,label,url,caption)=>{labels.push(label||caption||href||url);if(normalizedUrl(href||url,source)===normalizedUrl(source))self=true;return '\uFFFC';});
    flat=flat.replace(/\[\[\/?(?:(?:div|span|section|size)\b|=)[^\]]*\]\]/gi,'')
      .normalize('NFKC').replace(/\*\*|__|\/\//g,'').replace(/^\s*=\s+/,'').replace(/\s+/g,' ').trim();
    const count=[...flat].filter(c=>c==='\uFFFC').length;
    if(count===1&&/^\uFFFC\s*[»›>]\s*/u.test(flat)){
      const tail=flat.replace(/^\uFFFC\s*[»›>]\s*/u,'');
      if(identity(tail)===identity(title||slug))ranges.push([start,end]);
      return;
    }
    if(count<2||count>5)return;
    const arrows=/^[<«‹〈《≪←]/u.test(flat)&&/[>»›〉》≫→]$/u.test(flat);
    const inner=flat.replace(/^[<«‹〈《≪←]+\s*/u,'').replace(/\s*[>»›〉》≫→]+$/u,'');
    const parts=inner.split('|').map(s=>s.trim()),triplet=parts.length===3&&parts[0]==='\uFFFC'&&parts[2]==='\uFFFC';
    const symbols=/^[\s\uFFFC|/,:;·•\-–—]+$/u.test(inner);
    const named=labels.some(s=>/^(?:previous(?: page| chapter)?|prev|назад|предыдущая)\s*$/iu.test(s))&&
      labels.some(s=>/^(?:next(?: page| chapter)?|далее|следующая|вперёд)\s*$/iu.test(s));
    if(arrows&&(symbols||triplet&&parts[1].length<=160)||named&&symbols||
      triplet&&(parts[1]==='\uFFFC'?self:identity(parts[1])===identity(title||slug)))ranges.push([start,end]);
  }
  for(const m of text.matchAll(/\[\[=\]\][\s\S]*?\[\[\/=\]\]|[^\r\n]+/g))inspect(m[0],m.index,m.index+m[0].length);
  return ranges;
}
function fromFtml(sourceText,source,workByUrl,supportedHosts,title='') {
  if (typeof sourceText!=='string') throw new Error('missing_ftml_source');
  const raw=[],stack=[],warnings=[],navigation=ftmlNavigationRanges(sourceText,source,title);
  if (/\[\[include\b/i.test(sourceText)) warnings.push('ftml_includes_not_expanded');
  if (/\[\[module\b/i.test(sourceText)) warnings.push('ftml_modules_not_expanded');
  // Independent token scanner; ignores comments and literal code/html blocks.
  const pattern=/\[\[!--[\s\S]*?--\]\]|\[\[(?:code|html)\b[^\]]*\]\][\s\S]*?\[\[\/(?:code|html)\]\]|\[\[\/?(?:div|span|section)\b[^\]]*\]\]|\[\[\[[\s\S]*?\]\]\]|\[https?:\/\/[^\]\r\n]+\]/gi;
  for (const match of sourceText.matchAll(pattern)) {
    const token=match[0],container=/^\[\[(\/?)(div|span|section)\b([\s\S]*?)\]\]$/i.exec(token);
    if (container) {
      const tag=container[2].toLowerCase();
      if (container[1]) {
        const at=stack.map(x=>x.tag).lastIndexOf(tag);
        if (at>=0) stack.splice(at);
      } else {
        const text=container[3].toLowerCase();
        const classes=/(?:^|\s)class\s*=\s*["']?([^"'\]]+)/i.exec(text)?.[1]?.split(/\s+/)||[];
        const drop=classes.some(c=>/^(?:credit|creditrate|credit-box|license|licensebox|interwiki|toc|page-navigation|wikiwalk-nav|footer-wikiwalk-nav|scp-footer|authorbox)/i.test(c))||
          /role\s*=\s*["']?navigation/.test(text);
        stack.push({tag,drop});
      }
      continue;
    }
    if (!token.startsWith('[[[') && !token.startsWith('[http')) continue;
    let href='',quote='';
    if (token.startsWith('[[[')) {
      const content=token.slice(3,-3),sep=content.indexOf('|');
      href=(sep<0?content:content.slice(0,sep)).trim();
      quote=sep<0?href:content.slice(sep+1).trim();
    } else {
      const inner=token.slice(1,-1),split=/^(\S+)(?:\s+([\s\S]*))?$/.exec(inner);
      if (!split) continue;
      href=split[1];quote=split[2]||href;
    }
    const skip=stack.some(x=>x.drop)?'auxiliary_content':href.startsWith('#')?'fragment_or_empty':
      navigation.some(([start,end])=>match.index>=start&&match.index<end)?'chapter_navigation':null;
    raw.push({href,quote:quote.slice(0,180),selector:'FTML offset '+match.index,
      sourceElement:token.slice(0,450),skip});
  }
  return resultFromRaw(raw,source,workByUrl,supportedHosts,warnings);
}
module.exports={normalizedUrl,fromHtml,fromFtml,resultFromRaw,isDirectoryIcon,isImageDirectoryMenu,isChapterBar,isBreadcrumbBanner,isAttributionParagraph};
