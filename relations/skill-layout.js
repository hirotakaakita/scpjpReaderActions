'use strict';
const { digest } = require('./core');

// Presentation only. Every displayed connection still comes from an evidence edge.
function skillLayout(graph) {
  const evidence = graph.edges.filter(e => e.type !== 'has_tag' && !e.inactive && !e.stale);
  const included = new Set(evidence.flatMap(e => [e.source, e.target]));
  for (const n of graph.nodes) if (n.kind === 'page' && n.coverage === 'fetched') included.add(n.id);
  const nodes = graph.nodes.filter(n => ['page','entity'].includes(n.kind) && included.has(n.id))
    .map(n => ({ ...n, degree: 0 }));
  const byId = new Map(nodes.map((n, i) => [n.id, { node: n, index: i }]));
  const pairs = new Map();
  for (const e of evidence) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    const key = [e.source, e.target].sort().join('\0');
    if (!pairs.has(key)) pairs.set(key, { a: byId.get(e.source).index, b: byId.get(e.target).index, evidence: [] });
    pairs.get(key).evidence.push(e.id);
  }
  const links = [...pairs.values()];
  for (const e of links) { nodes[e.a].degree++; nodes[e.b].degree++; }
  const groups = new Map();
  nodes.forEach((n, i) => {
    if (!groups.has(n.branch)) groups.set(n.branch, []);
    groups.get(n.branch).push(i);
  });
  const clusters = [...groups].map(([branch, members]) => ({ branch, members,
    radius: Math.max(115, Math.sqrt(members.length) * 28) }))
    .sort((a, b) => b.members.length - a.members.length || a.branch.localeCompare(b.branch));
  const placed = [];
  for (const cluster of clusters) {
    let step = 0;
    do {
      const angle = step * 2.399963229728653;
      const r = step === 0 ? 0 : 80 * Math.sqrt(step);
      cluster.x = Math.cos(angle) * r * 1.45; cluster.y = Math.sin(angle) * r * .8;
      step++;
    } while (placed.some(p => Math.hypot(cluster.x - p.x, cluster.y - p.y) < cluster.radius + p.radius + 145));
    placed.push(cluster);
    cluster.members.sort((a, b) => nodes[b].degree - nodes[a].degree || nodes[a].id.localeCompare(nodes[b].id));
    cluster.members.forEach((index, order) => {
      const n = nodes[index];
      const angle = order * 2.399963229728653 + parseInt(digest(cluster.branch).slice(0, 4), 16) / 65536;
      const r = cluster.radius * .88 * Math.sqrt(order / Math.max(1, cluster.members.length));
      n.x = cluster.x + Math.cos(angle) * r;
      n.y = cluster.y + Math.sin(angle) * r;
    });
  }
  // Separate ordinary reports from supplemental documents inside each branch.
  for (const c of clusters) {
    const categories = ['scp','log','hub','tale','document','organization'];
    const used = categories.filter(k=>c.members.some(i=>(nodes[i].pageKind?.type || 'document')===k));
    c.sections=[];
    for (const [slot,kind] of used.entries()) {
      const members=c.members.filter(i=>(nodes[i].pageKind?.type || 'document')===kind);
      const angle=slot*2*Math.PI/used.length;
      const center={x:c.x+Math.cos(angle)*c.radius*.53,y:c.y+Math.sin(angle)*c.radius*.53};
      const radius=c.radius*Math.min(.36, .2+Math.sqrt(members.length/c.members.length)*.16);
      c.sections.push({...center,kind});
      members.forEach((index,order)=>{const a=order*2.399963229728653,r=radius*Math.sqrt(order/Math.max(1,members.length));nodes[index].x=center.x+Math.cos(a)*r;nodes[index].y=center.y+Math.sin(a)*r;nodes[index].region={...center,radius};});
    }
  }
  const clusterOf = new Map(clusters.map(c => [c.branch, c]));
  // Sparse collision grid + real-reference springs. Branches remain visual islands.
  for (let iteration = 0; iteration < 100; iteration++) {
    const grid = new Map();
    const force = nodes.map(() => [0, 0]);
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]; const gx = Math.floor(n.x / 45), gy = Math.floor(n.y / 45);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(`${gx + dx},${gy + dy}`) || []) {
          const other = nodes[j]; let vx = n.x - other.x, vy = n.y - other.y;
          let distance = Math.hypot(vx, vy);
          if (distance < .001) { vx = .1; vy = .1; distance = Math.hypot(vx, vy); }
          const separation = 24 + Math.min(18, Math.sqrt(n.degree) + Math.sqrt(other.degree));
          if (distance < separation) {
            const strength = (separation - distance) * .2;
            force[i][0] += vx / distance * strength; force[i][1] += vy / distance * strength;
            force[j][0] -= vx / distance * strength; force[j][1] -= vy / distance * strength;
          }
        }
      }
      const key = `${gx},${gy}`; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(i);
    }
    for (const e of links) {
      const a = nodes[e.a], b = nodes[e.b];
      if (a.branch !== b.branch) continue;
      const vx = b.x - a.x, vy = b.y - a.y, distance = Math.hypot(vx, vy) || 1;
      const strength = (distance - 85) * .022 / Math.sqrt(Math.max(a.degree, b.degree, 1));
      force[e.a][0] += vx / distance * strength; force[e.a][1] += vy / distance * strength;
      force[e.b][0] -= vx / distance * strength; force[e.b][1] -= vy / distance * strength;
    }
    nodes.forEach((n, i) => {
      n.x += Math.max(-7, Math.min(7, force[i][0])); n.y += Math.max(-7, Math.min(7, force[i][1]));
      const c = n.region || clusterOf.get(n.branch), d = Math.hypot(n.x - c.x, n.y - c.y);
      if (d > c.radius) { n.x = c.x + (n.x - c.x) / d * c.radius; n.y = c.y + (n.y - c.y) / d * c.radius; }
    });
  }
  // Highlight a spanning forest made ONLY of existing connections, for visual hierarchy.
  const neighbors = nodes.map(() => []);
  links.forEach((e, index) => { neighbors[e.a].push([e.b, index]); neighbors[e.b].push([e.a, index]); });
  const visited = new Set();
  for (const c of clusters) for (const root of c.members) {
    if (visited.has(root)) continue;
    const queue = [root]; visited.add(root);
    for (let head = 0; head < queue.length; head++) {
      for (const [child, edge] of neighbors[queue[head]]) {
        if (nodes[child].branch !== c.branch || visited.has(child)) continue;
        visited.add(child); queue.push(child); links[edge].trunk = true;
      }
    }
  }
  const bounds=nodes.reduce((b,n)=>({minX:Math.min(b.minX,n.x-90),minY:Math.min(b.minY,n.y-140),maxX:Math.max(b.maxX,n.x+90),maxY:Math.max(b.maxY,n.y+90)}),{minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity});
  return {nodes,links,clusters:clusters.map(({members,...c})=>({...c,count:members.length})),bounds:nodes.length?bounds:{minX:-1,minY:-1,maxX:1,maxY:1}};
}
module.exports={skillLayout};
