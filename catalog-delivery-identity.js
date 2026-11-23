'use strict';
function preservePublishedIds(rows,previous=[]){
 const {normalize}=require('./related-documents');
 const url=r=>normalize(r.isTranslatedJP!==false&&r.urlJP?r.urlJP:r.urlEN)?.url;
 const prior=new Map(previous.map(r=>[url(r),r.itemId]).filter(([u])=>u));
 const owners=new Map();
 for(const row of rows){
  const page=url(row),id=prior.get(page);if(id)row.itemId=id;
  if(owners.has(row.itemId)&&owners.get(row.itemId)!==page)throw Error('Published article ID collision: '+row.itemId);
  owners.set(row.itemId,page);
 }
 return rows;
}
module.exports={preservePublishedIds};
