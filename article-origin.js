'use strict';
// Catalog pageType identifies the original branch independently of hosting language.
function branchForPageType(type) {
  const document = /^related-document-([a-z-]+)$/.exec(type || '');
  if (document) return document[1] === 'unclassified' ? 'other' : document[1];
  if (['scp-series', 'joke-scps', 'scp-ex'].includes(type)) return 'en';
  const match = /^(?:scp-series-|joke-scps-)([a-z][a-z-]*)$/.exec(type || '') ||
    /^scp-([a-z][a-z-]*)-ex$/.exec(type || '');
  return match?.[1] || null;
}

module.exports = { branchForPageType };
