'use strict';
// Read-only survey of the branch codes requested in scp-branch-codes.md.
const fs=require('node:fs'),path=require('node:path'),axios=require('axios');
const {JSDOM,VirtualConsole}=require('jsdom');
const candidates={ar:'scp-ar',cy:'scp-cy',da:'scp-nd',el:'scp-el',eo:'scp-eo',hu:'scp-hu',ie:'scp-ie',io:'scp-io',ir:'scp-ir',isv:'scp-isv',la:'scp-la',nd:'scp-nd',nl:'scp-nl',no:'scp-nd',pig:'scp-pig',ro:'scp-romanian',sga:'scp-sga',sh:'scp-sh',sk:'scp-cs',sl:'scp-slovenija',sv:'scp-nd',tok:'scp-tok',tr:'scpvakfi'};
async function survey(){
 const directory=path.resolve('partial-data/branch-site-survey');fs.mkdirSync(directory,{recursive:true});
 const results=[];
 for(const host of [...new Set(Object.values(candidates))]){
  const url=`https://${host}.wikidot.com/`,file=path.join(directory,host+'.html');
  try{
   const response=fs.existsSync(file)?{data:fs.readFileSync(file,'utf8'),status:200}:await axios.get(url,{timeout:20000,headers:{'User-Agent':'Mozilla/5.0 (compatible; SCPReader branch survey)'},validateStatus:()=>true});
   if(response.status!==200)throw Error('HTTP '+response.status);
   fs.writeFileSync(file,response.data);
   const dom=new JSDOM(String(response.data).replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,''),{url,virtualConsole:new VirtualConsole()});
   const d=dom.window.document,content=d.querySelector('#page-content');
   const links=[...d.querySelectorAll('a[href]')].map(a=>{try{return {url:new URL(a.getAttribute('href'),url).href,label:a.textContent.trim(),missing:a.classList.contains('newpage')};}catch{return null;}}).filter(Boolean);
   const invalid=!content||/site does not exist|page not found|this site is private|does not exist yet/i.test(d.title+' '+content.textContent.slice(0,1200));
   const result={codes:Object.keys(candidates).filter(k=>candidates[k]===host),url,status:invalid?'unavailable':'available',title:d.title,indexes:links.filter(l=>!l.missing&&l.url.startsWith(url)&&/series|serie|lista|scp-list|liste|joke|scp-ex|scp-.*-ex|foundation-tales|scp-.*-001|series-|scp-001|scp-002|scp-173|scp-international/i.test(l.url)).filter((l,i,a)=>a.findIndex(x=>x.url===l.url)===i).slice(0,45),branchLinks:links.filter(l=>/scp.*wikidot|scpvakfi/.test(l.url)&&!l.url.startsWith(url)).slice(0,35)};
   results.push(result);console.log(JSON.stringify(result));dom.window.close();
  }catch(error){const result={codes:Object.keys(candidates).filter(k=>candidates[k]===host),url,status:'unverified',error:error.message};results.push(result);console.log(JSON.stringify(result));}
 }
 fs.writeFileSync(path.join(directory,'survey.json'),JSON.stringify({checkedAt:new Date().toISOString(),results},null,2));
}
if(require.main===module)survey().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={candidates};
