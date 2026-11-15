'use strict';
const fs=require('node:fs'),path=require('node:path');
function apply({root=__dirname,language='jp',id='weekly-001'}={}){
 if(!/^[a-z-]+$/.test(language)||!/^weekly-\d{3}$/.test(id))throw Error('Invalid editorial path');
 const feature=JSON.parse(fs.readFileSync(path.join(root,'features/editorial',language,id+'.json')));
 const source=new Map(JSON.parse(fs.readFileSync(path.join(root,'local-data',language,'scp-data.json'))).data.map(r=>[r.itemId,r]));
 if(feature.id!==id||feature.articles.length<5||feature.articles.length>10||new Set(feature.articles.map(a=>a.itemId)).size!==feature.articles.length)throw Error('Invalid editorial feature');
 for(const article of feature.articles){const row=source.get(article.itemId);if(!row||row.isTranslatedJP===false||row.titleJP!==article.title||row.urlJP!==article.url||!article.blurb||!article.imageUrl)throw Error('Editorial source mismatch: '+article.itemId);}
 for(const file of [path.join(root,'features/planned',language+'.json'),path.join(root,'features',language,'index.json')]){
  const catalog=JSON.parse(fs.readFileSync(file));const index=catalog.features.findIndex(f=>f.id===id);
  // An unpublished edition must not be added to the public feed by an editor.
  if(index<0)continue;
  catalog.features[index]=feature;fs.writeFileSync(file,JSON.stringify(catalog,null,2)+'\n');
 }
 return feature;
}
if(require.main===module)console.log('Updated '+apply().id+' without changing the release ID or notification queue');
module.exports={apply};
