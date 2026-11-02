'use strict';
// Rebuild from crawler snapshots, without network or model calls.
const fs=require('fs'),path=require('path'),zlib=require('zlib'),crypto=require('crypto');
const source=path.resolve(process.argv[2]||path.join(__dirname,'../output'));
const out=path.resolve(process.argv[3]||path.join(__dirname,'../mobile-output'));
const {lines,fileHash}=require(path.join(source,'../jsonl'));
const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json')));
for(const item of Object.values(manifest.files)){if(fileHash(path.join(source,item.path))!==item.sha256)throw Error('Source checksum mismatch: '+item.path);}
const kinds=['scp','log','hub','tale','organization','document'];
const nodes=[];for(const line of lines(path.join(source,manifest.files.nodes.path))){const n=JSON.parse(line);if(n.kind==='page'||n.kind==='entity')nodes.push(n);}
nodes.sort((a,b)=>a.id.localeCompare(b.id,'en'));const byId=new Map(nodes.map((n,i)=>[n.id,Object.assign(n,{index:i,kindIndex:Math.max(0,kinds.indexOf(n.pageKind?.type||'document'))})]));
const neighbors=Array.from({length:nodes.length},()=>new Set());
for(const line of lines(path.join(source,manifest.files.edges.path))){const e=JSON.parse(line);if(e.type==='has_tag'||e.stale||e.inactive)continue;const a=byId.get(e.source),b=byId.get(e.target);if(a&&b){neighbors[a.index].add(b.index);neighbors[b.index].add(a.index);}}
const {starLayout}=require('./research_board_layout.cjs');
const {groups,sections,trunks}=starLayout(nodes,neighbors),tileSize=320;
require('./research_board_regions.cjs').regionLayout(groups,sections);
const {warp,width,height}=require('./research_board_warp.cjs').warpLayout(nodes,groups,sections);
const revision=crypto.createHash('sha256').update(manifest.revision+'|'+fs.readFileSync(__filename,'utf8')+'|'+fs.readFileSync(path.join(__dirname,'research_board_layout.cjs'),'utf8')+'|'+fs.readFileSync(path.join(__dirname,'research_board_regions.cjs'),'utf8')+'|'+fs.readFileSync(path.join(__dirname,'research_board_warp.cjs'),'utf8')).digest('hex').slice(0,20);
fs.mkdirSync(out,{recursive:true});const files={};function write(name,value){const bytes=zlib.gzipSync(Buffer.from(JSON.stringify({revision,...value})),{level:9});fs.writeFileSync(path.join(out,name),bytes);files[name]={bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};}
const tiles=new Map(),points=new Map(),metadata=Array.from({length:Math.ceil(nodes.length/256)},()=>[]),search={};
function compact(n){return[n.index,n.x,n.y,n.kindIndex,n.slug,n.title||n.slug,n.url,n.coverage||'unfetched',n.branch,n.degree,n.section];}
for(const n of nodes){const key=Math.floor(n.x/tileSize)+'_'+Math.floor(n.y/tileSize);if(!tiles.has(key))tiles.set(key,[]);tiles.get(key).push(compact(n));metadata[Math.floor(n.index/256)].push(compact(n));
 const cell=n.branch+':'+Math.floor(n.x/180)+':'+Math.floor(n.y/180);if(!points.has(cell))points.set(cell,[n.x,n.y,0,n.branch,n.kindIndex]);const p=points.get(cell);p[2]++;
 (search[n.branch]||=[]).push(compact(n));}
