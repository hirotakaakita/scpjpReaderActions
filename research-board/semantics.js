"use strict";
// Semantic claims are opt-in, source-specific and rechecked against the current text.
// A hyperlink or a shared generic tag is never enough to assert a story relationship.
const TYPES = {
co_appearance:'共演・会話',hostile_to:'敵対',member_of:'所属',canon_member:'カノンに所属',same_canon:'同じカノン',experiment:'実験・接触',sequel:'続編',created_by:'作成・起源',contains_document:'関連ログ',appears_in_addendum:'補遺内で参照',appears_in_log:'ログ内で参照',references:'本文参照',translation_assertion:'翻訳元・別言語版'
};
const RULES = require('./reviewed-relations.json');
function pageKind(page, record) {
  const tags=new Set(record?.tags || []), slug=page.slug || '';
  if(tags.has('hub') || /(?:^|-)hub$/.test(slug)) return {type:'hub', basis:tags.has('hub')?'publisher_tag':'url_pattern'};
  if(/(?:experiment|termination|incident|test|exploration|interview)[-_](?:log|record)|^(?:experiment|incident|exploration)-log/.test(slug)) return {type:'log',basis:'url_pattern'};
  if(tags.has('tale')) return {type:'tale',basis:'publisher_tag'};
  if(tags.has('scp')) return {type:'scp',basis:'publisher_tag'};
  if(/^scp-\d+(?:-|$)/.test(slug)) return {type:'scp',basis:'url_pattern'};
  return {type:'document',basis:'unclassified'};
}
function assertions(url, text) {
  const normalized=text.replace(/\s+/g,' ');
  return RULES.filter(r=>r.source===url && normalized.includes(r.quote.replace(/\s+/g,' ')))
    .map(r=>({target:r.target,targetEntity:r.targetEntity,subject:r.subject,type:r.type,quote:r.quote,note:r.note,location:'article_body',sourceAnchor:null,method:'source_specific_exact_quote'}));
}
module.exports={TYPES,RULES,pageKind,assertions};
