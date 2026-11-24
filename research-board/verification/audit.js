'use strict';
// Read-only independent audit of a published research-board revision.
const fs=require('node:fs'),path=require('node:path'),z=require('node:zlib'),crypto=require('node:crypto');
const axios=require('axios');
const {readSources}=require('../source-store'); // SHA / timestamps only; never use recorded links as ground truth.
const {normalizedUrl,fromHtml,fromFtml}=require('./reference');

const ROOT=path.resolve(__dirname,'../..');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const hashScore=(seed,url)=>sha(seed+':'+url);
const compact=val=>String(val??'').replace(/[\r\n\t]+/g,' ').slice(0,450);
const PROFILES=[
  ['representative',250],['zero_links',50],['high_degree',50],
  ['translations',50],['unusual_structure',50],['identity_risk',50]
];

function loadBoard(root=ROOT){
  const folder=path.join(root,'local-data/mobile-v3/research-board');
  const manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8'));
  const raw=fs.readFileSync(path.join(folder,manifest.fileName));
  if(raw.length!==manifest.bytes||sha(raw)!==manifest.sha256)throw Error('Invalid published board checksum');
  const board=JSON.parse(z.gunzipSync(raw));
  if(board.revision!==manifest.revision)throw Error('Board revision mismatch');
  return {board,manifest};
}
function loadCoverage(root=ROOT) {
  const input=path.join(root,'local-data');
  return require('../link-coverage').buildCoverage(
    require('../catalog').loadCatalogs(input),readSources(path.join(input,'research-board-sources')));
}
function buildIndex(board){
  const workByUrl=new Map(),pageNode=new Map(),pages=[];
  for(const node of board.nodes) {
    const workId=node[14][0];
    for(const version of node[13]){
      const url=normalizedUrl(version[1]);
      if(!url)continue;
      if(workByUrl.has(url)&&workByUrl.get(url)!==workId)throw Error('Ambiguous owner for '+url);
      workByUrl.set(url,workId);pageNode.set(url,node);
      pages.push({url,language:version[0],kind:node[3],workId,versions:node[13].length,
        slug:version[2],expected:new Set(),review:false});
    }
  }
  const byUrl=new Map(pages.map(p=>[p.url,p]));
  const types=board.overview.types;
  for(const edge of board.edges){
    if(types[edge[2]]!=='references')continue;
    const to=board.nodes[edge[1]][14][0];
    for(const idx of edge[4]){
      const proof=board.proofs[idx];
      const page=byUrl.get(normalizedUrl(proof[0]));
      if(page)page.expected.add(to);
    }
  }
  for(const r of board.identityReview||[]){
    for(const url of [r.url,r.original,r.source,r.target]){
      const page=byUrl.get(normalizedUrl(url));
      if(page)page.review=true;
    }
  }
  return {pages,workByUrl,supportedHosts:new Set([...workByUrl.keys()].map(u=>new URL(u).hostname))};
}
function sorted(pool,seed) {
  return pool.sort((a,b)=>hashScore(seed,a.url).localeCompare(hashScore(seed,b.url)));
}
function allocate(limit) {
  const weights=PROFILES.map(([name,count])=>({name,raw:count*limit/500}));
  const allocations=Object.fromEntries(weights.map(x=>[x.name,Math.floor(x.raw)]));
  let remaining=limit-Object.values(allocations).reduce((a,b)=>a+b,0);
  for(const x of weights.sort((a,b)=>(b.raw-Math.floor(b.raw))-(a.raw-Math.floor(a.raw)))) {
    if(remaining--<=0)break;
    allocations[x.name]++;
  }
  return allocations;
}
function samplePages(index,{limit=500,seed='2026-11-19-initial',excluded=new Set(),excludedLanguages=new Set()}={}){
  if(!Number.isSafeInteger(limit)||limit<1||limit>5000)throw Error('Invalid sample limit');
  const eligible=index.pages.filter(p=>!excluded.has(p.url)&&!excludedLanguages.has(p.language)),selected=[],chosen=new Set();
  const allocation=allocate(limit);
  function take(name,candidates,n){
    const pool=sorted(candidates.filter(p=>!chosen.has(p.url)),seed+' '+name);
    for(const p of pool.slice(0,n)){
      selected.push({...p,profile:name});chosen.add(p.url);
    }
  }
  // Guarantee representation of small branches before proportional global sampling.
  const groups=Object.groupBy(eligible,p=>p.language);
  let representative=allocation.representative;
  for(const language of Object.keys(groups).sort()){
    const quota=Math.min(representative>=Object.keys(groups).length*2?2:1,representative);
    if(!quota)break;
    take('representative',groups[language],quota);representative-=quota;
  }
  take('representative',eligible,representative);
  take('zero_links',eligible.filter(p=>p.expected.size===0),allocation.zero_links);
  // Highest degree pages have more opportunities for false positives.
  const high=eligible.filter(p=>p.expected.size>=3).sort((a,b)=>b.expected.size-a.expected.size||
    hashScore(seed,a.url).localeCompare(hashScore(seed,b.url)));
  for(const p of high) {
    if(selected.filter(s=>s.profile==='high_degree').length>=allocation.high_degree)break;
    if(!chosen.has(p.url)){selected.push({...p,profile:'high_degree'});chosen.add(p.url);}
  }
  take('translations',eligible.filter(p=>p.versions>1),allocation.translations);
  take('unusual_structure',eligible.filter(p=>p.language==='ru'||p.kind!==0||
    /(?:log|experiment|hub|tale|chapter|fragment|record|appendix|incident)/i.test(p.slug)),allocation.unusual_structure);
  take('identity_risk',eligible.filter(p=>p.review),allocation.identity_risk);
  // Lack of any risk-stratum candidates must never silently reduce sample size.
  take('fallback',eligible,Math.max(0,Math.min(limit,eligible.length)-selected.length));
  return {requested:limit,allocations:allocation,pages:selected.slice(0,limit)};
}
function parseArgs(args=process.argv.slice(2)){
  const options={limit:500,seed:'2026-11-19-initial',out:'audit-results',inventory:false,
    exclude:null,includeRu:true,urls:[],requestDelayMs:1250,timeoutMs:20000};
  for(let i=0;i<args.length;i++){
    const v=args[i],next=()=>args[++i];
    if(v==='--limit')options.limit=Number(next());
    else if(v==='--seed')options.seed=next();
    else if(v==='--out')options.out=next();
    else if(v==='--exclude')options.exclude=next();
    else if(v==='--inventory')options.inventory=true;
    else if(v==='--include-ru')options.includeRu=true;
    else if(v==='--exclude-ru')options.includeRu=false;
    else if(v==='--url')options.urls.push(next());
    else if(v==='--delay-ms')options.requestDelayMs=Number(next());
    else throw Error('Unknown argument '+v);
  }
  if(!Number.isSafeInteger(options.limit)||options.limit<1||options.limit>5000)throw Error('Invalid --limit');
  if(!Number.isFinite(options.requestDelayMs)||options.requestDelayMs<1000)throw Error('Request delay must be >=1000ms');
  return options;
}
function csv(items,fields){
  const quote=value=>'"'+String(value??'').replace(/"/g,'""')+'"';
  return [fields.map(quote).join(','),...items.map(item=>fields.map(field=>quote(item[field])).join(','))].join('\n')+'\n';
}
function safeWrite(file,data){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file+'.tmp',data);fs.renameSync(file+'.tmp',file);
}
function makeInventory(coverage,out){
  const unresolved=coverage?.unresolved||[];
  const rows=unresolved.map(r=>({url:r.url,language:r.language,reason:r.reason,retryAfter:r.retryAfter||''}));
  safeWrite(path.join(out,'unresolved-pages.csv'),csv(rows,['url','language','reason','retryAfter']));
  const totals={};
  for(const row of rows) totals[row.reason]=(totals[row.reason]||0)+1;
  return {totalPages:coverage?.totalPages??null,checkedPages:coverage?.checkedPages??null,
    pendingPages:coverage?.pendingPages??null,unresolvedByReason:totals,
    unavailableSandboxPages:rows.filter(r=>r.reason==='unavailable'&&/\/sandbox:/i.test(r.url)).length};
}
function recordState(sources,url){
  const id='page:'+normalizedUrl(url).slice('https://'.length);
  return sources.get(id)||null;
}
function asyncClock(delayMs){
  let previous=0;
  return async()=>{
    const sleepFor=Math.max(0,previous+delayMs-Date.now());
    if(sleepFor)await sleep(sleepFor);
    previous=Date.now();
  };
}
function isAllowedTarget(url,supportedHosts){
  try {const u=new URL(url);return ['http:','https:'].includes(u.protocol)&&
    !u.username&&!u.password&&!u.port&&supportedHosts.has(u.hostname.toLowerCase());}
  catch(_){return false;}
}
async function networkCapture(page,supportedHosts,gate,timeoutMs=20000){
  const base=page.url;
  if(page.language==='ru'){
    const target='https://scpfoundation.net/api/articles/'+encodeURIComponent(new URL(base).pathname.slice(1));
    await gate();
    const res=await axios.get(target,{timeout:timeoutMs,maxRedirects:0,maxContentLength:12*1024*1024,
      headers:{Accept:'application/json','User-Agent':'SCPReaderCatalog/1.0'}});
    if(!res.data||typeof res.data.source!=='string')throw Error('invalid_ru_api_response');
    return {content:res.data.source,detail:res.data,sha:sha(JSON.stringify(res.data)),format:'ftml'};
  }
  let next=base, lastError;
  for(let attempt=0;attempt<2;attempt++){
    const seen=new Set();
    for(let hop=0;hop<5;hop++){
      if(!isAllowedTarget(next,supportedHosts)||seen.has(next))throw Error('unsafe_or_circular_redirect');
      seen.add(next);
      try{
        await gate();
        const res=await axios.get(next,{timeout:timeoutMs,maxRedirects:0,maxContentLength:12*1024*1024,
          responseType:'text',validateStatus:s=>s>=200&&s<400,
          headers:{Accept:'text/html','User-Agent':'SCPReaderCatalog/1.0'}});
        if(res.status>=300){
          const location=res.headers.location;
          if(!location)throw Error('redirect_without_location');
          next=new URL(location,next).href;
          continue;
        }
        if(typeof res.data!=='string'||res.data.length<150)throw Error('invalid_html_response');
        return {content:res.data,sha:sha(res.data),format:'html'};
      }catch(error){lastError=error;break;}
    }
    // Some Wikidot sites do not support TLS; never switch to a different host.
    if(attempt===0)next=base.replace(/^https:/,'http:');
  }
  throw lastError||Error('request_exhausted');
}
function compare(expected,actual){
  const expectedSet=new Set(expected),actualSet=new Set(actual);
  return {tp:[...actualSet].filter(x=>expectedSet.has(x)),
    fp:[...expectedSet].filter(x=>!actualSet.has(x)), // Published but not independently observed.
    fn:[...actualSet].filter(x=>!expectedSet.has(x))}; // Observed but missing from published board.
}
function detailFor(page,group,workId,link){
  return {sourceUrl:page.url,language:page.language,profile:page.profile,sourceWork:page.workId,
    targetWork:workId,result:group,href:link?.href||'',quote:link?.quote||'',
    selector:link?.selector||'',sourceElement:link?.sourceElement||''};
}
async function run(options=parseArgs()){
  const out=path.resolve(ROOT,options.out);
  fs.mkdirSync(out,{recursive:true});
  const coverage=loadCoverage(),inventory=makeInventory(coverage,out);
  if(options.inventory){
    safeWrite(path.join(out,'inventory.json'),JSON.stringify(inventory,null,2)+'\n');
    return {inventory};
  }
  const {board,manifest}=loadBoard();
  const index=buildIndex(board),sources=readSources(path.join(ROOT,'local-data/research-board-sources'));
  let excludes=new Set();
  if(options.exclude){
    const prior=JSON.parse(fs.readFileSync(path.resolve(options.exclude),'utf8'));
    excludes=new Set((prior.samples||[]).map(p=>p.url));
  }
  const excludedLanguages=options.includeRu?new Set():new Set(['ru']);
  let plan;
  if(options.urls.length){
    const wanted=new Set(options.urls.map(value=>normalizedUrl(value)));
    if(wanted.has(null)||wanted.size!==options.urls.length)throw Error('Invalid or duplicate --url');
    const pages=index.pages.filter(page=>wanted.has(page.url)&&!excludedLanguages.has(page.language));
    if(pages.length!==wanted.size)throw Error('Targeted URL missing from catalog or excluded');
    plan={requested:options.urls.length,allocations:{targeted:pages.length},
      pages:pages.map(page=>({...page,profile:'targeted'}))};
  }else plan=samplePages(index,{limit:options.limit,seed:options.seed,excluded:excludes,excludedLanguages});
  const samples=[],differences=[],gate=asyncClock(options.requestDelayMs),blockedHosts=new Set();
  const counters={sampled:plan.pages.length,fetched:0,unchanged:0,contentChanged:0,fetchFailed:0,
    noSnapshot:0,matched:0,mismatched:0,tp:0,fp:0,fn:0,outsideCatalog:0,
    ignoredNavigation:0,warnings:0,liveTp:0,liveFp:0,liveFn:0,liveMatched:0,liveMismatched:0};
  for(let i=0;i<plan.pages.length;i++){
    const page=plan.pages[i],previous=recordState(sources,page.url),host=new URL(page.url).hostname;
    const row={url:page.url,language:page.language,profile:page.profile,workId:page.workId,
      expectedCount:page.expected.size,checkedAt:previous?.record?.checkedAt||null,
      snapshotSha:previous?.record?.contentSha256||null,status:null,actualCount:null,
      fp:0,fn:0,warning:[],detail:''};
    try{
      if(blockedHosts.has(host))throw Error('host_rate_limited_earlier');
      const capture=await networkCapture(page,index.supportedHosts,gate,options.timeoutMs);
      counters.fetched++;row.currentSha=capture.sha;
      const parsed=capture.format==='ftml'?
        fromFtml(capture.content,page.url,index.workByUrl,index.supportedHosts,capture.detail?.title):
        fromHtml(capture.content,page.url,index.workByUrl,index.supportedHosts);
      const delta=compare(page.expected,parsed.links.keys());
      row.actualCount=parsed.links.size;row.fp=delta.fp.length;row.fn=delta.fn.length;
      row.liveMatch=delta.fp.length===0&&delta.fn.length===0;
      counters.liveTp+=delta.tp.length;counters.liveFp+=delta.fp.length;counters.liveFn+=delta.fn.length;
      counters[row.liveMatch?'liveMatched':'liveMismatched']++;
      row.warning=parsed.warnings;row.ignored=parsed.counts;
      counters.warnings+=parsed.warnings.length;
      counters.outsideCatalog+=parsed.counts.outside_catalog||0;
      counters.ignoredNavigation+=parsed.counts.auxiliary_content||0;
      if(!row.snapshotSha) {row.status='no_snapshot';counters.noSnapshot++;}
      else if(row.snapshotSha!==capture.sha){row.status='content_changed';counters.contentChanged++;}
      else {
        row.status=delta.fp.length||delta.fn.length?'mismatch':'match';
        counters.unchanged++;counters.tp+=delta.tp.length;
        counters.fp+=delta.fp.length;counters.fn+=delta.fn.length;
        counters[row.status==='match'?'matched':'mismatched']++;
      }
      if(delta.fp.length||delta.fn.length) {
        const kind=row.status==='content_changed'?'changed_since_capture':
          row.status==='no_snapshot'?'unknown_snapshot':null;
        for(const work of delta.fp)differences.push(detailFor(page,kind||'false_positive',work,null));
        for(const work of delta.fn)differences.push(detailFor(page,kind||'false_negative',work,parsed.links.get(work)?.[0]));
      }
      for(const c of parsed.all.filter(c=>c.reason==='outside_catalog').slice(0,100))
        differences.push({...detailFor(page,'outside_catalog',null,c),targetUrl:c.targetUrl});
    }catch(error){
      row.status='fetch_error';row.detail=compact(error.message);counters.fetchFailed++;
      if(error.response?.status===429)blockedHosts.add(host);
    }
    samples.push(row);
    if((i+1)%25===0||i+1===plan.pages.length){
      console.log(JSON.stringify({completed:i+1,total:plan.pages.length,matched:counters.matched,
        mismatched:counters.mismatched,changed:counters.contentChanged,failed:counters.fetchFailed}));
      safeWrite(path.join(out,'partial-progress.json'),JSON.stringify({counters,samples},null,2)+'\n');
    }
  }
  const precisionDen=counters.tp+counters.fp,recallDen=counters.tp+counters.fn;
  const metrics={precision:precisionDen?counters.tp/precisionDen:null,
    recall:recallDen?counters.tp/recallDen:null,
    precisionDenominator:precisionDen,recallDenominator:recallDen};
  const livePrecisionDen=counters.liveTp+counters.liveFp,liveRecallDen=counters.liveTp+counters.liveFn;
  const liveMetrics={precision:livePrecisionDen?counters.liveTp/livePrecisionDen:null,
    recall:liveRecallDen?counters.liveTp/liveRecallDen:null,
    precisionDenominator:livePrecisionDen,recallDenominator:liveRecallDen};
  const result={schemaVersion:1,generatedAt:new Date().toISOString(),revision:board.revision,
    manifestSha256:manifest.sha256,seed:options.seed,requested:plan.requested,
    excludedLanguages:[...excludedLanguages],allocations:plan.allocations,
    inventory,counters,metrics,liveMetrics,samples};
  safeWrite(path.join(out,'audit.json'),JSON.stringify(result,null,2)+'\n');
  safeWrite(path.join(out,'differences.csv'),csv(differences,['sourceUrl','language','profile','sourceWork',
    'targetWork','result','targetUrl','href','quote','selector','sourceElement']));
  const md=['# Research board independent verification',
    '',
    '- Revision: '+board.revision,
    '- Sample requested: '+plan.requested+' (seed: '+options.seed+')',
    '- Excluded languages: '+([...excludedLanguages].join(', ')||'none'),
    '- Live fetched: '+counters.fetched,
    '- Unchanged content, comparable: '+counters.unchanged,
    '- Changed content (not scored): '+counters.contentChanged,
    '- Fetch failures (not scored): '+counters.fetchFailed,
    '- No saved snapshot (not scored): '+counters.noSnapshot,
    '- True positive edges: '+counters.tp,
    '- False positive edges: '+counters.fp,
    '- False negative edges: '+counters.fn,
    '- Precision: '+(metrics.precision===null?'N/A':(100*metrics.precision).toFixed(2)+'%'),
    '- Recall: '+(metrics.recall===null?'N/A':(100*metrics.recall).toFixed(2)+'%'),
    '- Live matching pages (including hash-changed pages): '+counters.liveMatched+' / '+counters.fetched,
    '- Live disagreement pages: '+counters.liveMismatched,
    '- Live edge precision (time drift possible): '+(liveMetrics.precision===null?'N/A':(100*liveMetrics.precision).toFixed(2)+'%'),
    '- Live edge recall (time drift possible): '+(liveMetrics.recall===null?'N/A':(100*liveMetrics.recall).toFixed(2)+'%'),
    '- Links to catalog-absent pages (diagnostic, not false negatives): '+counters.outsideCatalog,
    '- Unresolved source pages in coverage snapshot: '+inventory.pendingPages,
    '- Unavailable sandbox: URLs among them: '+inventory.unavailableSandboxPages,
    '',
    'Strict precision/recall are computed ONLY on pages with byte-identical source snapshots.',
    'Live agreement compares current public pages to saved graph edges and is NOT a historical accuracy guarantee.',
    'The full-page SHA may change due to global page chrome even when article links are unchanged.',
    'These are sample diagnostics, not whole-corpus accuracy or a confidence interval.',
    'A matching link parser is not proof that the site renders exactly the same content to every viewer.',
    '',
    'Coverage inventory remains global; excluding RU from the audit does not remove its unresolved URLs.',
    'See audit.json (page classifications), differences.csv (evidence), unresolved-pages.csv (coverage).'];
  safeWrite(path.join(out,'SUMMARY.md'),md.join('\n')+'\n');
  if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,md.join('\n')+'\n');
  return {inventory,excludedLanguages:[...excludedLanguages],counters,metrics,liveMetrics,output:out};
}
if(require.main===module)run().then(summary=>console.log(JSON.stringify(summary,null,2)))
  .catch(e=>{console.error(e);process.exitCode=1;});
module.exports={loadBoard,loadCoverage,buildIndex,allocate,samplePages,compare,parseArgs,csv,networkCapture,run};
