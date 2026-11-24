'use strict';
// The audited graph belongs on the publisher. Only this projection is shipped.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {digest}=require('./extract');
const overviewKeys=['pageCount','tileSize','width','height','geometryWarp',
  'sections','branches','ambiguousWorkKeys','ambiguousArticleIds',
  'originalAbsentVisibilityPolicy','hiddenOriginalUnavailableWorkCount',
  'retiredArticleVisibilityPolicy','hiddenRetiredPageCount','hiddenRetiredWorkCount','license','licenseUrl'];
function runtimeBoard(board){
  const overview=Object.fromEntries(overviewKeys.filter(k=>board.overview[k]!==undefined).map(k=>[k,board.overview[k]]));
  // Lanes and graph-building metadata have no display consumer.
  overview.branches=overview.branches.map(({code,x,y,width,height,count,polygon})=>({code,x,y,width,height,count,polygon}));
  overview.sections=overview.sections.map(({id,branch,kind,label,count,x,y,radius,polygon})=>({id,branch,kind,label,count,x,y,radius,polygon}));
  const nodes=board.nodes.map(n=>{
    const primary=n[13].findIndex(p=>p[0]===n[11]&&p[1]===n[6]&&p[2]===n[4]&&p[3]===n[5]);
    if(primary<0)throw Error('Missing canonical board page: '+n[0]);
    const pages=n[13].map(p=>{
      const row=p.slice(0,4),image=board.pageImages?.[p[1]];
      if(image)row.push(image);
      return row;
    });
    // The work key already lives in aliases. Most article IDs also derive from
    // aliases; only exceptional IDs need an explicit trailing field.
    const aliases=n[14][2];
    const ids=aliases.filter(k=>k.indexOf(':',8)>8).map(k=>k.substring(k.indexOf(':',8)+1)).filter(id=>!id.includes('@work-'));
    const row=[n[0],n[1],n[2],n[3],n[8],n[12],pages,aliases,primary];
    if(n[14][1]&&!ids.includes(n[14][1]))row.push(n[14][1]);
    return row;
  });
  const retired=new Set(board.hiddenRetiredPageUrls||[]);
  // Evaluate page-level evidence before omitting the publisher's proof records.
  const edges=board.edges.filter(e=>board.overview.types[e[2]]==='references'&&
    (e[4]||[e[3]]).some(id=>!retired.has(board.proofs[id][0]))).map(e=>e.slice(0,2));
  overview.nodeCount=nodes.length;overview.sourcePageCount=board.overview.sourcePageCount;
  overview.edgeCount=edges.length;
  const content={schemaVersion:4,overview,nodes,edges,
    hiddenOriginalUnavailableNodeIds:board.hiddenOriginalUnavailableNodeIds||[],
    hiddenRetiredPageUrls:board.hiddenRetiredPageUrls||[],
    hiddenRetiredNodeIds:board.hiddenRetiredNodeIds||[]};
  const revision=digest(JSON.stringify(content)).slice(0,20);
  return {...content,revision,overview:{...overview,schemaVersion:4,revision}};
}
function writeDelivery(board,input,output){
  const runtime=runtimeBoard(board),raw=Buffer.from(JSON.stringify(runtime));
  const bytes=zlib.gzipSync(raw,{level:9});
  if(raw.length>160*1024*1024||bytes.length>32*1024*1024)throw Error('Research board client size limit exceeded');
  const sha256=digest(bytes),fileName=`board-${sha256}.json.gz`;
  const directory=path.join(output,'research-board');fs.mkdirSync(directory,{recursive:true});
  const pointer=path.join(directory,'manifest.json');
  const previous=fs.existsSync(pointer)?JSON.parse(fs.readFileSync(pointer)):null;
  // Keep all evidence outside the app's delivery directory, paired by revision.
  const audit=path.join(input,'research-board-audit.json.gz');
  fs.writeFileSync(audit+'.tmp',zlib.gzipSync(JSON.stringify({runtimeRevision:runtime.revision,board}),{level:9}));
  fs.renameSync(audit+'.tmp',audit);
  fs.writeFileSync(path.join(directory,fileName),bytes);
  const manifest={schemaVersion:4,revision:runtime.revision,timestamp:board.overview.generatedAt,
    fileName,bytes:bytes.length,decodedBytes:raw.length,sha256,nodeCount:runtime.nodes.length,edgeCount:runtime.edges.length};
  fs.writeFileSync(pointer+'.tmp',JSON.stringify(manifest)+'\n');fs.renameSync(pointer+'.tmp',pointer);
  // Retain one previous v4 target for cached manifests, without legacy formats.
  const prior=previous?.schemaVersion===4?previous.fileName:null;
  if(prior!==fileName)for(const name of fs.readdirSync(directory))if(/^board-[a-f0-9]{64}\.json\.gz$/.test(name)&&name!==fileName&&name!==prior)fs.unlinkSync(path.join(directory,name));
  return manifest;
}
function loadAudit(input){
  const manifest=JSON.parse(fs.readFileSync(path.join(input,'mobile-v3/research-board/manifest.json')));
  const audit=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(input,'research-board-audit.json.gz'))));
  if(audit.runtimeRevision!==manifest.revision)throw Error('Board audit revision mismatch');
  return audit.board;
}
module.exports={runtimeBoard,writeDelivery,loadAudit};
