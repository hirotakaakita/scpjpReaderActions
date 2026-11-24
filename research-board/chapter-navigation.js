'use strict';

const LINK = '\ufffc';
const LEFT = /^[<«‹〈《≪←]+\s*/u;
const RIGHT = /\s*[>»›〉》≫→]+$/u;
const identity = text => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// Match a navigation block's structure, never the destination's SCP number.
// A genuine reference to the preceding/following SCP elsewhere must survive.
function isChapterNavigation(text, source, hasCurrentLink = false, labels = []) {
  text = text.normalize('NFKC').replace(/\*\*|__|\/\//g, '').replace(/\s+/g, ' ').trim();
  const count = [...text].filter(c => c === LINK).length;
  if (count < 2 || count > 5) return false;
  const arrows = LEFT.test(text) && RIGHT.test(text);
  const inner = arrows ? text.replace(LEFT, '').replace(RIGHT, '').trim() : text;
  const parts = inner.split('|').map(s => s.trim());
  const previous = labels.some(label => /^(?:previous(?:\s+(?:page|chapter))?|prev)\s*[|«»<>←→]*$/i.test(label.trim()));
  const next = labels.some(label => /^next(?:\s+(?:page|chapter))?\s*[|«»<>←→]*$/i.test(label.trim()));
  if (previous && next && /^[\s\ufffc|/,:;·•\-–—]*$/u.test(inner)) return true;
  const triplet = parts.length === 3 && parts[0] === LINK && parts[2] === LINK &&
    parts[1].length > 0 && parts[1].length <= 160;
  if (arrows) {
    return triplet || /^[\s\ufffc|/,:;·•\-–—]*$/u.test(inner);
  }
  return triplet && (parts[1] === LINK ? hasCurrentLink :
    identity(parts[1]) === identity(source.slug) ||
    !!source.title && identity(parts[1]) === identity(source.title));
}

// A pure hub/category breadcrumb ending in this article is navigation. The
// same destination in narrative text or an ordinary hub member list survives.
function isBreadcrumb(text, source, lastIsCurrent) {
  const parts = text.normalize('NFKC').trim().split(/\s*[»›>]\s*/u);
  if (parts.length < 2 || parts.length > 5 || parts.slice(0, -1).some(p => p.trim() !== LINK)) return false;
  const last = parts.at(-1).trim();
  return last === LINK ? lastIsCurrent : !!last &&
    (identity(last) === identity(source.slug) || !!source.title && identity(last) === identity(source.title));
}

function removeHtmlNavigation(root, source, normalizePage) {
  for (const a of [...root.querySelectorAll('a[href]')]) {
    if (!root.contains(a)) continue;
    if (a.matches('[rel~="prev"], [rel~="next"]')) {
      a.remove();
      continue;
    }
    for (let block = a.parentElement; block && block !== root; block = block.parentElement) {
      if (!block.matches('p, div, section, footer, center, td, tr, li')) continue;
      const anchors = [...block.querySelectorAll('a[href]')];
      if (anchors.length > 5) break;
      if (anchors.length < 1) continue;
      const hasCurrent = anchors.some(link => normalizePage(link.getAttribute('href'), source.url)?.id === source.id);
      const copy = block.cloneNode(true);
      for (const link of copy.querySelectorAll('a[href]')) link.replaceWith(LINK);
      if (isBreadcrumb(copy.textContent, source,
          normalizePage(anchors.at(-1).getAttribute('href'), source.url)?.id === source.id) ||
          isChapterNavigation(copy.textContent, source, hasCurrent,
          anchors.map(link => link.textContent.replace(/\s+/g, ' ')))) {
        block.remove();
        break;
      }
    }
  }
}

function removeFtmlNavigation(body, source, normalizePage) {
  function navigation(text) {
    let hasCurrent = false;
    let lastIsCurrent = false;
    const labels = [];
    const replace = (_, href, label) => {
      lastIsCurrent = normalizePage(href.trim().replace(/^\*/, ''), source.url)?.id === source.id;
      if (lastIsCurrent) hasCurrent = true;
      labels.push(label || href);
      return LINK;
    };
    text = text.replace(/\[\[\[([^\]|]+)(?:\|([^\]]*))?\]\]\]/g, replace)
      .replace(/(?<!\[)\[(https?:\/\/[^\s\]]+)(?:\s+([^\]]*))?\](?!\])/g, replace)
      .replace(/\[\[\/?(?:(?:div|span|section|size)\b[^\]]*|[=<>])\]\]/g, '')
      .replace(/^[ \t]*=[ \t]+/gm, '');
    return isBreadcrumb(text, source, lastIsCurrent) || isChapterNavigation(text, source, hasCurrent, labels);
  }
  body = body.replace(/\[\[=\]\]([\s\S]*?)\[\[\/=\]\]/g,
    (block, content) => navigation(content) ? '' : block);
  body = body.split(/(\n\s*\n)/).map(block => navigation(block) ? '' : block).join('');
  return body.split('\n').map(line => navigation(line) ? '' : line).join('\n');
}

module.exports = { removeHtmlNavigation, removeFtmlNavigation };
