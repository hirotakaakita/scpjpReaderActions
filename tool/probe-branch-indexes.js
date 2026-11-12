'use strict';
const fs=require('node:fs'),path=require('node:path'),axios=require('axios');
const {JSDOM,VirtualConsole}=require('jsdom');
const roots=Object.fromEntries(Object.entries(require('../additional-sites.json')).map(([code,site])=>[code,[site.host.replace('.wikidot.com',''),site.nativeIndex]]));
async function probe(){
 const directory=path.resolve('partial-data/branch-site-survey');fs.mkdirSync(directory,{recursive:true});const results=[];
 for(const [code,[host,native]]of Object.entries(roots)){
  const prefix=['da','no','sv'].includes(code)?code+':':'';
  const pages=[...new Set([native,prefix+'scp-series',prefix+'scp-series-2',prefix+'joke-scps',...(prefix?[prefix+'start']:[]),...(code==='pig'?['scp-pig-series']:[])])];
  for(const slug of pages){const url=`https://${host}.wikidot.com/${slug}`,file=path.join(directory,host+'--'+slug.replaceAll(':','_')+'.html');
   try{const response=fs.existsSync(file)?{data:fs.readFileSync(file,'utf8')}:await axios.get(url,{timeout:15000,headers:{'User-Agent':'Mozilla/5.0'}});fs.writeFileSync(file,response.data);
    const dom=new JSDOM(response.data,{url,virtualConsole:new VirtualConsole()}),d=dom.window.document,root=d.querySelector('#page-content');
    const links=[...root?.querySelectorAll('a[href]')||[]].filter(a=>!a.classList.contains('newpage')).map(a=>({url:new URL(a.getAttribute('href'),url).href,label:a.textContent.trim()}));
    const articles=[...new Set(links.map(l=>l.url).filter(u=>new URL(u).hostname===host+'.wikidot.com'&&/^\/(?:[a-z]{2}:)?scp-(?:[a-z]+-)?\d/.test(new URL(u).pathname)))];
    const record={code,url,status:d.querySelector('.error-block')&&!articles.length?'unavailable':'available',title:d.title,articleCount:articles.length,sample:articles.slice(0,3),indexes:links.filter(l=>/series|serie|foundation-tales|joke|scp-ex|scp-nl|lipu-scp/.test(l.url)).slice(0,12)};
    results.push(record);console.log(JSON.stringify({code,url,status:record.status,count:articles.length,title:d.title,sample:record.sample}));dom.window.close();
   }catch(e){results.push({code,url,status:'unavailable',error:e.message});console.log(JSON.stringify({code,url,error:e.message}));}
  }
 }
 fs.writeFileSync(path.join(directory,'indexes.json'),JSON.stringify(results,null,2));
}
if(require.main===module)probe().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={roots};