for(const [key,rows]of tiles)write('tile_'+key+'.json.gz',{nodes:rows});
for(let i=0;i<metadata.length;i++)write('nodes_'+i+'.json.gz',{nodes:metadata[i]});
for(const [code,rows]of Object.entries(search))write('search_'+code+'.json.gz',{nodes:rows});
const adjacency=Array.from({length:256},()=>({})),edgeTypes={},typeNames=[];let edges=0,reviewed=0;const branchConnections=new Map(),aggregates=new Map(),proofs=[],proofIds=new Map();
function type(t){if(edgeTypes[t]===undefined){edgeTypes[t]=typeNames.length;typeNames.push(t);}return edgeTypes[t];}
// Only explicit links and source-specific reviewed assertions are exported.
// Runtime model outputs and keyword candidates are deliberately excluded.
for(const line of lines(path.join(source,manifest.files.edges.path))){const e=JSON.parse(line);if(e.type==='has_tag'||e.stale||e.inactive)continue;const a=byId.get(e.source),b=byId.get(e.target);if(!a||!b)throw Error('Unknown graph endpoint: '+e.id);
 const evidence=e.evidence?.[0]||{};const semantic=!['references','translation_assertion'].includes(e.type);const displayType=e.type==='references'?(evidence.section?.kind==='addendum'?'appears_in_addendum':a.pageKind?.type==='log'?'appears_in_log':'references'):e.type;if(semantic&&!e.evidence?.some(p=>p.method==='source_specific_exact_quote'||p.location==='publisher_breadcrumb'))continue;
 const proof=[evidence.sourceUrl||a.url,evidence.quote||evidence.excerpt||'',evidence.section?.title ? (evidence.location||'')+' / '+evidence.section.title : evidence.location||'',evidence.contentSha256||'',evidence.sourceAnchor||'',evidence.note||''];
 const signature=JSON.stringify(proof);let proofId=proofIds.get(signature);if(proofId===undefined){proofId=proofs.length;proofIds.set(signature,proofId);proofs.push(proof);}
 const t=type(displayType);for(const [n,other,direction]of [[a,b,1],[b,a,-1]]){const bucket=adjacency[n.index%256];(bucket[n.index]||=[]).push([other.index,t,direction,proofId]);}
 const cell=n=>n.branch+':'+Math.floor(n.x/180)+':'+Math.floor(n.y/180);const ca=cell(a),cb=cell(b);if(ca!==cb){const key=[ca,cb].sort().join('|');const group=aggregates.get(key)||{a:ca,b:cb,count:0,cross:a.branch!==b.branch};group.count++;aggregates.set(key,group);}
 if(a.branch!==b.branch){const key=[a.branch,b.branch].sort().join('|');branchConnections.set(key,(branchConnections.get(key)||0)+1);}
 edges++;if(semantic)reviewed++;
}
for(let i=0;i<256;i++)write('adj_'+i+'.json.gz',{adjacency:adjacency[i]});
for(let i=0;i<128;i++)write('evidence_'+i+'.json.gz',{evidence:proofs.map((p,id)=>[id,p]).filter(([id])=>id%128===i)});
const overview={schemaVersion:1,revision,generatedAt:manifest.generatedAt,sourceRevision:manifest.revision,sourceGeneratedAt:manifest.generatedAt,pageCount:nodes.filter(n=>n.kind==='page').length,nodeCount:nodes.length,edgeCount:edges,reviewedEdgeCount:reviewed,semanticCoverage:'partial_source_specific_only',tileSize,width,height,layout:"fixed_star_systems",geometryWarp:warp,sections,trunks:trunks.map(([a,b])=>[nodes[a].x,nodes[a].y,nodes[b].x,nodes[b].y,a,b]),branches:groups.map(b=>({code:b.code,x:b.left,y:b.top,width:b.width,height:b.height,count:b.nodes.length,lanes:b.lanes,polygon:b.polygon})),points:[...points.values()],branchLinks:[...branchConnections].sort((a,b)=>b[1]-a[1]).slice(0,36).map(([k,count])=>[...k.split('|'),count]),aggregateLinks:[...aggregates.values()].sort((a,b)=>Number(b.cross)-Number(a.cross)||b.count-a.count).slice(0,900).map(g=>[points.get(g.a)[0],points.get(g.a)[1],points.get(g.b)[0],points.get(g.b)[1],g.count]),tiles:[...tiles.keys()],kinds,types:typeNames,license:'CC BY-SA 3.0',licenseUrl:manifest.licenseUrl};
write('overview.json.gz',overview);for(const name of fs.readdirSync(out)){if(/^(?:tile_\d+_\d+|nodes_\d+|adj_\d+|evidence_\d+|search_[a-z-]+|overview)\.json\.gz$/.test(name)&&!files[name])fs.unlinkSync(path.join(out,name));}fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({schemaVersion:1,revision,sourceRevision:manifest.revision,files}));
console.log(JSON.stringify({revision,pages:overview.pageCount,nodes:nodes.length,edges,reviewed,tiles:tiles.size,files:Object.keys(files).length,bytes:Object.values(files).reduce((a,f)=>a+f.bytes,0)}));
