'use strict';
// Offline, deterministic star systems. Layout proximity is presentation only.
const GOLDEN=2.399963229728653;
function pack(items,padding=32){
 const maxRadius=Math.max(1,...items.map(i=>i.radius)),cellSize=maxRadius*2+padding,grid=new Map();
 function neighbors(x,y){const found=[];const gx=Math.floor(x/cellSize),gy=Math.floor(y/cellSize);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)found.push(...(grid.get(`${gx+dx}:${gy+dy}`)||[]));return found;}
 for(const item of items){let step=0;do{const angle=step*GOLDEN,r=step===0?0:24*Math.sqrt(step);item.x=Math.cos(angle)*r;item.y=Math.sin(angle)*r;step++;}while(neighbors(item.x,item.y).some(p=>Math.hypot(item.x-p.x,item.y-p.y)<item.radius+p.radius+padding));
 const key=`${Math.floor(item.x/cellSize)}:${Math.floor(item.y/cellSize)}`;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(item);
 }return items;
}

function starLayout(nodes,neighbors){
 const byIndex=new Map(nodes.map(n=>[n.index,n])),branches=[...new Set(nodes.map(n=>n.branch))].sort(),sections=[],groups=[],trunks=[];
 for(const n of nodes)n.degree=neighbors[n.index].size;
 for(const code of branches){
  const members=nodes.filter(n=>n.branch===code),buckets=new Map();
  for(const node of members){const match=node.slug.match(/^scp-(?:[a-z]{1,4}-)?(\d+)/i),start=match?Math.floor(Number(match[1])/500)*500:null;
   const label=node.kindIndex===0&&start!==null?`${String(start).padStart(3,'0')}–${start+499}`:node.kindIndex===0?'SPECIAL':null;
   const key=node.kindIndex+':'+(label||'');if(!buckets.has(key))buckets.set(key,{kind:node.kindIndex,label,nodes:[]});buckets.get(key).nodes.push(node);
  }
  const local=[];
  for(const [key,bucket]of [...buckets].sort(([a],[b])=>a.localeCompare(b,'en',{numeric:true}))){
   bucket.nodes.sort((a,b)=>a.id.localeCompare(b.id,'en'));
   for(let start=0;start<bucket.nodes.length;start+=400){
    const list=bucket.nodes.slice(start,start+400),available=new Set(list.map(n=>n.index)),systems=[];
    const ranked=[...list].sort((a,b)=>b.degree-a.degree||a.id.localeCompare(b.id,'en'));
    for(const root of ranked){if(!available.delete(root.index))continue;const group=[root],queue=[root.index],links=[];
     for(let at=0;at<queue.length&&group.length<48;at++){
      const candidates=[...neighbors[queue[at]]].filter(id=>available.has(id)).sort((a,b)=>byIndex.get(b).degree-byIndex.get(a).degree||a-b);
      for(const id of candidates){if(group.length>=48)break;available.delete(id);links.push([queue[at],id]);group.push(byIndex.get(id));queue.push(id);}
     }
     // Isolated articles remain independent stars, without invented connections.
     systems.push({nodes:group,links,hub:root.index,radius:group.length===1?12:Math.sqrt(group.length)*18+12});
    }
    systems.sort((a,b)=>b.nodes.length-a.nodes.length||a.hub-b.hub);pack(systems,20);
    const radius=Math.max(80,...systems.map(s=>Math.hypot(s.x,s.y)+s.radius))+34;
    const section={id:`${code}:${key}:${start/400}`,branch:code,kind:bucket.kind,label:bucket.label?bucket.label+(bucket.nodes.length>400?` · ${start/400+1}`:''):`${start/400+1}`,count:list.length,radius,systems,nodes:list};local.push(section);
   }
  }
  local.sort((a,b)=>b.count-a.count||a.id.localeCompare(b.id,'en'));pack(local,70);
  const radius=Math.max(...local.map(s=>Math.hypot(s.x,s.y)+s.radius))+100;
  groups.push({code,nodes:members,radius,sections:local});
 }
 groups.sort((a,b)=>b.nodes.length-a.nodes.length||a.code.localeCompare(b.code));pack(groups,240);
 const minX=Math.min(...groups.map(b=>b.x-b.radius))-100,minY=Math.min(...groups.map(b=>b.y-b.radius))-100;
 for(const b of groups){b.x-=minX;b.y-=minY;b.width=b.height=b.radius*2;b.left=b.x-b.radius;b.top=b.y-b.radius;b.lanes=[];
  for(const s of b.sections){s.x+=b.x;s.y+=b.y;
   for(const system of s.systems){system.x+=s.x;system.y+=s.y;
    system.nodes.forEach((node,i)=>{const angle=i*GOLDEN,r=i===0?0:18*Math.sqrt(i);node.x=Math.round((system.x+Math.cos(angle)*r)*100)/100;node.y=Math.round((system.y+Math.sin(angle)*r)*100)/100;node.section=s.id;});
   }
   for(const system of s.systems)trunks.push(...system.links.slice(0,2));
   sections.push({id:s.id,branch:s.branch,kind:s.kind,label:s.label,x:s.x,y:s.y,radius:s.radius,count:s.count});
  }
 }
 return{groups,sections,trunks:trunks.slice(0,2000),width:Math.max(...groups.map(b=>b.x+b.radius))+100,height:Math.max(...groups.map(b=>b.y+b.radius))+100};
}
module.exports={starLayout};
