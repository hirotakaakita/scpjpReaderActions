'use strict';
const { branchForPageType } = require('./classification');
const {native,scpIdentityKey}=require('./translation-identities');
const {KIND_BY_CATEGORY,homeCategory}=require('./article-categories');
const {digest}=require('./extract');
const {verifiedScpOriginal}=require('./explicit-scp-origin');
const {legacyEnglishTopicPigAliases}=require('./legacy-topic-origin-aliases');
const {reviewedRepair}=require('./reviewed-150-work-repairs');

// Ledger identity, not a bare SCP number. Each variant/proposal and branch
// namespace keeps its own itemId. Unverified document translations stay apart.
function collapseWorks(pages, candidates, catalogEntries, sources = new Map()) {
  const pageKeys = new Map(), ledger = new Map(), aliases = new Map(), equivalentKeys = [],extraAliases=new Map();
  const eligibleByPage=new Map(),keyClaims=new Map(),keyOwners=new Map();
  const byPage=new Map(pages.map(p=>[p.id,p]));
  const originalOverrides=new Map();
  for(const page of pages){
    const original=verifiedScpOriginal(page,byPage,sources);
    if(original&&scpIdentityKey(original)!==scpIdentityKey(page))originalOverrides.set(page.id,original.id);
  }
  const signature=p=>[0,8,9].includes(p.kindIndex)?
    scpIdentityKey(byPage.get(originalOverrides.get(p.id))||p):p.branch+'\0'+p.pageType+'\0'+p.slug;
  for(const page of pages){
    const scp=[0,8,9].includes(page.kindIndex)&&page.pageType;
    const entries=(catalogEntries.get(page.id)||[]).filter(e=>e.itemId&&e.pageType&&
      (scp?KIND_BY_CATEGORY[homeCategory(e.pageType,e.contentType)]===page.kindIndex:branchForPageType(e.pageType)===page.branch));
    const own=entries.filter(e=>e.language===page.siteBranch),eligible=own.length?own:entries;
    eligibleByPage.set(page.id,eligible);
    if(scp)for(const e of eligible){
      const key=`catalog:${e.pageType}:${e.itemId}`,sig=signature(page);
      if(!keyClaims.has(key))keyClaims.set(key,new Map());
      const score=Number(branchForPageType(e.pageType)===page.branch)*4+Number(native(page)&&e.language===page.siteBranch)*2;
      keyClaims.get(key).set(sig,Math.max(keyClaims.get(key).get(sig)||0,score));
    }
  }
  for(const [key,claims]of keyClaims){
    const ranked=[...claims].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
    // A reused legacy ID may belong to several full identifiers. Give it only
    // to the uniquely authoritative original, never merge those works by ID.
    keyOwners.set(key,ranked.length===1||ranked[0][1]>ranked[1][1]?ranked[0][0]:null);
  }
  for (const page of pages) {
    const scp=[0,8,9].includes(page.kindIndex)&&page.pageType;
    const eligible=(eligibleByPage.get(page.id)||[]).filter(e=>!scp||keyOwners.get(`catalog:${e.pageType}:${e.itemId}`)===signature(page));
    const keys = [...new Set(eligible.map(e => `catalog:${e.pageType}:${e.itemId}`))];
    if (keys.length >= 1) {
      keys.sort();
      const key = keys[0];
      for (const entry of eligible) ledger.set(`catalog:${entry.pageType}:${entry.itemId}`, {
        articleId:entry.itemId, articleNumber:entry.articleNumber, pageType:scp?page.pageType:entry.pageType, branch:page.branch,
      });
      if (keys.length > 1) equivalentKeys.push(keys);
      pageKeys.set(page.id, key);
      const alias = signature(page);
      if (!aliases.has(alias)) aliases.set(alias, new Set());
      aliases.get(alias).add(key);
    }
  }
  for (const page of pages) if (!pageKeys.has(page.id)) {
    const known = aliases.get(signature(page));
    if (!page.classificationSourceId && [0,8,9].includes(page.kindIndex) && page.branch !== 'other') {
      if (originalOverrides.has(page.id)) {
        // Keep this delivery page separate until its exact original-credit
        // assertion is validated and recorded as a work-identity proof.
        // Reusing the original's alias here would silently join without proof.
        const e=(eligibleByPage.get(page.id)||[])[0];
        const key=(e?`catalog:${e.pageType}:${e.itemId}`:page.id)+
          '@original-'+digest(page.id).slice(0,12);
        ledger.set(key,{articleId:e?.itemId||'',articleNumber:e?.articleNumber,
          pageType:page.pageType,branch:page.branch});
        pageKeys.set(page.id,key);extraAliases.set(page.id,[key]);
      }
      else if (known?.size) pageKeys.set(page.id, [...known].sort()[0]);
      else if((eligibleByPage.get(page.id)||[]).length){
        const e=eligibleByPage.get(page.id)[0];
        let key=`catalog:${page.pageType}:${e.itemId}`;
        // This is an opaque board work key, not a replacement article ID.
        // Keep genuinely different variants apart when even the scoped old ID
        // is reused; exact catalog/page URLs continue to identify their rows.
        if(ledger.has(key))key+='@work-'+digest(signature(page)).slice(0,12);
        ledger.set(key,{articleId:e.itemId,articleNumber:e.articleNumber,pageType:page.pageType,branch:page.branch});
        pageKeys.set(page.id,key);extraAliases.set(page.id,[key]);
        aliases.set(signature(page),new Set([key]));
      }
      else if (!known && page.classificationBasis === 'scp_identifier') pageKeys.set(page.id,
        `identifier:${page.branch}:${page.pageType}:${page.slug}`);
    }
    if (!pageKeys.has(page.id)) pageKeys.set(page.id, page.id);
  }

  const parent = new Map([...pageKeys.values(), ...ledger.keys()].map(key => [key, key]));
  function root(key) {
    const previous = parent.get(key);
    if (previous === key) return key;
    const found = root(previous); parent.set(key, found); return found;
  }
  // Two catalog IDs explicitly pointing at the exact same page are aliases,
  // without changing either ID or any saved reading record in the app.
  for (const keys of equivalentKeys) for (const key of keys.slice(1)) {
    const a = root(keys[0]), b = root(key);
    if (a !== b) parent.set([a,b].sort()[1], [a,b].sort()[0]);
  }
  const claims=new Map(),blockedSources=new Set();
  for(const edge of candidates)if(edge.type==='translation_assertion'){
    if([0,8,9].includes(byPage.get(edge.source).kindIndex)&&edge.proof?.[5]!=='catalog_scp_identifier')continue;
    const target=byPage.get(edge.target),key=edge.source+'\0'+target.siteBranch;
    if(!claims.has(key))claims.set(key,new Set());claims.get(key).add(target.id);
    if(claims.get(key).size>1)blockedSources.add(edge.source);
  }
  const components=new Map(),nativeKeys=new Set(),identityProofs=[],identityReview=[];
  for(const page of pages){
    const key=root(pageKeys.get(page.id));
    if(!components.has(key))components.set(key,new Set());components.get(key).add(page.id);
    if(native(page))nativeKeys.add(key);
  }
  for (const edge of candidates) if (edge.type === 'translation_assertion') {
    if(blockedSources.has(edge.source)){identityReview.push({url:byPage.get(edge.source).url,original:byPage.get(edge.target).url,reason:'conflicting_translation_targets'});continue;}
    const a = root(pageKeys.get(edge.source)), b = root(pageKeys.get(edge.target));
    const source = byPage.get(edge.source), target = byPage.get(edge.target);
    const bothCatalogued = ledger.has(a) && ledger.has(b);
    const explicitDocumentTranslations = bothCatalogued &&
      ledger.get(a).pageType.startsWith('related-document-') &&
      ledger.get(b).pageType.startsWith('related-document-');
    const sameScpIdentity=edge.proof?.[5]==='catalog_scp_identifier'&&
      [0,8,9].includes(source.kindIndex)&&source.kindIndex===target.kindIndex&&source.branch!=='other'&&
      source.branch===target.branch&&source.pageType===target.pageType&&scpIdentityKey(source)===scpIdentityKey(target);
    const explicitScpIdentity=['explicit_scp_original_credit','explicit_transitive_scp_original_credit'].includes(edge.proof?.[5])&&
      originalOverrides.get(source.id)===target.id&&
      [0,8,9].includes(source.kindIndex)&&source.kindIndex===target.kindIndex&&
      source.branch===target.branch&&source.pageType===target.pageType;
    const originalCatalogPath=['origin_path_and_author','full_numbered_original_catalog_path','origin_and_original_catalog_path','interwiki_original_metadata'].includes(edge.proof?.[5])&&
      source.slug===target.slug&&source.branch!=='other'&&source.branch===target.branch&&native(target);
    if(a===b){
      if(explicitScpIdentity)identityProofs.push({source:source.url,target:target.url,method:edge.proof[5],
        ...(edge.creditChain?{chain:edge.creditChain}:{})});
      continue;
    }
    if (source.classificationSourceId || target.classificationSourceId ||
        (bothCatalogued && !explicitDocumentTranslations && !sameScpIdentity&&!originalCatalogPath&&!explicitScpIdentity) || (source.siteBranch === target.siteBranch&&!sameScpIdentity) ||
        (source.branch !== 'other' && target.branch !== 'other' && source.branch !== target.branch)) {identityReview.push({url:source.url,original:target.url,reason:'incompatible_translation_scope'});continue;}
    const left=[...(components.get(a)||[])].map(id=>byPage.get(id));
    const right=[...(components.get(b)||[])].map(id=>byPage.get(id));
    // An identity component cannot contain two distinct pages on one site, or
    // acquire incompatible origins through a chain of translation assertions.
    if(left.some(p=>right.some(q=>p.siteBranch===q.siteBranch&&p.id!==q.id))&&!(sameScpIdentity&&[...left,...right].every(p=>scpIdentityKey(p)===scpIdentityKey(source)))){identityReview.push({url:source.url,original:target.url,reason:'same_site_identity_collision'});continue;}
    const origins=new Set([...left,...right].map(p=>p.branch).filter(b=>b!=='other'));
    if(origins.size>1){identityReview.push({url:source.url,original:target.url,reason:'conflicting_component_origins'});continue;}
    // Prefer a catalog-backed identity over a URL-only identity.
    const canonicalKey=k=>ledger.has(k)&&k.startsWith('catalog:'+ledger.get(k).pageType+':');
    // An explicit credited native original wins over the delivery page's
    // legacy numbered key. Never reassign the native original to that key.
    const first = explicitScpIdentity?b:bothCatalogued ? canonicalKey(a)!==canonicalKey(b)?canonicalKey(a)?a:b:nativeKeys.has(a)!==nativeKeys.has(b)?nativeKeys.has(a)?a:b:[a,b].sort()[0] : ledger.has(a)?a:ledger.has(b)?b:[a,b].sort()[0];
    const second=first===a?b:a;
    parent.set(second,first);
    components.set(first,new Set([...(components.get(a)||[]),...(components.get(b)||[])]));components.delete(second);
    if(nativeKeys.has(a)||nativeKeys.has(b))nativeKeys.add(first);
    identityProofs.push({source:source.url,target:target.url,method:edge.proof?.[5]||edge.proof?.[2]||'explicit_translation_metadata',
      ...(edge.creditChain?{chain:edge.creditChain}:{})});
  }

  // Nordic delivery namespaces used to receive an opaque scoped key when a
  // raw catalog ID was already owned by the native original. Keep that exact
  // key as an alias after an explicit credit joins the two pages.
  for(const page of pages)if(originalOverrides.has(page.id)&&
      page.host==='scp-nd.wikidot.com'&&page.slug.startsWith('sv:')){
    const e=(eligibleByPage.get(page.id)||[])[0];
    if(!e)continue;
    const base=`catalog:${page.pageType}:${e.itemId}`;
    if(!ledger.has(base))continue;
    const alias=base+'@work-'+digest(scpIdentityKey(page)).slice(0,12);
    if(parent.has(alias)&&root(alias)!==root(pageKeys.get(page.id)))throw Error('Conflicting historical Nordic alias');
    ledger.set(alias,{articleId:e.itemId,articleNumber:e.articleNumber,pageType:page.pageType,branch:page.branch});
    parent.set(alias,root(pageKeys.get(page.id)));
    extraAliases.set(page.id,[...(extraAliases.get(page.id)||[]),alias]);
  }
  // Preserve only the exact previous work IDs demonstrably misassigned by
  // a publisher topic-tag collision. This is a migration ledger, NOT a
  // general rule that bare 'pig' means Pig Latin. Do not hijack an alias
  // belonging to a genuine Pig Latin article in this or a later snapshot.
  const byUrl=new Map(pages.map(p=>[p.url,p]));
  for(const [url,legacyKey] of legacyEnglishTopicPigAliases) {
    const page=byUrl.get(url);if(!page)continue;
    const record=sources.get(page.id)?.record;
    if(!record)continue; // Test fixtures without a historical capture do not need migration.
    const tags=(record.tags||[]).map(t=>String(t).toLowerCase());
    if(page.siteBranch!=='en'||page.branch!=='en'||
       tags.includes('_pig')||![0,8,9].includes(page.kindIndex))
      throw Error('Invalid source evidence for legacy topic-tag alias: '+url);
    const key=pageKeys.get(page.id);
    if(!key)throw Error('Lost owner for legacy topic-tag alias '+url);
    const owner=root(key);
    if(parent.has(legacyKey)&&root(legacyKey)!==owner)
      throw Error('Historical topic-tag alias collides with a real publisher work: '+legacyKey);
    const entry=(eligibleByPage.get(page.id)||[])[0];
    if(!entry)throw Error('No catalog row for legacy topic-tag alias '+url);
    if(!parent.has(legacyKey)){
      ledger.set(legacyKey,{articleId:entry.itemId,articleNumber:entry.articleNumber,
        pageType:page.pageType,branch:page.branch});
      parent.set(legacyKey,owner);
    }
    extraAliases.set(page.id,[...(extraAliases.get(page.id)||[]),legacyKey]);
  }
  const publisherReviewed=reviewedRepair({
    pages,sources,pageKeys,parent,root,components,nativeKeys,proofs:identityProofs
  });
  const groups = new Map();
  for (const page of pages) {
    const key = root(pageKeys.get(page.id));
    pageKeys.set(page.id, key);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(page);
  }
  const nodes = [];
  for (const [key, versions] of groups) {
    const info = ledger.get(key);
    versions.sort((a, b) => Number(native(b)&&b.branch === (info?.branch || b.branch)) -
      Number(native(a)&&a.branch === (info?.branch || a.branch)) ||
      Number(b.coverage === 'fetched') - Number(a.coverage === 'fetched') || a.id.localeCompare(b.id, 'en'));
    const representative = versions[0];
    const pageVersions = versions.map(p => [p.siteBranch, p.url, p.slug,
      p.catalogTitle || p.title || p.slug, p.coverage]);
    nodes.push({ ...representative, id: key, articleId: info?.articleId || '', articleNumber: info?.articleNumber,
      branch: info?.branch || representative.branch,
      pageType: info?.pageType || representative.pageType,
      title: representative.catalogTitle || representative.title,
      coverage: versions.some(p => p.coverage === 'fetched') ? 'fetched' : representative.coverage,
      workKeys: [...new Set(versions.flatMap(p => [...(catalogEntries.get(p.id) || []).map(e => `catalog:${e.pageType}:${e.itemId}`),...(extraAliases.get(p.id)||[])]).filter(k => ledger.has(k) && root(k) === key))].sort(),
      versions: pageVersions });
  }
  nodes.sort((a, b) => a.id.localeCompare(b.id, 'en'));

  const relations = new Map();
  let internalReferences = 0;
  for (const edge of candidates) {
    const source = pageKeys.get(edge.source), target = pageKeys.get(edge.target);
    if (!source || !target) throw Error('Unknown work endpoint');
    if (source === target) { internalReferences++; continue; }
    const key = `${source}\0${edge.type}\0${target}`;
    if (!relations.has(key)) relations.set(key, { source, target, type: edge.type, proofs: new Map() });
    relations.get(key).proofs.set(JSON.stringify(edge.proof), edge.proof);
  }
  const ambiguousWorkKeys=[...keyClaims].filter(([,claims])=>claims.size>1).map(([key])=>key).sort();
  // A classification repair keeps raw IDs even when their pageType changes.
  // Track reuse across all resulting works, including non-SCP categories.
  const rawOwners=new Map();
  for(const [pageId,entries]of catalogEntries){
    const work=pageKeys.get(pageId);if(!work)continue;
    for(const entry of entries){
      if(!entry.itemId)continue;
      if(!rawOwners.has(entry.itemId))rawOwners.set(entry.itemId,new Set());
      rawOwners.get(entry.itemId).add(work);
    }
  }
  const ambiguousArticleIds=[...new Set([
    ...ambiguousWorkKeys.map(key=>key.slice(key.indexOf(':',8)+1)),
    ...[...rawOwners].filter(([,owners])=>owners.size>1).map(([id])=>id),
  ])].sort();
  return { nodes, identityProofs, identityReview, publisherReviewed, ambiguousWorkKeys, ambiguousArticleIds, sourcePageCount: pages.filter(p => !p.classificationSourceId).length, internalReferences,
    relations: [...relations.values()].map(e => ({ ...e, proofs: [...e.proofs].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([, proof]) => proof) }))
      .sort((a, b) => `${a.source}\0${a.type}\0${a.target}`.localeCompare(`${b.source}\0${b.type}\0${b.target}`, 'en')) };
}
module.exports = { collapseWorks };
