'use strict';
const {decorativeImageReason}=require('./image-policy');
const ranks={jpg:0,jpeg:1,png:2,gif:3,webp:4,bmp:5,wbmp:6};
function srcsetUrls(value){
 if(/(?:^|,\s*)data:/i.test(String(value||'')))return [];
 return String(value||'').split(',').map(part=>part.trim().replace(/\s+\d+(?:\.\d+)?[wx]$/i,'')).filter(Boolean);
}
function candidates(image,baseUrl){
 const values=['data-src','data-original','data-lazy-src','src'].map(name=>image.getAttribute(name)).filter(Boolean);
 for(const name of ['data-srcset','srcset'])values.push(...srcsetUrls(image.getAttribute(name)));
 const picture=image.closest('picture');
 if(picture)for(const source of picture.querySelectorAll('source[srcset]')){
  if(/svg|avif|heic|tiff/i.test(source.getAttribute('type')||''))continue;
  values.push(...srcsetUrls(source.getAttribute('srcset')));
 }
 const result=[],seen=new Set();
 for(const value of values){
  if(!value.trim()||value.trim().startsWith('#')||decorativeImageReason(value))continue;
  let url;try{url=new URL(value,baseUrl);}catch{continue;}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port||decorativeImageReason(url.href))continue;
  let pathname=url.pathname;try{pathname=decodeURIComponent(pathname);}catch{}
  const extension=/\.([a-z0-9]+)(?:\/|;|$)/ig;let match,format;
  while((match=extension.exec(pathname)))format=match[1].toLowerCase();
  const requestedFormat=url.searchParams.get('format')||url.searchParams.get('fm')||'';
  const unsupported=/^(?:svg|svgz|avif|heic|heif|tif|tiff|ico|pdf|html?|css|js|json|xml|txt)$/i;
  if(unsupported.test(format||'')||unsupported.test(requestedFormat))continue;
  const rank=ranks[format]??7;
  if(seen.has(url.href))continue;seen.add(url.href);
  result.push({url:url.href,rank});
 }
 return result;
}
function extractArticleImage(document,baseUrl){
 const root=['#page-content','.page-source','#main-content','.content-panel'].map(s=>document.querySelector(s)).find(Boolean);
 if(!root)return null;
 const found=[];
 for(const image of root.querySelectorAll('img')){
  if(['width','height'].some(name=>image.hasAttribute(name)&&Number(image.getAttribute(name))>0&&Number(image.getAttribute(name))<=2))continue;
  if(/(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(image.getAttribute('style')||''))continue;
  if(image.closest('nav,[role="navigation"],#header,#side-bar,#top-bar,.page-navigation,.footer-wikiwalk-nav,.page-tags,.licensebox,.credit,.credit-box,#u-credit-view,.page-rate-widget-box,.interwiki-box,.fa,.icon'))continue;
  found.push(...candidates(image,baseUrl));
 }
 found.sort((a,b)=>a.rank-b.rank);
 return found[0]?.url||null;
}
module.exports={candidates,extractArticleImage,srcsetUrls};
