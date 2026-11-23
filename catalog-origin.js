'use strict';
const { LANGUAGES } = require('./languages');
const additionalOrigins = require('./additional-origins.json');
const branches = new Set(['en', 'zh', 'sk', 'id', ...Object.keys(LANGUAGES), ...Object.keys(additionalOrigins)]);
function validOrigin(value) {
  value = value === 'zh-tr' ? 'zh' : value;
  return branches.has(value) ? value : null;
}
// Publisher rules, not a blanket inference from the page's hosting language.
// CN tag-guide: native = 原创; fiction without an origin tag defaults to EN.
// EN translations-policy: translations require international and _<branch>.
const originAliases = {'nd-da':'da','nd-no':'no','nd-sv':'sv','interslavic':'isv','interlingue':'ie','ido':'io','iranic':'ir'};
const unsupportedOrigins = new Set(['uk']);
function publisherOriginTags(url, record) {
  const host = new URL(url).hostname;
  const tags = (record?.tags || []).map(t => t.toLowerCase());
  // English branch language tags are _ru, _jp, _pig, etc. A bare tag can
  // be ordinary article subject matter (e.g. "pig" on EN SCP-509), and
  // MUST NOT reassign that English original to the Pig Latin branch.
  const values = tags.map(t => t.replace(/^филиал:/u, '')).map(t =>
    host === 'scp-wiki.wikidot.com' ?
      (/^_[a-z]{2,3}$/.test(t) ? t.slice(1) : null) : t)
    .filter(Boolean).map(t=>originAliases[t] || t);
  // ULI's namespace and matching language tag describe the delivery language.
  // Keep every other origin tag, including genuine collaboration conflicts.
  const delivery = host === 'scp-int.wikidot.com' && tags.includes('language-incubator') &&
    /^\/unofficial:([a-z]{2,3}):/.exec(new URL(url).pathname)?.[1];
  if (delivery) {
    for (let i = values.length - 1; i >= 0; i--) if (values[i] === delivery) values.splice(i, 1);
  }
  if (host === 'scp-wiki-cn.wikidot.com' && tags.includes('原创')) values.push('cn');
  if (host === 'scp-zh-tr.wikidot.com' && tags.includes('原創')) values.push('zh');
  if (host === 'scp-pl.wikidot.com' && tags.includes('oryginał')) values.push('pl');
  // The publisher separates České články / Slovenské články using these tags:
  // https://scp-cs.wikidot.com/foundation-tales
  if (host === 'scp-cs.wikidot.com') {
    if (tags.includes('české')) values.push('cs');
    if (tags.includes('slovenské')) values.push('sk');
  }
  // DE requires the origin language written out, including deutsch for native
  // articles: https://scp-wiki-de.wikidot.com/regeln (Vorgeschriebene Tags).
  if (host === 'scp-wiki-de.wikidot.com') {
    const languages = { deutsch:'de', englisch:'en', chinesisch:'cn',
      'traditionelles-chinesisch':'zh', japanisch:'jp', koreanisch:'ko',
      russisch:'ru', 'französisch':'fr', polnisch:'pl', spanisch:'es',
      'thailändisch':'th', italienisch:'it', ukrainisch:'ua',
      portugiesisch:'pt', tschechisch:'cs', vietnamesisch:'vn',
      griechisch:'el', lateinisch:'la' };
    values.push(...tags.map(t => languages[t]).filter(Boolean));
  }
  return {
    origins: [...new Set(values.map(validOrigin).filter(Boolean))],
    unsupported: [...new Set(values.filter(t => unsupportedOrigins.has(t)))],
    conflicts: host === 'scp-pl.wikidot.com' && tags.includes('oryginał') && tags.includes('tłumaczenie') ? ['oryginał','tłumaczenie'] : [],
  };
}
function publisherDefaultOrigin(url, record, {originalSource=false}={}) {
  // Unresolved explicit translation metadata must not be replaced by a default.
  if (record?.translations?.length || record?.originalSources?.length) return null;
  const tags = new Set((record?.tags || []).map(t => t.toLowerCase()));
  const host = new URL(url).hostname;
  // DE rules require übersetzt plus the source-language tag, except for EN.
  if (host === 'scp-wiki-de.wikidot.com' && tags.has('übersetzt')) {
    return { branch:'en',basis:'publisher_default_origin',evidence:['https://scp-wiki-de.wikidot.com/regeln'] };
  }
  if (host === 'scp-pt-br.wikidot.com' && tags.has('traduzido')) {
    return {branch:'en',basis:'publisher_default_origin',evidence:['https://scp-pt-br.wikidot.com/guia-de-tags']};
  }
  if ([...tags].some(t => ['international','translation','translated','二次翻译','二次翻譯','翻譯','翻译','traduzido'].includes(t))) return null;
  if (host === 'scp-wiki-cn.wikidot.com' &&
      ['scp','故事','goi格式','补充材料','站点'].some(t => tags.has(t))) {
    return { branch:'en',basis:'publisher_default_origin',evidence:['https://scp-wiki-cn.wikidot.com/tag-guide'] };
  }
  if (host === 'scp-wiki.wikidot.com' &&
      (['scp','tale','supplement','hub','site'].some(t => tags.has(t)) ||
       // A verified terminal translationOf source also covers EN resources,
       // essays and art. EN translations-policy requires international tags
       // for translations of every article type. Do not extend host defaults
       // to unlabelled pages without this independent original-source proof.
       originalSource && tags.size>0 && ![...tags].some(t=>/^_[a-z]{2,3}$/.test(t)&&!['_cc','_nc','_occ','_o'].includes(t)))) {
    return { branch:'en',basis:'publisher_default_origin',evidence:['https://scp-wiki.wikidot.com/translations-policy'] };
  }
  return null;
}

