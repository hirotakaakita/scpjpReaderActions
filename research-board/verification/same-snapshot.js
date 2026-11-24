'use strict';
// Same HTTP response -> production parser and independent verifier. Read only.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {loadBoard,buildIndex,networkCapture}=require('./audit');
const ref=require('./reference'),prod=require('../extract');
const root=path.resolve(__dirname,'../..');
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
const save=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p+'.tmp',v);fs.renameSync(p+'.tmp',p);};
const escapeCsv=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
function primaryWorks(rawLinks,source,index){
  const works=new Map();
  for(const l of rawLinks){
    const url=ref.normalizedUrl(l.target,source.url),work=url&&index.workByUrl.get(url);
    if(!work||work===source.workId)continue;
    if(!works.has(work))works.set(work,[]);
    works.get(work).push(l);
  }
  return works;
}
function compareThree(graph,p,i){
  const union=[...new Set([...graph,...p.keys(),...i.links.keys()])].sort();
  const findings=[],totals={};
  for(const work of union){
    const g=graph.has(work),a=p.has(work),b=i.links.has(work);
    if(g&&a&&b)continue;
    let kind;
    if(a&&b&&!g)kind='both_current_only';
    else if(g&&!a&&!b)kind='published_only_both_absent';
    else if(g&&a&&!b)kind='independent_parser_omission';
    else if(g&&b&&!a)kind='primary_parser_exclusion_conflict';
    else if(!g&&b&&!a)kind='independent_only_candidate';
    else if(!g&&a&&!b)kind='primary_only_candidate';
    else kind='unexpected';
    totals[kind]=(totals[kind]||0)+1;
    const evidence=i.links.get(work)?.[0],producer=p.get(work)?.[0];
    findings.push({work,kind,graph:g,primary:a,independent:b,
      href:evidence?.href||producer?.target||'',quote:evidence?.quote||producer?.quote||'',
      selector:evidence?.selector||'',html:evidence?.sourceElement||''});
  }
  return {findings,totals};
}
function report(dir,baseline,revision,rows){
  const total={};
  for(const page of rows)for(const [key,n] of Object.entries(page.totals||{}))total[key]=(total[key]||0)+n;
  const summary={revision,seed:baseline.seed,generatedAt:new Date().toISOString(),
    pageCount:rows.length,compared:rows.filter(x=>x.status==='compared').length,
    errors:rows.filter(x=>x.status==='error').length,totals:total,
    rows:rows.map(({findings,...r})=>r)};
  save(path.join(dir,'same-snapshot-summary.json'),JSON.stringify(summary,null,2)+'\n');
  const flat=rows.flatMap(p=>(p.findings||[]).map(f=>({sourceUrl:p.url,language:p.language,...f})));
  const keys=['sourceUrl','language','kind','graph','primary','independent','work','href','quote','selector','html'];
  save(path.join(dir,'same-snapshot-evidence.csv'),
    [keys.map(escapeCsv).join(','),...flat.map(x=>keys.map(k=>escapeCsv(x[k])).join(','))].join('\n')+'\n');
  const md=['# Same-response verification', '',
    'Page count: '+rows.length,'Compared: '+summary.compared,'Errors: '+summary.errors,
    '','| Category | Links |','| --- | ---: |',
    ...Object.entries(total).sort((a,b)=>b[1]-a[1]).map(([k,v])=>'| '+k+' | '+v+' |'),
    '','Both parsers saw the identical response. Differences from the older board can still be time drift:',
    'the original full HTML was not saved in source-store.',
    '','| Source | Compared | Graph | Production | Independent | Parser disagreement | Error |',
    '| --- | --- | ---: | ---: | ---: | ---: | --- |',
    ...rows.map(p=>'| '+p.url+' | '+p.status+' | '+(p.graphCount??'-')+
      ' | '+(p.primaryCount??'-')+' | '+(p.independentCount??'-')+
      ' | '+(p.parserDifference??'-')+' | '+(p.error||'-')+' |')];
  save(path.join(dir,'SAME-SNAPSHOT.md'),md.join('\n')+'\n');
  return summary;
}
async function run({baseline,out,controls=5,delayMs=1300}){
  const old=JSON.parse(fs.readFileSync(baseline,'utf8')),{board}=loadBoard();
  if(board.revision!==old.revision)throw Error('Graph revision changed since baseline');
  const index=buildIndex(board),byUrl=new Map(index.pages.map(p=>[p.url,p]));
  const mismatches=old.samples.filter(p=>p.liveMatch===false&&p.status!=='fetch_error');
  const controlsSet=old.samples.filter(p=>p.liveMatch===true&&p.status!=='fetch_error').slice(0,controls);
  const selected=[...mismatches,...controlsSet];
  fs.mkdirSync(path.join(out,'raw'),{recursive:true});
  let last=0;const gate=async()=>{const ms=Math.max(0,last+delayMs-Date.now());if(ms)await sleep(ms);last=Date.now();};
  const rows=[];
  for(const [ix,source] of selected.entries()){
    const page=byUrl.get(source.url);if(!page)throw Error('Graph does not contain '+source.url);
    const row={url:page.url,language:page.language,status:'error',totals:{},baselineHash:source.currentSha};
    try{
      const snap=await networkCapture(page,index.supportedHosts,gate,20000);
      row.format=snap.format;
      row.sha=snap.sha;row.previousSampleChanged=snap.sha!==source.currentSha;
      fs.writeFileSync(path.join(out,'raw',snap.sha+'.'+snap.format+'.gz'),zlib.gzipSync(snap.content));
      if(snap.detail)fs.writeFileSync(path.join(out,'raw',snap.sha+'.api.json.gz'),zlib.gzipSync(JSON.stringify(snap.detail)));
      const primary=snap.format==='html'?prod.extractHtml(snap.content,page.url):
        prod.extractFtml(snap.detail||{source:snap.content},page.url);
      const independent=snap.format==='html'?
        ref.fromHtml(snap.content,page.url,index.workByUrl,index.supportedHosts):
        ref.fromFtml(snap.content,page.url,index.workByUrl,index.supportedHosts,snap.detail?.title);
      const primarySet=primaryWorks(primary.links,page,index);
      const diff=compareThree(page.expected,primarySet,independent);
      row.status='compared';row.graphCount=page.expected.size;
      row.primaryCount=primarySet.size;row.independentCount=independent.links.size;
      row.parserDifference=[...new Set([...primarySet.keys(),...independent.links.keys()])]
        .filter(w=>primarySet.has(w)!==independent.links.has(w)).length;
      row.totals=diff.totals;row.findings=diff.findings;
    }catch(e){row.error=String(e.message||e).slice(0,240);}
    rows.push(row);
    if((ix+1)%5===0||ix+1===selected.length){
      const res=report(out,old,board.revision,rows);
      console.log(JSON.stringify({progress:ix+1,total:selected.length,compared:res.compared,
        errors:res.errors,totals:res.totals}));
    }
  }
  return report(out,old,board.revision,rows);
}
if(require.main===module){
  const args=process.argv.slice(2),o={out:path.join(root,'research-board/verification/audit-results/same-snapshot')};
  for(let i=0;i<args.length;i++){
    if(args[i]==='--baseline')o.baseline=args[++i];
    else if(args[i]==='--out')o.out=path.resolve(args[++i]);
    else if(args[i]==='--controls')o.controls=Number(args[++i]);
    else throw Error('Unknown argument '+args[i]);
  }
  if(!o.baseline)throw Error('Missing --baseline');
  run(o).then(s=>console.log('RESULT '+JSON.stringify(s.totals))).catch(e=>{console.error(e);process.exitCode=1;});
}
module.exports={primaryWorks,compareThree,report,run};
