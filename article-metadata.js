'use strict';

// Resolve retained canonical tag IDs as well as freshly fetched local labels.
function tagNames(tags = []) {
 const dictionary=require('./tag-dictionary.json').tags;
 return [...new Set(tags.flatMap(t=>typeof t==='string'?[t]:[t?.id,t?.label].filter(Boolean))
  .flatMap(t=>[t,...(dictionary[t]?.aliases||[])])
  .map(t=>t.normalize('NFC').toLowerCase()))];
}
function knownBranches(){return new Set(['en','zh','sk','nd',...Object.keys(require('./languages').LANGUAGES),...Object.keys(require('./additional-origins.json'))]);}

// Audited publisher URLs whose slugs still contain a contest/translation name.
// Do not infer an alias from a shared printed number: 001 proposals are distinct.
const aliases={
 'scp-jp.wikidot.com/scp-4000-jp-o-92-mallet':'scp-4133-jp',
 'fondazionescp.wikidot.com/scp-4955-coltello':'scp-4955',
};
function scpMetadata(record, url='', inputSlug='', fallback='en'){
 let page;try{page=new URL(url);}catch{}
 const original=inputSlug||(page?decodeURIComponent(page.pathname).replace(/^\/+|\/+$/g,''):'');
 const canonical=aliases[page?.hostname+'/'+original];
 const slug=(canonical||original).toLowerCase();
 const m=/^scp-(?:([a-z]+)-)?(\d+)(?:-(.*))?$/.exec(slug);
 if(!m)return null;
 const branches=knownBranches(),tags=tagNames(record.tags),tokens=(m[3]||'').split('-').filter(Boolean);
 if(m[1]&&!branches.has(m[1]))return null;
 let branch=m[1]||tokens.find(t=>branches.has(t))||'en';
 // I-57 is an ES regional/canon rewrite, not the ordinary EN SCP-1290.
 if(/-i57$/.test(slug)&&(tags.includes('es')||fallback==='es'))branch='es';
 const joke=tags.some(t=>['joke','ジョーク','搞笑','witz','humour','piada','농담','тип:шуточный','hài','okejay'].includes(t))||tokens.includes('j');
 const explained=tags.some(t=>['explained','已解明','erklärt','expliqué','risolto','тип:-ex'].includes(t))||tokens.includes('ex');
 const family=joke?'joke-scps':explained?'scp-ex':'scp-series';
 const pageType=branch==='en'?family:family==='scp-ex'?`scp-${branch}-ex`:`${family}-${branch}`;
 let identifier=require('./local-crawler').variantSlugPart('/'+slug,pageType);
 if(family!=='scp-series'&&new RegExp('^\\d+-(?:j|ex)$').test(identifier))identifier=identifier.replace(/-(?:j|ex)$/,'');
 // The publisher uses a decimal number, although URL slugs replace '.' by '-'.
 if(original==='scp-7-3-pig-j'){identifier='7.3';}
 return {slug,canonicalAlias:!!canonical,decimalAlias:original==='scp-7-3-pig-j',
  itemId:pageType+'-'+identifier,pageType,originBranch:branch,numericItemId:Number(m[2])};
}
function deduplicateReclassifiedArticles(rows){
 const byId=new Map();
 const location=row=>{
  const page=new URL(row.urlJP||row.urlEN);
  const slug=decodeURIComponent(page.pathname).replace(/^\/+|\/+$/g,'');
  const canonical=aliases[page.hostname+'/'+slug];
  return {key:page.hostname+'/'+(canonical||slug),alias:!!canonical};
 };
 for(const row of rows){
  const old=byId.get(row.itemId);
  if(!old){byId.set(row.itemId,row);continue;}
  const a=location(old),b=location(row);
  if(a.key!==b.key)throw Error('Conflicting reclassified itemId: '+row.itemId+' ('+a.key+' / '+b.key+')');
  const chosen=a.alias&&!b.alias?row:!a.alias&&b.alias?old:(row.lastUpdated||'')>(old.lastUpdated||'')?row:old;
  byId.set(row.itemId,{...chosen,translatedLanguages:[...new Set([...(old.translatedLanguages||[]),...(row.translatedLanguages||[])])].sort()});
 }
 return [...byId.values()];
}
module.exports={tagNames,knownBranches,scpMetadata,deduplicateReclassifiedArticles};
