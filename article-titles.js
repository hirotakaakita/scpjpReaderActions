'use strict';
const {titleNeedsRepair}=require('./article-excerpts');
function extractArticleTitle(document,url=''){
 const heading=document.querySelector('#page-title')?.cloneNode(true);
 if(heading)for(const n of heading.querySelectorAll('style,script,noscript,.odate'))n.remove();
 const values=[heading?.textContent,document.title?.replace(/\s+-\s+(?:SCP Foundation|SCP財団|SCP基金会|Fondation SCP)$/iu,'')];
 for(const value of values){const title=String(value||'').replace(/\s+/g,' ').trim();if(!titleNeedsRepair(title))return title;}
 try{return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1)).replace(/^scp-/i,'SCP-');}catch{return '';}
}
module.exports={extractArticleTitle};
