'use strict';
// Report identity anomalies; never alter catalog/group identity in this checker.
const fs=require('node:fs'),path=require('node:path');
const {loadBoard}=require('./audit');
const {readSources}=require('../source-store');
function check(board,sources){
  const mismatches=[];
  const identitiesByUrl=new Map();
  for(const node of board.nodes)for(const v of node[13])identitiesByUrl.set(v[1],{workId:node[14][0],branch:node[8],
    pageType:node[12],title:node[5],pages:node[13].map(a=>a[1]),keys:node[14][2]});
  const candidates=[...identitiesByUrl].filter(([url])=>/^https:\/\/scp-wiki\.wikidot\.com\/scp-\d{3,5}$/.test(url));
  for(const [url,n] of candidates){
    const number=Number(url.slice(url.lastIndexOf('-')+1));
    const expected='catalog:scp-series:scp-series-'+String(number).padStart(3,'0');
    if(n.workId===expected)continue;
    // We cannot conclude foreign origin solely from a URL. Capture the
    // publisher classification and tags behind the existing decision.
    const rec=sources.get('page:scp-wiki.wikidot.com/'+url.split('/').at(-1))?.record;
    mismatches.push({url,expectedWork:expected,actualWork:n.workId,branch:n.branch,
      pageType:n.pageType,title:n.title,versionCount:n.pages.length,
      others:n.pages.filter(u=>u!==url).slice(0,30),catalogIdentity:rec?.catalogIdentity||null,
      originSources:rec?.originalSources||[],tags:rec?.tags||[],
      classificationSource:rec?.classificationBasis||null,sourceSha:rec?.contentSha256||null});
  }
  const focusUrls=[
    'https://scp-wiki.wikidot.com/scp-179',
    'https://scp-zh-tr.wikidot.com/scp-179',
    'https://lafundacionscp.wikidot.com/scp-179',
    'https://lafundacionscp.wikidot.com/scp-es-179',
    'https://scp-wiki-cn.wikidot.com/scp-179'
  ];
  return {revision:board.revision,generatedAt:new Date().toISOString(),
    checkedEnglishCanonicalPages:candidates.length,
    unusualIdentityCount:mismatches.length,
    mismatches,focus:focusUrls.map(url=>({url,identity:identitiesByUrl.get(url)||null}))};
}
function run(out){
  const {board}=loadBoard();
  const sources=readSources(path.join(__dirname,'../../local-data/research-board-sources'));
  const result=check(board,sources);
  fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'identity-anomalies.json'),JSON.stringify(result,null,2)+'\n');
  const first=result.mismatches.slice(0,20);
  const md=['# Original SCP identity cross-check',
    '','This is a **risk inventory**, not proof that every non-English origin is incorrect.',
    '','Total EN canonical /scp-N pages: '+result.checkedEnglishCanonicalPages,
    'Unusual primary work keys: '+result.unusualIdentityCount,'',
    '| EN source URL | Assigned work key | Branch |',
    '| --- | --- | --- |',
    ...first.map(x=>'| '+x.url+' | '+x.actualWork+' | '+x.branch+' |'),
    '','For each case, inspect the source catalog and original-author metadata before remapping.',
    'In particular review the English/Traditional-Chinese SCP-179 split.'];
  fs.writeFileSync(path.join(out,'IDENTITY.md'),md.join('\n')+'\n');
  console.log(JSON.stringify({checked:result.checkedEnglishCanonicalPages,
    anomalies:result.unusualIdentityCount,focus:result.focus.map(x=>({url:x.url,workId:x.identity?.workId||null}))},null,2));
  return result;
}
if(require.main===module)try{run(path.resolve(process.argv[2]||'research-board/verification/audit-results/identity'));}
catch(e){console.error(e);process.exitCode=1;}
module.exports={check,run};
