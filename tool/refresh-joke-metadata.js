'use strict';
const fs=require('node:fs'),path=require('node:path');
const axios=require('axios'),{JSDOM,VirtualConsole}=require('jsdom');
const {LocalSCPCrawler,stringifyAsciiSafe}=require('../local-crawler');
const {extractHtml,capture}=require('../related-documents');
const {readState,writeState}=require('../catalog-indexes');
const targets=[
 ['joke-scps-006','scp-006-j','joke-scps'],
 ['joke-scps-682','scp-682-j','joke-scps'],
 ['joke-scps-jp-3168','scp-3168-jp-j','joke-scps-jp'],
 ['joke-scps-jp-3434','scp-3434-jp-j','joke-scps-jp'],
 ['joke-scps-jp-3482','scp-3482-jp-j','joke-scps-jp'],
];
async function refresh({root=path.join(__dirname,'..'),request=async url=>(await axios.get(url,{timeout:30000})).data,now=new Date().toISOString(),captureSources=true}={}){
 const base=path.join(root,'local-data'),file=path.join(base,'jp/scp-data.json');
 const source=JSON.parse(fs.readFileSync(file)),crawler=new LocalSCPCrawler('jp');
 const listings=new Map(),updates=[],observations=new Map();
 for(const [id,slug,listing]of targets){
  const row=source.data.find(r=>r.itemId===id);
  if(!row||new URL(row.urlJP).hostname!=='scp-jp.wikidot.com'||new URL(row.urlJP).pathname!=='/'+slug)throw Error('Unexpected target identity: '+id);
  if(!listings.has(listing)){
   const html=await request('https://scp-jp.wikidot.com/'+listing);
   const dom=new JSDOM(html,{virtualConsole:new VirtualConsole()});
   try{listings.set(listing,crawler.extractFromScpSeries(dom.window.document,crawler.getPageConfig(crawler.baseUrl+'/'+listing)));}finally{dom.window.close();}
  }
  const entry=listings.get(listing).find(e=>e.url==='/'+slug);
  if(!entry?.title)throw Error('Missing observed listing title: '+id);
  const url='https://scp-jp.wikidot.com/'+slug,html=await request(url),record=extractHtml(url,html,now);
  observations.set(url,record);
  if(captureSources)capture(url,html);
  const next={...row,titleJP:entry.title,imageUrl:record.imageUrl||null};
  if(next.titleJP!==row.titleJP||next.imageUrl!==(row.imageUrl||null)){
   next.lastUpdated=now;
   source.data[source.data.indexOf(row)]=next;
   updates.push({itemId:id,titleJP:next.titleJP,imageUrl:next.imageUrl});
  }
 }
 // Nothing is written to published inputs until all five requests succeed.
 const indexFile=path.join(base,'catalog-indexes/jp.json.gz');
 if(fs.existsSync(indexFile)){
  const state=readState(indexFile);
  for(const [url,record]of observations)if(state.records[url])state.records[url]=record;
  writeState(indexFile,state);
 }
 if(updates.length){
  source.timestamp=now;
  const meta=JSON.parse(fs.readFileSync(path.join(base,'jp/meta.json')));meta.lastUpdated=now;
  const write=(name,value)=>{fs.writeFileSync(name+'.tmp',stringifyAsciiSafe(value));fs.renameSync(name+'.tmp',name);};
  write(file,source);write(path.join(base,'jp/meta.json'),meta);
  write(path.join(base,'scp-data.json'),source);write(path.join(base,'meta.json'),meta);
 }
 console.log(JSON.stringify({checked:targets.length,updated:updates.length,updates}));
 return updates;
}
if(require.main===module)refresh().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={refresh,targets};