// Explicit EN-origin collections; this is not a default from the hosting site.
function nativeCollectionOrigin(source) {
  try {
    const u = new URL(source);
    // The CN short-story submission hub explicitly presents its archive as
    // 原创短篇故事 and publishes members' own submissions (with authors).
    // https://scp-wiki-cn.wikidot.com/short-stories
    if(u.hostname==='scp-wiki-cn.wikidot.com'&&/^\/short-stories(?:\/p\/\d+)?\/?$/.test(u.pathname))return 'cn';
    // The page explicitly says "Relatos ... Anglosajones / Sección Anglosajona".
    if (u.hostname === 'lafundacionscp.wikidot.com' && /^\/relatos-de-la-fundacion(?:\/p\/\d+)?\/?$/.test(u.pathname)) return 'en';
    return u.hostname === 'scp-wiki.wikidot.com' &&
      /^\/(?:foundation-tales|goi-formats|top-rated-tales|tales-by-(?:year|author|title|date))(?:\/|$)/.test(u.pathname) ? 'en' : null;
  } catch { return null; }
}
function resolveOrigin(record, evidence, fallback, originHint) {
  // Article-specific provenance wins over a mixed hub's section headings.
  if (validOrigin(fallback.branch)) return { ...fallback, branch: validOrigin(fallback.branch) };
  if (/^conflicting_|^unsupported_|^unresolved_(?:original_credit|interwiki_origin)$|^translation_(?:cycle|depth_limit)$/.test(fallback.basis || '')) return fallback;
  const origins = [...new Set(evidence.map(e => {
    const hint = e.source ? validOrigin(originHint(e.source)) : null;
    // Old checkpoints may carry an origin leaked from a previous heading.
    // Recover from the actual collection URL or this member's own heading.
    const heading = /^SCP[- ]([a-z]{2})(?:\b|-)/i.exec(e.section || '');
    return hint || (heading && validOrigin(heading[1].toLowerCase()) === validOrigin(e.origin) ? validOrigin(e.origin) : null);
  }).filter(Boolean))];
  if (origins.length === 1) return { branch: origins[0], basis: 'official_index_section', evidence: origins };
  if (origins.length > 1) return { branch: null, basis: 'conflicting_index_origins', evidence: origins };
  const translation = (record.tags || []).some(t => /^(?:translation|translated|international|traduzido|翻译|翻譯|翻訳)$/.test(t)) || record.translations?.length;
  const native = !translation && evidence.map(e => nativeCollectionOrigin(e.source)).find(Boolean);
  return native ? { branch: native, basis: 'native_official_collection', evidence: evidence.filter(e => nativeCollectionOrigin(e.source)).map(e => e.source) } : fallback;
}
module.exports = { validOrigin, nativeCollectionOrigin, resolveOrigin, publisherOriginTags, publisherDefaultOrigin };
