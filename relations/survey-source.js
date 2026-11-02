"use strict";
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {JSDOM,VirtualConsole}=require('jsdom');
const {normalizePage,digest,EXCLUDED}=require('./core');
const {atomicJson}=require('./store');
const VERSION=2;
function sourceIndex(dir,url){const p=normalizePage(url);if(!p)throw Error('Unsupported survey source');return path.join(dir,'sources',digest(p.id)+'.json');}
function readSourceState(dir,url){const f=sourceIndex(dir,url);return fs.existsSync(f)?JSON.parse(fs.readFileSync(f,'utf8')):null;}
function hasSource(dir,url,record){const s=readSourceState(dir,url);return s?.version===VERSION&&s.lastAttempt?.status==='success'&&s.contentSha256===record?.contentSha256&&fs.existsSync(path.join(dir,s.document));}
function atomicGzip(file,bytes){fs.mkdirSync(path.dirname(file),{recursive:true});if(fs.existsSync(file))return;const tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,zlib.gzipSync(bytes));fs.renameSync(tmp,file);}
function extractDocument(body,url,format,record){
 const page=normalizePage(url);let text,links=[],publisherMetadata=[];
 if(format==='ftml'){
  const detail=JSON.parse(body);if(detail.pageId?.toLowerCase()!==page.slug||typeof detail.source!=='string')throw Error('Survey FTML identity mismatch');
  text=detail.source;links=(record.links||[]).map(l=>({url:l.target,label:normalizePage(l.target).slug}));
 }else{
  const dom=new JSDOM(body,{url:page.url,virtualConsole:new VirtualConsole()});
  try{const breadcrumb=dom.window.document.querySelector('#breadcrumbs');if(breadcrumb)publisherMetadata.push({kind:'publisher_breadcrumb',text:breadcrumb.textContent.trim(),links:[...breadcrumb.querySelectorAll('a[href]')].map(a=>({label:a.textContent.trim(),url:normalizePage(a.getAttribute('href'),page.url)?.url})).filter(x=>x.url)});
  const root=dom.window.document.querySelector('#page-content');if(!root)throw Error('Survey content missing');
   for(const n of root.querySelectorAll(EXCLUDED))n.remove();
   for(const a of root.querySelectorAll('a[href]')){const p=normalizePage(a.getAttribute('href'),page.url);if(p&&!a.classList.contains('newpage'))links.push({url:p.url,label:a.textContent.trim()});}
   for(const n of root.querySelectorAll('br'))n.replaceWith('\n'.replace('\n','\n'));
   for(const n of root.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6,blockquote,div,tr'))n.append('\n'.replace('\n','\n'));
   text=root.textContent.replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  }finally{dom.window.close();}
 }
 if(!text.trim())throw Error('Survey source empty');
 return{schemaVersion:VERSION,pageId:page.id,url:page.url,branch:page.branch,title:record.title,tags:record.tags||[],authors:record.authors||[],format,text,links,publisherMetadata,fetchedAt:record.fetchedAt,contentSha256:record.contentSha256,textSha256:digest(text),limitations:record.limitations||[]};
}
function saveSource(dir,url,body,format,record){
 if(digest(body)!==record.contentSha256)throw Error('Raw source does not match captured revision');
 const doc=extractDocument(body,url,format,record),key=digest(doc.pageId+'\0'+record.contentSha256+'\0'+VERSION);
 const document='documents/'+key+'.json.gz',raw='raw/'+record.contentSha256+'.gz';
 atomicGzip(path.join(dir,raw),Buffer.from(body));atomicGzip(path.join(dir,document),Buffer.from(JSON.stringify(doc)));
 atomicJson(sourceIndex(dir,url),{version:VERSION,url:doc.url,pageId:doc.pageId,contentSha256:record.contentSha256,documentKey:key,document,raw,lastAttempt:{status:'success',at:new Date().toISOString()}});return doc;
}
function sourceFailure(dir,url,status){const old=readSourceState(dir,url)||{};atomicJson(sourceIndex(dir,url),{...old,url,lastAttempt:{status,at:new Date().toISOString()}});}
function readDocument(dir,state){
 const doc=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir,state.document))).toString('utf8'));
 if(doc.schemaVersion!==VERSION||doc.url!==state.url||doc.pageId!==state.pageId||doc.contentSha256!==state.contentSha256||digest(doc.text)!==doc.textSha256||digest(doc.pageId+'\0'+doc.contentSha256+'\0'+VERSION)!==state.documentKey)throw Error('Survey document identity or revision mismatch');
 return doc;
}
module.exports={VERSION,sourceIndex,readSourceState,hasSource,extractDocument,saveSource,sourceFailure,readDocument};
