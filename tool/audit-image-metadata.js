'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const axios=require('axios'),{JSDOM,VirtualConsole}=require('jsdom');
const {LANGUAGES}=require('../languages');
const {normalize}=require('../related-documents');
const {readState,writeState}=require('../catalog-indexes');
const {decorativeImageReason,cleanImage}=require('../image-policy');
const {extractImageUrlFromDocument,stringifyAsciiSafe}=require('../local-crawler');
const equivalent=value=>String(value||'').replace(/^http:/,'https:');
const urlOf=row=>normalize(row.urlJP||row.urlEN||row.url)?.url;
const identityDigest=rows=>crypto.createHash('sha256').update(JSON.stringify(rows.map(r=>[r.itemId,urlOf(r)]).sort((a,b)=>a[0].localeCompare(b[0])))).digest('hex');
function suspectReasons(row,variants){
 const reasons=[];
 if(decorativeImageReason(row.imageUrl))reasons.push('decorative');
 if(variants.has(row.pageType+':'+row.numericItemId))reasons.push('number_variant');
 try{
  const image=new URL(row.imageUrl),article=new URL(urlOf(row));
  const owner=/\/(?:local--files|local--resized-images)\/([^/]+)\//.exec(image.pathname);
  const slug=owner&&decodeURIComponent(owner[1]).toLowerCase();
  if(slug&&/^scp-(?:[a-z]+-)?\d/.test(slug)&&image.hostname.replace(/\.wdfiles\.com$/,'.wikidot.com')===article.hostname&&slug!==decodeURIComponent(article.pathname).slice(1).toLowerCase())reasons.push('different_attachment_owner');
 }catch{}
 return reasons;
}
function loadRows(root,language){
 const base=path.join(root,'local-data'),raw=path.join(base,language,'scp-data.json');
 if(!fs.existsSync(raw))return [];
 const rows=new Map(JSON.parse(fs.readFileSync(raw)).data.filter(r=>r.isTranslatedJP!==false).map(r=>[r.itemId,r]));
 const dir=path.join(base,'mobile-v3',language),pointer=path.join(dir,'manifest.json');
 if(fs.existsSync(pointer)){
  const m=JSON.parse(fs.readFileSync(pointer));
  if(!/^catalog-[a-f0-9]{64}\.json\.gz$/.test(m.fileName))throw Error('Invalid delivery pointer');
  for(const row of JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir,m.fileName)))).data)if(!rows.has(row.itemId))rows.set(row.itemId,row);
 }
 return [...rows.values()];
}
async function observeImage(url){
 const page=normalize(url);if(!page)throw Error('Unsupported image source');
 if(page.language==='ru'){
  const r=await axios.get('https://scpfoundation.net/api/articles/'+encodeURIComponent(page.slug),{timeout:25000,maxRedirects:0});
  if(typeof r.data?.source!=='string'||!r.data.source.trim())throw Error('Invalid Russian article source');
  return {imageUrl:require('../rufoundation-crawler').extractImageUrl(r.data.source,page.slug),sha256:crypto.createHash('sha256').update(r.data.source).digest('hex')};
 }
 let current=page.url;
 for(let depth=0;depth<6;depth++){
  const r=await axios.get(current,{timeout:25000,maxRedirects:0,maxContentLength:6*1024*1024,validateStatus:s=>s>=200&&s<400,headers:{'User-Agent':'SCPReaderImageAudit/1.0'}});
  if(r.status>=300){const next=normalize(new URL(r.headers.location,current).href);if(!next||next.language!==page.language)throw Error('Unsafe image-source redirect');current=next.url;continue;}
  const d=new JSDOM(String(r.data).replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,''),{virtualConsole:new VirtualConsole()});
  try{
   if(!require('../article-page').inspectArticlePage(d.window.document).usable)throw Error('Unavailable article body');
   return {imageUrl:extractImageUrlFromDocument(d.window.document,current),sha256:crypto.createHash('sha256').update(String(r.data)).digest('hex')};
  }finally{d.window.close();}
 }
 throw Error('Image-source redirect limit');
}
async function audit({root=path.join(__dirname,'..'),languages=Object.keys(LANGUAGES),request=observeImage,network=true,intervalMs=500,maxRequests=1200}={}){
 const result={schemaVersion:1,checkedAt:new Date().toISOString(),languages:[],patches:[],failures:[],pending:[]},queue=[];
 for(const language of languages){
  const rows=loadRows(root,language),stats={language,articles:rows.length,images:0,cached:0,decorative:0,network:0,unchanged:0,changes:0};
  stats.identitySha256=identityDigest(rows);result.languages.push(stats);
  const groups=new Map();
  for(const row of rows)if(Number.isInteger(row.numericItemId)){const key=row.pageType+':'+row.numericItemId;if(!groups.has(key))groups.set(key,new Set());groups.get(key).add(urlOf(row));}
  const variants=new Set([...groups].filter(([,urls])=>urls.size>1).map(([key])=>key));
  const file=path.join(root,'local-data/catalog-indexes',language+'.json.gz'),state=fs.existsSync(file)?readState(file):{records:{}};
  function patch(row,imageUrl,method,evidence){
   const afterImage=cleanImage(imageUrl);
   if(equivalent(row.imageUrl)===equivalent(afterImage)){stats.unchanged++;return;}
   result.patches.push({language,itemId:row.itemId,url:urlOf(row),beforeImage:row.imageUrl||null,afterImage,method,evidence});stats.changes++;
  }
  for(const row of rows){
   if(!row.imageUrl)continue;
   stats.images++;const url=urlOf(row);if(!url)continue;
   const record=state.records[url],reasons=suspectReasons(row,variants);
   const observedAt=Math.max(Date.parse(record?.imageCheckedAt)||0,Date.parse(record?.checkedAt)||0);
   const trusted=record?.contentSha256&&Object.hasOwn(record,'imageUrl')&&observedAt>0&&(!record.url||urlOf(record)===url)&&(!row.createdAt||observedAt>=Date.parse(row.createdAt))&&(!row.imageCheckedAt||observedAt>=Date.parse(row.imageCheckedAt));
   if(trusted&&record.imageUrl&&!decorativeImageReason(record.imageUrl)){
    stats.cached++;patch(row,record.imageUrl,'same_url_body_cache',{checkedAt:record.checkedAt,sha256:record.contentSha256});continue;
   }
   if(reasons.includes('decorative')){
    stats.decorative++;patch(row,null,'decorative_asset_removed',{reason:decorativeImageReason(row.imageUrl)});continue;
   }
   // Old extractors missed uppercase extensions: a cached null is not proof
   // that the article has no illustration. Re-fetch before removing it.
   if(reasons.length||(trusted&&!record.imageUrl))queue.push({row,url,stats,reasons});
  }
 }
 let cursor=0,requests=0;const slots=new Map();
 async function slot(url){
  const host=new URL(url).hostname;let release;
  const turn=new Promise(resolve=>{release=resolve}),previous=slots.get(host)||{turn:Promise.resolve(),next:0};
  const current={turn,next:0};slots.set(host,current);
  await previous.turn;
  const wait=Math.max(0,previous.next-Date.now());if(wait)await new Promise(r=>setTimeout(r,wait));
  current.next=Date.now()+intervalMs;release();
 }
 const workers=Array.from({length:6},async()=>{
  while(cursor<queue.length){
   const target=queue[cursor++],{row,url,stats,reasons}=target;
   if(!network||requests>=maxRequests){result.pending.push({language:stats.language,itemId:row.itemId,url,reasons});continue;}
   requests++;stats.network++;await slot(url);
   try{
    const observed=await request(url),image=cleanImage(observed.imageUrl);
    if(equivalent(row.imageUrl)!==equivalent(image)){
     result.patches.push({language:stats.language,itemId:row.itemId,url,beforeImage:row.imageUrl,afterImage:image,method:'article_refetch',evidence:{sha256:observed.sha256}});stats.changes++;
    }else stats.unchanged++;
   }catch(error){result.failures.push({language:stats.language,itemId:row.itemId,url,error:error.message});}
  }
 });await Promise.all(workers);
 return result;
}
function apply(root,report,now=new Date().toISOString()){
 if(report.schemaVersion!==1||!Array.isArray(report.patches)||!Number.isFinite(Date.parse(report.checkedAt)))throw Error('Invalid image patch report');
 const base=path.join(root,'local-data'),byLanguage=new Map(),conflicts=[],counts={primary:0,index:0,additional:0};
 for(const patch of report.patches){if(!LANGUAGES[patch.language]||urlOf({url:patch.url})!==patch.url||cleanImage(patch.afterImage)!==patch.afterImage)throw Error('Invalid image patch');if(!byLanguage.has(patch.language))byLanguage.set(patch.language,[]);byLanguage.get(patch.language).push(patch);}
 const write=(file,value)=>{fs.writeFileSync(file+'.tmp',stringifyAsciiSafe(value));fs.renameSync(file+'.tmp',file);};
 const accepted=new Map();
 for(const [language,patches]of byLanguage){
  const file=path.join(base,language,'scp-data.json'),source=JSON.parse(fs.readFileSync(file)),rows=new Map(source.data.map(r=>[r.itemId,r]));let changed=0;
  for(const p of patches){
   const row=rows.get(p.itemId);
   if(row&&urlOf(row)===p.url){
    if(equivalent(row.imageUrl)!==equivalent(p.beforeImage)&&equivalent(row.imageUrl)!==equivalent(p.afterImage)){conflicts.push({language,itemId:p.itemId});continue;}
    if(equivalent(row.imageUrl)!==equivalent(p.afterImage)){row.imageUrl=p.afterImage;row.lastUpdated=now;row.imageCheckedAt=now;changed++;counts.primary++;}
   }
   accepted.set(language+'\0'+p.url,p);
  }
  if(changed){
   source.timestamp=now;source.statistics={...(source.statistics||{}),withImage:source.data.filter(r=>r.imageUrl).length};write(file,source);
   const metaFile=path.join(base,language,'meta.json'),meta=JSON.parse(fs.readFileSync(metaFile));meta.lastUpdated=now;meta.statistics=source.statistics;write(metaFile,meta);
   if(language==='jp'){write(path.join(base,'scp-data.json'),source);write(path.join(base,'meta.json'),meta);}
  }
  const indexFile=path.join(base,'catalog-indexes',language+'.json.gz');let indexChanges=0;
  if(fs.existsSync(indexFile)){const state=readState(indexFile);
   for(const p of patches){const record=state.records[p.url];if(accepted.has(language+'\0'+p.url)&&record&&equivalent(record.imageUrl)!==equivalent(p.afterImage)&&Math.max(Date.parse(record.imageCheckedAt)||0,Date.parse(record.checkedAt)||0)<=Date.parse(report.checkedAt)){record.imageUrl=p.afterImage;record.imageCheckedAt=now;indexChanges++;counts.index++;}}
   if(indexChanges)writeState(indexFile,state);
  }
 }
 for(const name of ['catalog.json.gz','catalog.json']){
  const file=path.join(base,'related-documents',name);if(!fs.existsSync(file))continue;
  const catalog=JSON.parse(name.endsWith('.gz')?zlib.gunzipSync(fs.readFileSync(file)):fs.readFileSync(file,'utf8'));let changed=false;
  for(const row of catalog.data){const p=accepted.get(row.language+'\0'+row.url);if(!p)continue;if(equivalent(row.imageUrl)!==equivalent(p.beforeImage)&&equivalent(row.imageUrl)!==equivalent(p.afterImage)){conflicts.push({language:row.language,itemId:row.itemId});continue;}if(equivalent(row.imageUrl)!==equivalent(p.afterImage)){row.imageUrl=p.afterImage;row.lastUpdated=now;changed=true;counts.additional++;}}
  if(changed){catalog.timestamp=now;if(name.endsWith('.gz')){fs.writeFileSync(file+'.tmp',zlib.gzipSync(JSON.stringify(catalog),{level:9}));fs.renameSync(file+'.tmp',file);}else write(file,catalog);}
 }
 return {counts,conflicts};
}
function verify(root,report){
 const summaries=[];
 for(const language of Object.keys(LANGUAGES)){
  const dir=path.join(root,'local-data/mobile-v3',language),pointer=path.join(dir,'manifest.json');if(!fs.existsSync(pointer))continue;
  const m=JSON.parse(fs.readFileSync(pointer));if(!/^catalog-[a-f0-9]{64}\.json\.gz$/.test(m.fileName))throw Error('Invalid delivery pointer');
  const rows=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir,m.fileName)))).data;
  const bad=rows.filter(r=>decorativeImageReason(r.imageUrl));if(bad.length)throw Error('Decorative images still published: '+language+' '+bad.length);
  const before=report.languages.find(s=>s.language===language);if(before?.articles&&before.identitySha256!==identityDigest(rows))throw Error('Article identity changed: '+language);
  summaries.push({language,articles:rows.length,decorativeImages:0});
 }
 if(summaries.length!==report.languages.filter(s=>s.articles>0).length)throw Error('Published language set changed');
 return summaries;
}
if(require.main===module){
 const root=path.join(__dirname,'..'),mode=process.argv[2]||'audit',file=path.resolve(process.argv[3]||path.join(root,'partial-data/image-audit.json'));
 if(mode==='apply')console.log(JSON.stringify(apply(root,JSON.parse(fs.readFileSync(file)))));
 else if(mode==='verify')console.log(JSON.stringify(verify(root,JSON.parse(fs.readFileSync(file)))));
 else audit({root,network:mode!=='plan'}).then(result=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(result));console.log(JSON.stringify({languages:result.languages,patches:result.patches.length,failures:result.failures,pending:result.pending}));}).catch(error=>{console.error(error);process.exitCode=1;});
}
module.exports={audit,apply,suspectReasons,loadRows,verify};
