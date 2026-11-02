'use strict';
// Compose two smooth shears: invertible everywhere, preserving shared borders
// and all article memberships while making straight cell edges flow organically.
const parameters=[1200,2200,120,480,1000,2600,120,560];
function map(p,w){const x=p[0]+w[0]*Math.sin(p[1]/w[1])+w[2]*Math.sin(p[1]/w[3])+(w.length>10?w[10]*Math.sin(p[1]/w[11]):0);return[x+(w[8]||0),p[1]+w[4]*Math.sin(x/w[5])+w[6]*Math.sin(x/w[7])+(w[9]||0)+(w.length>12?w[12]*Math.sin(x/w[13]):0)];}
function inverse(p,w){const x=p[0]-(w[8]||0),y=p[1]-(w[9]||0)-w[4]*Math.sin(x/w[5])-w[6]*Math.sin(x/w[7])-(w.length>12?w[12]*Math.sin(x/w[13]):0);return[x-w[0]*Math.sin(y/w[1])-w[2]*Math.sin(y/w[3])-(w.length>10?w[10]*Math.sin(y/w[11]):0),y];}
function warpLayout(nodes,groups,sections){
 const border=[];for(const g of groups){const p=g.polygon;for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length],steps=Math.ceil(Math.hypot(a[0]-b[0],a[1]-b[1])/100);for(let j=0;j<=steps;j++)border.push(map([a[0]+(b[0]-a[0])*j/steps,a[1]+(b[1]-a[1])*j/steps],[...parameters,0,0,34,120,30,135]));}}
 const minX=Math.min(...border.map(p=>p[0])),minY=Math.min(...border.map(p=>p[1])),maxX=Math.max(...border.map(p=>p[0])),maxY=Math.max(...border.map(p=>p[1]));
 const warp=[...parameters,100-minX,100-minY,34,120,30,135];
 const byBranch=new Map(),bySection=new Map();
 for(const node of nodes){const p=map([node.x,node.y],warp);node.x=Math.round(p[0]*100)/100;node.y=Math.round(p[1]*100)/100;(byBranch.get(node.branch)||byBranch.set(node.branch,[]).get(node.branch)).push(node);(bySection.get(node.section)||bySection.set(node.section,[]).get(node.section)).push(node);}
 for(const g of groups){const list=byBranch.get(g.code),xs=list.map(n=>n.x),ys=list.map(n=>n.y);g.left=Math.min(...xs)-100;g.top=Math.min(...ys)-100;g.width=Math.max(...xs)-g.left+100;g.height=Math.max(...ys)-g.top+100;}
 for(const s of sections){const p=map([s.x,s.y],warp);s.x=p[0];s.y=p[1];s.radius=Math.max(...bySection.get(s.id).map(n=>Math.hypot(n.x-s.x,n.y-s.y)))+34;}
 return{warp,width:maxX-minX+200,height:maxY-minY+200};
}
module.exports={map,inverse,warpLayout};
