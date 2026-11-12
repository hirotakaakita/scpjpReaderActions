'use strict';
const fs=require('node:fs'),path=require('node:path'),z=require('node:zlib');
const {LANGUAGES}=require('../languages');
const {normalize,loadCache,saveCache}=require('../related-documents');
const {readState,writeState}=require('../catalog-indexes');
const {read,hash}=require('./repair-catalog-excerpts');
const {VERSION,repairStoredExcerpt}=require('../article-excerpts');
function apply({root=path.resolve(__dirname,'..'),requireComplete=false,now=new Date().toISOString()}={}){
 const reports=[],edits=new Map(),counts={primary:0,index:0,cache:0,additional:0};
 for(const language of Object.keys(LANGUAGES)){
  const file=path.join(root,'partial-data/excerpt-repairs',language+'.json.gz');
  if(!fs.existsSync(file)){if(requireComplete)throw Error('Missing excerpt repair: '+language);continue;}
  const report=read(file);if(report.version!==VERSION||report.language!==language)throw Error('Wrong excerpt repair version/language');
  if(requireComplete&&(report.failed.length||report.pending.length))throw Error('Incomplete excerpt repair: '+language);
  reports.push({...report,edits:report.edits.length});
  for(const edit of report.edits)edits.set(edit.url+':'+hash(edit.before),{...edit,at:report.at});
 }
 function patch(row,kind){
  const url=normalize(row.urlJP||row.urlEN||row.url)?.url;if(!url||typeof row.descriptionExcerpt!=='string')return false;
  const edit=edits.get(url+':'+hash(row.descriptionExcerpt));if(!edit)return false;
  row.descriptionExcerpt=edit.text;row.descriptionVersion=VERSION;row.descriptionCheckedAt=edit.at;
  if(edit.sourceHash)row.descriptionContentSha256=edit.sourceHash;
  counts[kind]++;return true;
 }
 function save(file,value){fs.writeFileSync(file+'.tmp',file.endsWith('.gz')?z.gzipSync(JSON.stringify(value),{level:9}):JSON.stringify(value));fs.renameSync(file+'.tmp',file);}
 for(const language of Object.keys(LANGUAGES)){
  const file=path.join(root,'local-data',language,'scp-data.json');
  if(fs.existsSync(file)){
   const source=read(file);let changed=false;for(const row of source.data)changed=patch(row,'primary')||changed;
   if(changed){source.timestamp=now;save(file,source);const metaFile=path.join(path.dirname(file),'meta.json'),meta=read(metaFile);meta.lastUpdated=now;save(metaFile,meta);
    if(language==='jp'){save(path.join(root,'local-data/scp-data.json'),source);save(path.join(root,'local-data/meta.json'),meta);}
   }
  }
  for(const base of ['local-data','partial-data']){
   const file=path.join(root,base,'catalog-indexes',language+'.json.gz');if(!fs.existsSync(file))continue;
   const state=readState(file);let changed=false;for(const row of Object.values(state.records))changed=patch(row,'index')||changed;
   if(changed)writeState(file,state);
  }
 }
 for(const dir of ['related-documents','related-documents-v2'])for(const suffix of ['.json','.json.gz']){
  const file=path.join(root,'local-data',dir,'catalog'+suffix);if(!fs.existsSync(file))continue;
  const catalog=read(file);let changed=false;for(const row of catalog.data)changed=patch(row,'additional')||changed;
  if(changed){catalog.timestamp=now;save(file,catalog);}
 }
 const cacheDirectory=path.join(root,'local-data/related-document-cache'),cache=loadCache(cacheDirectory);let changed=false;
 for(const row of cache.records.values())changed=patch(row,'cache')||changed;if(changed)saveCache(cacheDirectory,cache.records,cache.attempts);
 const report={version:VERSION,at:now,counts,languages:reports};
 save(path.join(root,'local-data/excerpt-repair-report.json'),report);console.log(JSON.stringify({counts,languages:reports.length}));return report;
}
function auditMobile({root=path.resolve(__dirname,'..')}={}){
 const findings=[];let total=0;
 for(const language of Object.keys(LANGUAGES)){
  const dir=path.join(root,'local-data/mobile-v3',language),pointer=path.join(dir,'manifest.json');if(!fs.existsSync(pointer))continue;
  const manifest=read(pointer),catalog=read(path.join(dir,manifest.fileName));
  for(const row of catalog.data){total++;const result=repairStoredExcerpt(row.descriptionExcerpt);if(result.needsFetch||result.text!==String(row.descriptionExcerpt||'').trim())findings.push({language,id:row.itemId,url:row.urlJP,excerpt:row.descriptionExcerpt});}
 }
 console.log(JSON.stringify({audited:total,contaminated:findings.length,examples:findings.slice(0,10)}));
 if(findings.length)throw Error('Excerpt metadata remains in delivered articles');return {total,findings};
}
if(require.main===module){try{if(process.argv.includes('--audit-mobile'))auditMobile();else apply({requireComplete:process.env.EXCERPT_REQUIRE_COMPLETE==='1'});}catch(e){console.error(e);process.exitCode=1;}}
module.exports={apply,auditMobile};
