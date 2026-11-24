'use strict';
function preservePublishedIds(rows,previous=[]){
 const {normalize}=require('./related-documents');
 const url=r=>normalize(r.isTranslatedJP!==false&&r.urlJP?r.urlJP:r.urlEN)?.url;
 const prior=new Map(),byId=new Map(previous.map(r=>[r.itemId,r]));
 for(const row of previous){const page=url(row);if(!page)continue;
  if(!prior.has(page))prior.set(page,[]);prior.get(page).push(row.itemId);
 }
 const owners=new Map();
 for(const row of rows){
  const page=url(row),ids=prior.get(page);
  const exact=byId.get(row.itemId);
  if(exact&&url(exact)!==page&&!ids)throw Error('Published article ID collision: '+row.itemId);
  if(ids&&(!exact||url(exact)!==page||owners.has(row.itemId)))row.itemId=ids.find(id=>!owners.has(id))||ids[0];
  if(owners.has(row.itemId)&&owners.get(row.itemId)!==page)throw Error('Published article ID collision: '+row.itemId);
  owners.set(row.itemId,page);
 }
 // Some published URLs have multiple reader keys. Retain each existing alias
 // while that page is still present, using the freshly classified metadata.
 const currentByUrl=new Map(rows.map(row=>[url(row),row]));
 for(const row of previous){const page=url(row),current=currentByUrl.get(page);
  if(!current||owners.has(row.itemId))continue;
  rows.push({...current,itemId:row.itemId});owners.set(row.itemId,page);
 }
 return rows;
}
module.exports={preservePublishedIds};
