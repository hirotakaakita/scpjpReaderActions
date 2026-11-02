'use strict';
// Weighted Voronoi territories. Disjoint layout circles imply every member
// stays inside its original territory, even when district sizes differ.
function clip(polygon,a,b,c){const out=[];if(!polygon.length)return out;
 for(let i=0;i<polygon.length;i++){const p=polygon[i],q=polygon[(i+1)%polygon.length],dp=a*p[0]+b*p[1]-c,dq=a*q[0]+b*q[1]-c;
  if(dp<=1e-6)out.push(p);if((dp<0&&dq>0)||(dp>0&&dq<0)){const t=dp/(dp-dq);out.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]);}}
 return out;
}
function hull(points){const sorted=[...points].sort((a,b)=>a[0]-b[0]||a[1]-b[1]),cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]),lower=[],upper=[];
 for(const p of sorted){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
 for(const p of sorted.reverse()){while(upper.length>1&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}lower.pop();upper.pop();return lower.concat(upper);
}
function cell(site,others,boundary){let polygon=boundary;for(const other of others){if(site===other)continue;const a=other.x-site.x,b=other.y-site.y,c=(other.x**2+other.y**2-other.radius**2-site.x**2-site.y**2+site.radius**2)/2;polygon=clip(polygon,a,b,c);if(!polygon.length)break;}return polygon.map(p=>p.map(v=>Math.round(v*100)/100));}
function regionLayout(groups,sections){
 const outline=hull(groups.flatMap(g=>Array.from({length:64},(_,i)=>{const a=i*Math.PI/32;return[g.x+Math.cos(a)*g.radius,g.y+Math.sin(a)*g.radius];})));
 for(const group of groups){group.polygon=cell(group,groups,outline);const districts=sections.filter(s=>s.branch===group.code);for(const s of districts)s.polygon=cell(s,districts,group.polygon);}
}
module.exports={clip,hull,cell,regionLayout};
