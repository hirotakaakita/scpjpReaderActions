'use strict';

// RuFoundation exposes the authoritative joke tag even when an English catalog
// entry is absent or the identifier is alphanumeric (1D6, 3V1L, minus-1).
function russianJokeIdentity(url, tags = [], fallbackBranch = 'en') {
  let page;
  try { page = new URL(url); } catch { return null; }
  if (page.hostname !== 'scpfoundation.net') return null;
  const slug = decodeURIComponent(page.pathname).replace(/^\/+|\/+$/g, '').toLowerCase();
  if (!/^scp-[a-z0-9_-]+$/.test(slug)) return null;
  const tokens = slug.slice(4).split('-');
  if (/(?:^|-)j-(?:supplement|addendum|log|experiment|exploration|interview|incident)(?:-|$)/.test(slug)) return null;
  const names = tags.flatMap(t => typeof t === 'string' ? [t] : [t?.id, t?.label].filter(Boolean)).map(t => t.toLowerCase());
  const marked = names.some(t => ['joke','тип:шуточный'].includes(t));
  if (!/-j(?:-(?:v|d|ex))?$/.test(slug) && !marked) return null;
  const branches = new Set(['en','zh','sk','nd', ...Object.keys(require('./languages').LANGUAGES), ...Object.keys(require('./additional-origins.json'))]);
  const tagged = names.map(t => /^филиал:([a-z-]+)$/.exec(t)?.[1]).filter(t => branches.has(t));
  const branch = tokens.find(t => branches.has(t)) || tagged.find(t => t !== 'en') || tagged[0] || (branches.has(fallbackBranch) ? fallbackBranch : 'en');
  const body = tokens.filter(t => t !== branch).join('-');
  // A base identifier needs no redundant -J; compound variants retain their name.
  const identifier = /^[a-z0-9_]+-j$/.test(body) ? body.slice(0,-2) : body;
  const pageType = branch === 'en' ? 'joke-scps' : 'joke-scps-' + branch;
  const number = /^\d+(?:-|$)/.exec(identifier)?.[0].replace(/-$/, '');
  return {itemId:pageType+'-'+identifier,pageType,originBranch:branch,numericItemId:number ? Number(number) : null};
}

module.exports = { russianJokeIdentity };
