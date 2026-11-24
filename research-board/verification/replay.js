'use strict';
// Replay raw frozen HTML from a previous GitHub artifact without re-fetching.
// This proves that a verifier change fixes the SAME exact publisher bytes.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {loadBoard,buildIndex}=require('./audit');
const ref=require('./reference'),prod=require('../extract');
const {primaryWorks,compareThree}=require('./same-snapshot');
function replay(input,out){
  const snapshot=JSON.parse(fs.readFileSync(path.join(input,'same-snapshot-summary.json'),'utf8'));
  const {board}=loadBoard();
  if(snapshot.revision!==board.revision)throw Error('Published board revision differs');
  const index=buildIndex(board),pages=new Map(index.pages.map(p=>[p.url,p]));
  const output=[],totals={},failures=[];
  for(const row of snapshot.rows){
    if(row.status!=='compared')continue;
    const page=pages.get(row.url);if(!page)throw Error('Source no longer in graph '+row.url);
    const format=row.format||'html';
    const source=fs.readFileSync(path.join(input,'raw',row.sha+'.'+format+'.gz'));
    const body=zlib.gunzipSync(source).toString('utf8');
    const metadata=path.join(input,'raw',row.sha+'.api.json.gz');
    const detail=fs.existsSync(metadata)?JSON.parse(zlib.gunzipSync(fs.readFileSync(metadata))):{source:body};
    const primary=format==='html'?prod.extractHtml(body,page.url):prod.extractFtml(detail,page.url);
    const independent=format==='html'?ref.fromHtml(body,page.url,index.workByUrl,index.supportedHosts):
      ref.fromFtml(body,page.url,index.workByUrl,index.supportedHosts,detail.title);
    const primarySet=primaryWorks(primary.links,page,index);
    const comparison=compareThree(page.expected,primarySet,independent);
    const parserDiff=[...new Set([...primarySet.keys(),...independent.links.keys()])]
      .filter(key=>primarySet.has(key)!==independent.links.has(key)).length;
    for(const [type,n] of Object.entries(comparison.totals))totals[type]=(totals[type]||0)+n;
    output.push({url:row.url,language:row.language,sha256:row.sha,
      graph:page.expected.size,primary:primarySet.size,independent:independent.links.size,
      parserDiff,classification:comparison.totals});
    if(parserDiff)failures.push(...comparison.findings.filter(f=>
      primarySet.has(f.work)!==independent.links.has(f.work)).map(f=>({url:row.url,...f})));
  }
  fs.mkdirSync(out,{recursive:true});
  const result={sourceRevision:snapshot.revision,inputPageCount:snapshot.compared,
    replayed:output.length,parserMismatchedPages:output.filter(r=>r.parserDiff).length,
    parserMismatchedEdges:failures.length,categoryTotals:totals,pages:output,remaining:failures};
  fs.writeFileSync(path.join(out,'REPLAY.json'),JSON.stringify(result,null,2)+'\n');
  fs.writeFileSync(path.join(out,'REPLAY.md'),[
    '# Frozen same-snapshot replay','',
    'Frozen pages replayed: '+result.replayed,
    'Page-level disagreements between both parsers: '+result.parserMismatchedPages,
    'Link disagreements between both parsers: '+result.parserMismatchedEdges,
    '','| Difference category | Count |','| --- | ---: |',
    ...Object.entries(totals).sort((a,b)=>b[1]-a[1]).map(([k,v])=>'| '+k+' | '+v+' |'),
    '','Every byte of publisher HTML was preserved and reused. This does NOT prove that',
    'the older publication matched the live site: only same-time parser consistency is measured.'
  ].join('\n')+'\n');
  console.log(JSON.stringify({replayed:result.replayed,mismatches:result.parserMismatchedEdges,totals},null,2));
  if(result.parserMismatchedEdges)process.exitCode=2;
  return result;
}
if(require.main===module){
  if(process.argv.length<4)throw Error('Usage: replay.js <frozen-snapshot-dir> <output-dir>');
  try{replay(path.resolve(process.argv[2]),path.resolve(process.argv[3]));}
  catch(e){console.error(e);process.exitCode=1;}
}
module.exports={replay};
