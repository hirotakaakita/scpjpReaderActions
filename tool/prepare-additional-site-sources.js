'use strict';
// Manual, read-only site verification plus explicit generation of reviewed inputs.
// This never publishes data or follows links beyond the site's collection menus.
const fs=require('node:fs'),path=require('node:path'),axios=require('axios');
const {JSDOM,VirtualConsole}=require('jsdom');
const sites=require('../additional-sites.json'),{LANGUAGES}=require('../languages');
const {LocalSCPCrawler}=require('../local-crawler');
const {inspectArticlePage}=require('../article-page');
const directory=path.join(__dirname,'../partial-data/branch-site-survey');
function cacheFile(site,slug){return path.join(directory,site.host.replace('.wikidot.com','')+'--'+slug.replaceAll(':','_')+'.html');}
async function get(site,slug){const file=cacheFile(site,slug);if(fs.existsSync(file))return fs.readFileSync(file,'utf8');const response=await axios.get('https://'+site.host+'/'+slug,{timeout:15000,headers:{'User-Agent':'Mozilla/5.0'}});fs.writeFileSync(file,response.data);await new Promise(r=>setTimeout(r,300));return response.data;}
function kind(slug,site){const p=slug.replace(site.namespace||'','');if(slug===site.nativeIndex||/^scp-series(?:-\d+)?$|^joke-scps$|^scp-ex$/.test(p))return 'scp';if(/^scp-international$|^scp-series-int$|^scp-(?:[a-z]+-)?001(?:-[a-z]+)?$/.test(p))return 'international-hub';if(/^foundation-tales(?:-[a-z]+)?$|^series-archive$/.test(p))return 'tale';if(/^goi-formats(?:-[a-z]+)?$/.test(p))return 'goi-format';if(/^canon-hub(?:-[a-z]+)?$|^anoncay-ubhay-pig$/.test(p))return 'canon';if(p==='scp-egativenay-errisay-pig')return 'international-hub';return null;}
async function main(){
 fs.mkdirSync(directory,{recursive:true});const sources=[],inventory=[];
 for(const [code,site]of Object.entries(sites)){
  const namespace=site.namespace||'',paths=new Set([site.nativeIndex,...LANGUAGES[code].pages.map(p=>p.path)]);
  const first=await get(site,namespace?namespace+'start':'scp-series');
  const dom=new JSDOM(first,{url:'https://'+site.host+'/',virtualConsole:new VirtualConsole()});
  for(const a of dom.window.document.querySelectorAll('a[href]')){if(a.classList.contains('newpage'))continue;try{const u=new URL(a.getAttribute('href'),'https://'+site.host+'/'),slug=u.pathname.slice(1);if(u.hostname!==site.host||u.search||namespace&&!slug.startsWith(namespace))continue;if(kind(slug,site))paths.add(slug);}catch{}}
  dom.window.close();
  paths.add(namespace+'scp-001');
  paths.add(namespace+(site.nativePrefix?'scp-'+site.nativePrefix+'-001':'scp-001-'+(site.origin||code)));
  if(code==='pig')paths.add('scp-egativenay-errisay-pig');
  const rows=[];for(const slug of paths){try{
   const html=await get(site,slug),doc=new JSDOM(html,{url:'https://'+site.host+'/'+slug,virtualConsole:new VirtualConsole()});
   const usable=inspectArticlePage(doc.window.document);if(!usable.usable){doc.window.close();continue;}
   const page=LANGUAGES[code].pages.find(p=>p.path===slug),count=page?new LocalSCPCrawler(code).extractFromScpSeries(doc.window.document,page).length:null;
   if(page&&!count)throw Error('Primary index has no usable articles: '+code+'/'+slug);
   const source={language:code,url:'https://'+site.host+'/'+slug,kind:kind(slug,site),verifiedAt:new Date().toISOString()};
   if(slug===site.nativeIndex)source.origin=site.origin||code;
   if(source.kind){sources.push(source);rows.push({path:slug,kind:source.kind,primary:!!page,extractedArticles:count});}
   doc.window.close();
  }catch(error){if(LANGUAGES[code].pages.some(p=>p.path===slug))throw error;console.log(code+'/'+slug+': unavailable');}}
  inventory.push({code,host:site.host,namespace,uiLocale:site.uiLocale,sources:rows});console.log(code+': '+rows.length+' verified collections');
 }
 const file=path.join(__dirname,'../catalog-index-sources.json'),definition=JSON.parse(fs.readFileSync(file));definition.sources=definition.sources.filter(s=>!sites[s.language]).concat(sources);fs.writeFileSync(file,JSON.stringify(definition,null,2)+'\n');
 fs.mkdirSync(path.join(__dirname,'../docs'),{recursive:true});fs.writeFileSync(path.join(__dirname,'../docs/additional-site-inventory.json'),JSON.stringify({checkedAt:new Date().toISOString(),reference:'https://o5command-int.wikidot.com/branch-list',sites:inventory},null,2)+'\n');
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
