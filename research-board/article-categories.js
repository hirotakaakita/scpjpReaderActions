'use strict';
// Mirror ArticleClassification.category in the Flutter HOME/reading ledger.
// Stable wire IDs preserve existing board snapshots; category order is separate.
const CATEGORY_ORDER = ['scp','ex','joke','tale','goi','record','setting','hub','other'];
const KIND_BY_CATEGORY = {scp:0,record:1,hub:2,tale:3,other:5,goi:6,setting:7,ex:8,joke:9};
const KINDS = ['scp','record','hub','tale','reserved','other','goi','setting','ex','joke'];
function homeCategory(pageType = '', contentType) {
  if (pageType.startsWith('related-document-')) {
    if (contentType === 'log') return 'record';
    return CATEGORY_ORDER.slice(3).includes(contentType) ? contentType : 'other';
  }
  if (pageType.startsWith('joke-scps')) return 'joke';
  if (pageType === 'scp-ex' || /^scp-.+-ex$/.test(pageType)) return 'ex';
  return 'scp';
}
function categoryRank(kind) { return CATEGORY_ORDER.indexOf(KINDS[kind]); }
module.exports = {CATEGORY_ORDER,KIND_BY_CATEGORY,KINDS,homeCategory,categoryRank};
