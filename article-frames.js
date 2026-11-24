'use strict';
const axios=require('axios'),{JSDOM,VirtualConsole}=require('jsdom');
async function extractOwnedFrameProse(url,html,request=async target=>(await axios.get(target,{timeout:20000,maxRedirects:0,maxContentLength:12*1024*1024})).data){
 const page=new URL(url),dom=new JSDOM(String(html).replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,''),{url,virtualConsole:new VirtualConsole()});
 const urls=[...dom.window.document.querySelectorAll('#page-content iframe[src]')].map(n=>new URL(n.getAttribute('src'),url));dom.window.close();
 for(const target of urls.slice(0,8)){
  const host=page.hostname.replace(/\.wikidot\.com$/,'.wdfiles.com');
  if(!['https:','http:'].includes(target.protocol)||target.username||target.password||target.port||![page.hostname,host].includes(target.hostname))continue;
  if(!decodeURIComponent(target.pathname).startsWith('/local--html/'+decodeURIComponent(page.pathname).replace(/^\//,'')+'/'))continue;
  let frame;try{frame=await request(target.href.replace(/^http:/,'https:'));}catch(e){if([404,410].includes(e.response?.status))continue;throw e;}
  const view=new JSDOM(String(frame).replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,''),{virtualConsole:new VirtualConsole()});
  try{const excerpt=require('./local-crawler').extractDescriptionAndTagsFromDocument(view.window.document).descriptionExcerpt;if(excerpt)return excerpt;}finally{view.window.close();}
 }
 return null;
}
module.exports={extractOwnedFrameProse};
