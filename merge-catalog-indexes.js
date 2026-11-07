'use strict';
const { articleCategory } = require('./article-category');
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const { LANGUAGES } = require('./languages');
const { readState, writeState, eligibleRecord, isExcluded } = require('./catalog-indexes');
const { readCatalogs, normalize, classify } = require('./related-documents');
const { branchForPageType } = require('./article-origin');
const { buildEntries, variantSlugPart, stringifyAsciiSafe } = require('./local-crawler');
const { deduplicateArticles } = require('./catalog-identity');

function identity(slug, pageType) { return pageType + ':' + variantSlugPart('/' + slug, pageType); }
function scpIdentity(page, record, origin, known) {
  const m = /^scp-(?:([a-z]+)-)?(\d+)(?:-(.*))?$/.exec(page.slug);
  if (!m) return null;
  const tokens = (m[3] || '').split('-').filter(Boolean);
  const branches = new Set(['en','zh','sk',...Object.keys(LANGUAGES)]);
  const simple = !tokens.some(t => !branches.has(t) && !['j','ex'].includes(t));
  if (!simple && !(record.tags || []).includes('scp')) return null;
  const branch = m[1] || tokens.find(t => branches.has(t)) || 'en';
  if (branch === 'id' || !branches.has(branch)) return null;
  const family = tokens.includes('j') ? 'joke-scps' : tokens.includes('ex') ? 'scp-ex' : 'scp-series';
  const pageType = branch === 'en' ? family : family === 'scp-ex' ? `scp-${branch}-ex` : `${family}-${branch}`;
  const ids = known.get(identity(page.slug,pageType));
  const native=[...(ids?.nativeIds||[])];
  const canonical=[...(ids||[])].filter(id=>id.startsWith(pageType+'-'));
  if (ids?.size > 1 && native.length !== 1 && canonical.length !== 1) throw Error('Ambiguous existing SCP identity: '+page.slug);
  const itemId = native.length===1 ? native[0] : canonical.length===1 ? canonical[0] : ids?.size ? [...ids][0] : !simple ? `${pageType}-${variantSlugPart('/'+page.slug,pageType)}` :
    buildEntries([{ href:'/'+page.slug,scpNumber:m[2],title:record.title,isUnwritten:false }],{ pageType })[0].itemId;
  return { itemId, pageType, numericItemId:Number(m[2]), originBranch:branch };
}
function buildIndexedCatalog(catalogs, states, previous = { data: [] }, now = new Date().toISOString()) {
  const seeds = new Map(), known = new Map();
  for (const row of catalogs) {
    const page = normalize(row.isTranslatedJP !== false && row.urlJP ? row.urlJP : row.urlEN);
    if (!page) continue;
    if (!seeds.has(page.url)) seeds.set(page.url,[]);
    seeds.get(page.url).push(row);
    if (!row.itemId || !branchForPageType(row.pageType)) continue;
    const key = identity(page.slug,row.pageType);
    if (!known.has(key)) known.set(key,new Set()); known.get(key).add(row.itemId);
    const branch=branchForPageType(row.pageType),site=row.language==='zh-tr'?'zh':row.language;
    if(site===branch||(site==='cs'&&branch==='sk')){known.get(key).nativeIds ||= new Set();known.get(key).nativeIds.add(row.itemId);}
  }
  const previousByUrl = new Map(previous.data.map(r => [r.url,r]));
  const data = [], pending = [], removed = new Set(), progress = {}, markedMissing = new Map();
  function indexes(state){
    const rejected=new Set((state.discoveredIndexes||[]).filter(s=>isExcluded(s.url,state.records[s.url]?.tags||[])).map(s=>s.url));
    return Object.values(state.indexes).filter(s=>!rejected.has(s.root));
  }
  // Collect absence before emitting any row, so duplicate listings cannot make
  // removal depend on object/iteration order.
  for(const state of Object.values(states))for(const index of indexes(state))for(const url of index.missing||[]){
    markedMissing.set(url,Math.max(markedMissing.get(url)||0,Date.parse(index.at)||0));
  }
  for(const [url,at]of markedMissing){
    const state=states[normalize(url)?.language],record=state?.records[url];
    if(!eligibleRecord(record)||Date.parse(record.checkedAt)<at)removed.add(url);
  }
  for(const state of Object.values(states))for(const [url,a]of Object.entries(state.attempts))if(a.status==='unavailable')removed.add(url);
  for (const [language,state] of Object.entries(states)) {
    const allRecords = new Map(Object.entries(state.records));
    const memberships = new Map();
    for (const index of indexes(state)) {
      for (const m of index.members || []) {
        if (!memberships.has(m.url)) memberships.set(m.url,[]);
        memberships.get(m.url).push(m);
      }
    }
    for (const [url,evidence] of memberships) {
      if (removed.has(url)) continue;
      const record = state.records[url], page = normalize(url);
      if (!page || page.language !== language) throw Error('Cross-language index member');
      if ((seeds.get(url)||[]).some(r=>r.language===language && r.isTranslatedJP!==false)) continue;
      if (!eligibleRecord(record)) {
        const sourceIndexUrls=[...new Set(evidence.map(e=>e.source))];
        pending.push({url,language,sourceIndexUrls,status:state.attempts[url]?.status||'pending'});
        const prior=previousByUrl.get(url);
        // Preserve an already published article only when it is actually listed
        // in the new official scope. Old one-hop membership alone is insufficient.
        if(prior && prior.language===language && !isExcluded(url,prior.tags||[]))data.push({...prior,contentType:!prior.pageType || prior.pageType.startsWith('related-document-') ? articleCategory(prior,evidence,url) : 'scp',sourceArticleIds:[],sourceIndexUrls,indexEvidence:evidence,fetchStatus:'stale'});
        continue;
      }
      if (isExcluded(url,record.tags)) continue;
      if (/^scp-id-|^scp-\d+-id(?:-|$)/.test(page.slug) || (record.tags || []).some(t=>['id','филиал:id'].includes(t))) continue;
      const origins = [...new Set(evidence.map(e=>e.origin).filter(Boolean))];
      const fallback = classify(url,allRecords,seeds);
      const branch = origins.length === 1 ? origins[0] : origins.length > 1 ? null : fallback.branch;
      if (branch === 'id') continue;
      const scp = scpIdentity(page,record,branch,known);
      const contentType = scp ? 'scp' : articleCategory(record,evidence,url);
      const prior = previousByUrl.get(url);
      data.push({ itemId:prior?.itemId || scp?.itemId || `document-${language}--${page.slug}`, url,language,title:record.title,
        contentType,pageType:scp?.pageType || (branch ? `related-document-${branch}` : 'related-document-unclassified'),
        numericItemId:scp?.numericItemId,originBranch:scp?.originBranch || branch,
        classification:{branch:scp?.originBranch || branch,basis:origins.length ? 'official_index_section' : fallback.basis,evidence:origins},
        sourceArticleIds:[],sourceIndexUrls:[...new Set(evidence.map(e=>e.source))].sort(),indexEvidence:evidence,
        tags:record.tags||[],authors:record.authors||[],descriptionExcerpt:record.descriptionExcerpt||'',
        objectClass:record.objectClass,rating:record.rating,imageUrl:record.imageUrl,
        contentSha256:record.contentSha256,lastUpdated:record.checkedAt,fetchStatus:state.attempts[url]?.status==='failed'?'stale':'success' });
    }
    progress[language] = { ...state.statistics, listed:memberships.size, indexedAt:state.updatedAt };
  }
  // A failed/missing matrix job must not remove another language's last catalog.
  const publishedUrls=new Set(data.map(r=>r.url));
  for (const row of previous.data) {
    const state=states[row.language];
    const incomplete=!state || !Object.keys(state.indexes||{}).length;
    if(incomplete && !removed.has(row.url) && !publishedUrls.has(row.url) && !isExcluded(row.url,row.tags||[])) data.push(row);
  }
  data.sort((a,b)=>a.url.localeCompare(b.url));
  const byWork=new Map();
  for(const row of data){const key=row.language+':'+row.itemId;const prior=byWork.get(key);
    if(!prior)byWork.set(key,row);else prior.sourceIndexUrls=[...new Set([...(prior.sourceIndexUrls||[]),...(row.sourceIndexUrls||[])])].sort();}
  const unique=[...byWork.values()];
  return {schemaVersion:1,scope:'official_indexes',timestamp:now,totalCount:unique.length,data:unique,pending,
    statistics:{listed:Object.values(progress).reduce((n,p)=>n+p.listed,0),available:unique.length,pending:pending.length,unavailable:removed.size,languages:progress},removed:[...removed]};
}
function merge(root = __dirname, now = new Date().toISOString()) {
  const base = path.join(root,'local-data'), partial = path.join(root,'partial-data/catalog-indexes');
  const catalogs = readCatalogs(base), states = {};
  for (const language of Object.keys(LANGUAGES)) {
    const incoming = path.join(partial,language+'.json.gz'), committed = path.join(base,'catalog-indexes',language+'.json.gz');
    if (fs.existsSync(incoming)) {
      const state = readState(incoming);
      if (state.language !== language) throw Error('Wrong index state language');
      writeState(committed,state);
    }
    if (fs.existsSync(committed)) {const state=readState(committed);if(Object.keys(state.indexes||{}).length)states[language]=state;}
  }
  if (!Object.keys(states).length) throw Error('No official-index crawl results');
  const previousFile=path.join(base,'related-documents/catalog.json.gz');
  const previous=fs.existsSync(previousFile)?JSON.parse(zlib.gunzipSync(fs.readFileSync(previousFile))):{data:[]};
  const result=buildIndexedCatalog(catalogs,states,previous,now), removed=new Set(result.removed);
  // Prune explicit missing pages and old untranslated placeholders from both
  // legacy JSON and the v1/v2 gzip inputs. User state lives in the app, not here.
  const pruned={};
  for (const language of Object.keys(LANGUAGES)) {
    const file=path.join(base,language,'scp-data.json');if(!fs.existsSync(file))continue;
    const source=JSON.parse(fs.readFileSync(file));
    const data=source.data.filter(r=>r.isTranslatedJP!==false&&!removed.has(normalize(r.urlJP||r.urlEN)?.url));
    pruned[language]=source.data.length-data.length;
    if(!pruned[language])continue;
    source.data=deduplicateArticles(data,language);source.totalCount=source.data.length;source.timestamp=now;
    source.statistics={...(source.statistics||{}),translated:data.length,untranslated:0,withImage:data.filter(r=>r.imageUrl).length};
    const metaFile=path.join(base,language,'meta.json'),meta=JSON.parse(fs.readFileSync(metaFile));
    Object.assign(meta,{lastUpdated:now,totalCount:source.totalCount,statistics:source.statistics});
    fs.writeFileSync(file+'.tmp',stringifyAsciiSafe(source));fs.renameSync(file+'.tmp',file);
    fs.writeFileSync(metaFile+'.tmp',stringifyAsciiSafe(meta));fs.renameSync(metaFile+'.tmp',metaFile);
    if(language==='jp'){fs.writeFileSync(path.join(base,'scp-data.json'),stringifyAsciiSafe(source));fs.writeFileSync(path.join(base,'meta.json'),stringifyAsciiSafe(meta));}
  }
  delete result.removed;
  require('./merge-data').addTranslatedLanguages(base,Object.keys(LANGUAGES));
  fs.mkdirSync(path.dirname(previousFile),{recursive:true});
  fs.writeFileSync(previousFile+'.tmp',zlib.gzipSync(JSON.stringify(result),{level:9}));fs.renameSync(previousFile+'.tmp',previousFile);
  // Do not let an obsolete human-readable file shadow the new gzip input.
  fs.writeFileSync(path.join(base,'related-documents/catalog.json'),JSON.stringify(result));
  console.log(JSON.stringify({statistics:result.statistics,pruned}));return result;
}
if(require.main===module)merge();
module.exports={buildIndexedCatalog,merge,scpIdentity};
