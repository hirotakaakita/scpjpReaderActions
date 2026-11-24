'use strict';
// Offline, read-only review of a frozen audit artifact. Classifications are
// hypotheses, not changes to the source-of-truth board or actual precision.
const fs=require('node:fs'),path=require('node:path');
const DIRECTORY=/^\/(?:groups-of-interest|task-forces|personnel-and-character-dossier|canon-hub|log-of-anomalous-items|log-of-extranormal-events|log-of-unexplained-locations|secure-facilities-locations)(?:-[a-z\d-]+)?$/i;
function parseCsv(text){
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}
      else if(ch==='"')quoted=false;
      else cell+=ch;
    }else if(ch==='"')quoted=true;
    else if(ch===','){row.push(cell);cell='';}
    else if(ch==='\n'){row.push(cell);rows.push(row);row=[];cell='';}
    else if(ch!=='\r')cell+=ch;
  }
  if(quoted)throw Error('Unterminated CSV field');
  if(row.length||cell)rows.push([...row,cell]);
  if(!rows.length)return [];
  const headers=rows.shift();
  return rows.filter(r=>r.some(x=>x!=='')).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));
}
function csv(rows,headers){
  const esc=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  return [headers.map(esc).join(','),...rows.map(r=>headers.map(h=>esc(r[h])).join(','))].join('\n')+'\n';
}
function siblingNavigationEvidence(group){
  const observed=group.filter(x=>x.href);
  if(observed.length<2||observed.length>4)return false;
  const selectors=observed.map(x=>x.selector||'');
  const hrefs=observed.map(x=>x.href);
  if(selectors.some(s=>!s.includes(' > p >')&&!s.includes(' > blockquote > p >')))return false;
  // Parent page/paragraph layout and first/third links are a *candidate*
  // chapter bar; the surrounding HTML must still be manually reviewed.
  const sameBlock=selectors.every(s=>s.split(' > p >')[0]===selectors[0].split(' > p >')[0]);
  const chapterLabel=observed.some(x=>/^(?:part(?:e)?\s+\S+|chapitre\s+\S+|s[ée]rie\s+\d+)/i.test(x.quote||''));
  const flanks=selectors.some(s=>/a:nth-of-type\(1\)/.test(s)) &&
    selectors.some(s=>/a:nth-of-type\(3\)/.test(s));
  return (sameBlock&&flanks)||chapterLabel;
}
function labelDifference(item,ctx){
  const {row,group,repeat}=ctx;
  if(item.result==='outside_catalog')return {
    category:'catalog_boundary_diagnostic',confidence:'diagnostic',
    reason:'Page is outside the published catalog; not scored as a missing graph edge'};
  if(item.result!=='changed_since_capture'&&!['false_positive','false_negative'].includes(item.result))
    return {category:'unknown_previous_status',confidence:'low',reason:'Unhandled audit result'};
  const zhMenu=item.language==='zh-tr' && DIRECTORY.test(item.href||'') &&
    !String(item.quote||'').trim()&&/<img\b/i.test(item.sourceElement||'')&&
    (repeat.get(item.href)?.size||0)>=8;
  if(zhMenu)return {category:'verifier_noise_global_image_menu',confidence:'high',
    reason:'Image-only site directory link repeated on >=8 distinct ZH-TR articles; independent verifier includes site navigation'};
  if(item.sourceUrl==='https://scp-wiki-cn.wikidot.com/tool-box' &&
    row?.status==='content_changed'&&
    row.warning?.some(w=>/script|iframe/.test(w)) &&
    row.expectedCount>100&&row.actualCount>100)
    return {category:'time_varying_toolbox_unresolved',confidence:'medium',
      reason:'High-degree tool-box contents changed; scripts/frames present; old-only and current-only targets cannot be scored without a same-time snapshot'};
  if(item.language==='zh-tr'&&/scpwiki\.com\/scp-179/i.test(item.href||''))
    return {category:'cross_language_identity_review',confidence:'medium',
      reason:'Link points to an alias of the English wiki but was mapped to a different work; inspect original/translation identity mapping'};
  if(!item.href)return {category:'published_only_after_page_change',confidence:'low',
    reason:'Published edge is absent on live site; archived snapshot or page history required'};
  if(siblingNavigationEvidence(group))return {category:'possible_chapter_navigation',confidence:'medium',
    reason:'Link belongs to a small group of previous/next chapter or series links; inspect surrounding block before exclusion'};
  if(/(?:complete-list|series-list|catalog|index)/i.test(item.sourceUrl))
    return {category:'changing_list_or_index',confidence:'low',
      reason:'A list page now contains the link; no same-time snapshot to distinguish an addition from missed extraction'};
  return {category:'individual_content_review',confidence:'low',
    reason:'Actual body hyperlink observed only on current page; investigate capture timing and extractor behavior'};
}
function triage(audit,items){
  if(!Array.isArray(audit.samples))throw Error('audit.json missing samples');
  const pages=new Map(audit.samples.map(s=>[s.url,s]));
  const repeat=new Map(),byPage=new Map();
  for(const item of items.filter(x=>x.result!=='outside_catalog')){
    if(!byPage.has(item.sourceUrl))byPage.set(item.sourceUrl,[]);
    byPage.get(item.sourceUrl).push(item);
    if(item.language==='zh-tr'&&item.href){
      if(!repeat.has(item.href))repeat.set(item.href,new Set());
      repeat.get(item.href).add(item.sourceUrl);
    }
  }
  const results=items.filter(x=>x.result!=='outside_catalog').map(item=>{
    const info=labelDifference(item,{row:pages.get(item.sourceUrl),
      group:byPage.get(item.sourceUrl)||[],repeat});
    return {...item,...info};
  });
  const counts={},byBranch={},byPageStatus=new Map();
  for(const item of results){
    counts[item.category]=(counts[item.category]||0)+1;
    byBranch[item.language]=(byBranch[item.language]||0)+1;
    const old=byPageStatus.get(item.sourceUrl)||{language:item.language,total:0,categories:{}};
    old.total++;old.categories[item.category]=(old.categories[item.category]||0)+1;
    byPageStatus.set(item.sourceUrl,old);
  }
  return {classified:results,counts,byBranch,
    pages:[...byPageStatus].map(([sourceUrl,x])=>({sourceUrl,...x}))
      .sort((a,b)=>b.total-a.total||a.sourceUrl.localeCompare(b.sourceUrl))};
}
function run({auditPath,differencesPath,out}){
  const audit=JSON.parse(fs.readFileSync(auditPath,'utf8'));
  const diff=parseCsv(fs.readFileSync(differencesPath,'utf8'));
  const result=triage(audit,diff);
  fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'triage.csv'),csv(result.classified,
    ['sourceUrl','language','category','confidence','reason','result','targetWork','href','quote','selector','sourceElement']));
  fs.writeFileSync(path.join(out,'triage.json'),JSON.stringify({
    revision:audit.revision,seed:audit.seed,sampleCount:audit.samples.length,
    snapshotStatus:audit.counters,counts:result.counts,byBranch:result.byBranch,pages:result.pages
  },null,2)+'\n');
  const md=[
    '# Research Board discrepancy triage',
    '',
    'Revision: '+audit.revision,
    'Sample pages: '+audit.samples.length,
    'Current-page mismatch candidates: '+result.classified.length,
    '',
    '| Category | Candidate links |',
    '| --- | ---: |',
    ...Object.entries(result.counts).sort((a,b)=>b[1]-a[1]).map(([k,v])=>'| '+k+' | '+v+' |'),
    '',
    'These categories are REVIEW LABELS. They do not establish true false positives or false negatives.',
    'Menus require link context and are filtered independently. Changing source snapshots cannot establish causal missed links.',
    'The tool-box and published-only cases remain unresolved pending same-time comparison.',
    '',
    '## Page-level follow-up',
    '',
    '| Source page | Candidates | Classifications |',
    '| --- | ---: | --- |',
    ...result.pages.map(p=>'| '+p.sourceUrl+' | '+p.total+' | '+
      Object.entries(p.categories).map(([k,n])=>k+': '+n).join(', ')+' |')
  ];
  fs.writeFileSync(path.join(out,'TRIAGE.md'),md.join('\n')+'\n');
  return {counts:result.counts,pages:result.pages.length,output:out};
}
function args(argv){
  const r={auditPath:null,differencesPath:null,out:null};
  for(let i=0;i<argv.length;i++){
    if(argv[i]==='--audit')r.auditPath=argv[++i];
    else if(argv[i]==='--differences')r.differencesPath=argv[++i];
    else if(argv[i]==='--out')r.out=argv[++i];
    else throw Error('Unknown arg '+argv[i]);
  }
  if(!r.auditPath||!r.differencesPath||!r.out)throw Error('Provide --audit, --differences, --out');
  return r;
}
if(require.main===module)try{
  console.log(JSON.stringify(run(args(process.argv.slice(2))),null,2));
}catch(e){console.error(e);process.exitCode=1;}
module.exports={parseCsv,csv,triage,labelDifference,siblingNavigationEvidence,run};
