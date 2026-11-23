'use strict';
const fs=require('node:fs'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const sites=require('../additional-sites.json'),{LANGUAGES}=require('../languages');
const axios=require('axios');
const {LocalSCPCrawler}=require('../local-crawler'),{extractHtml}=require('../related-documents');
async function main(){const report=[];for(const [code,site]of Object.entries(sites)){
 const page=LANGUAGES[code].pages[0],file=path.join(__dirname,'../partial-data/branch-site-survey',site.host.replace('.wikidot.com','')+'--'+page.path.replaceAll(':','_')+'.html');
 const d=new JSDOM(fs.readFileSync(file,'utf8'),{virtualConsole:new VirtualConsole()});
 const c=Object.assign(Object.create(LocalSCPCrawler.prototype),{baseUrl:LANGUAGES[code].baseUrl});const entries=c.extractFromScpSeries(d.window.document,page);d.window.close();
 const entry=entries.find(e=>e.numericItemId>1)||entries.find(e=>e.scpNumber!=='001')||entries.at(-1);const url=LANGUAGES[code].baseUrl+entry.url;
 try{const rawFile=path.join(__dirname,'../partial-data/branch-site-survey',site.host.replace('.wikidot.com','')+'--'+entry.url.slice(1).replaceAll(':','_')+'.html');const html=fs.existsSync(rawFile)?fs.readFileSync(rawFile,'utf8'):(await axios.get(url,{timeout:20000})).data;fs.writeFileSync(rawFile,html);const r=extractHtml(url,html);report.push({code,url,title:r.title,language:r.language,objectClass:r.objectClass,tags:r.tags,availabilityVersion:r.availabilityVersion});console.log(JSON.stringify(report.at(-1)));}
 catch(error){report.push({code,url,error:error.message});console.log(code+': '+error.message);}
 await new Promise(r=>setTimeout(r,500));
 }fs.writeFileSync(path.join(__dirname,'../docs/additional-site-article-check.json'),JSON.stringify({checkedAt:new Date().toISOString(),articles:report},null,2)+'\n');if(report.some(r=>r.error))process.exitCode=1;}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
