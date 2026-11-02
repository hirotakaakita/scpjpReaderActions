'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { buildGraph } = require('./build');
const { skillLayout } = require('./skill-layout');
function renderPreview(graph, file) {
  const layout = skillLayout(graph);
  const nodeIndex=new Map(layout.nodes.map((n,i)=>[n.id,i]));
  const active=graph.edges.filter(e=>e.type!=='has_tag'&&!e.inactive&&!e.stale);
  const edgeIndex=new Map(active.map((e,i)=>[e.id,i]));
  const data={manifest:graph.manifest, ...layout,
    nodes:layout.nodes.map(n=>Object.fromEntries(['id','kind','title','branch','slug','url','coverage','pageKind','checkedAt','contentSha256','x','y','degree'].filter(k=>n[k]!==undefined).map(k=>[k,n[k]]))),
    links:layout.links.map(e=>({...e,evidence:e.evidence.map(id=>edgeIndex.get(id))})),
    compactEvidence:true,
    evidence:active.map(e=>[nodeIndex.get(e.source),nodeIndex.get(e.target),e.type,e.evidence.filter(p=>!p.inactive&&!p.stale).map(p=>[nodeIndex.get(require('./core').normalizePage(p.sourceUrl).id),p.location,p.sourceAnchor||null,p.section||null,p.quote||null,p.note||null,p.method||null])])};
  const template=fs.readFileSync(path.join(__dirname,'skill-tree.html'),'utf8');
  const [head,tail]=template.split('__GRAPH_DATA__');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary=file+'.'+process.pid+'.tmp',fd=fs.openSync(temporary,'w');let pending='';
  const write=text=>{pending+=text;if(pending.length>=1048576){fs.writeFileSync(fd,pending);pending='';}};
  const safe=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026');
  try{write(head);write('{');let first=true;
    for(const [key,value] of Object.entries(data)){if(!first)write(',');first=false;write(safe(key)+':');
      if(Array.isArray(value)){write('[');for(let i=0;i<value.length;i++){if(i)write(',');write(safe(value[i]));}write(']');}else write(safe(value));
    }write('}');write(tail);if(pending)fs.writeFileSync(fd,pending);
  }finally{fs.closeSync(fd);}
  fs.renameSync(temporary,file);
  return { displayedNodes: data.nodes.length, edges: data.links.length };
}
if (require.main === module) {
  const graph = buildGraph({ catalogDir: path.join(__dirname, '..', 'local-data'), recordDirs: [
    path.join(__dirname, '.cache', 'records'), path.join(__dirname, '..', 'partial-data', 'relations') ] });
  console.log(renderPreview(graph, process.argv[2] || path.join(__dirname, 'output', 'preview.html')));
}
module.exports = { renderPreview };
