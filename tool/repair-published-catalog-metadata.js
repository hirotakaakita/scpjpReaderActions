'use strict';
// Repair the current publication, preserving IDs, membership, images and dates.
const fs=require('node:fs'),path=require('node:path'),z=require('node:zlib'),crypto=require('node:crypto');
const {LANGUAGES}=require('../languages'),{reclassifyScpArticle}=require('../article-category');
const {normalizedSourceListing}=require('../series-listing');
const tags=require('../tag-dictionary');
function repair(root,{write=false}={}){
 const dictionary=tags.readDictionary(path.join(root,'tag-dictionary.json')),index=tags.indexDictionary(dictionary),report=[];
 for(const language of Object.keys(LANGUAGES)){
  const directory=path.join(root,'local-data/mobile-v3',language),pointer=path.join(directory,'manifest.json');
  if(!fs.existsSync(pointer))continue;
  const manifest=JSON.parse(fs.readFileSync(pointer)),bytes=fs.readFileSync(path.join(directory,manifest.fileName));
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==manifest.sha256)throw Error('Invalid catalog checksum');
  const catalog=JSON.parse(z.gunzipSync(bytes)),reserved=new Set(catalog.data.map(r=>r.itemId)),changed=[];
  catalog.data=catalog.data.map(row=>{
   const classified=reclassifyScpArticle(row,reserved);
   const next={...row,pageType:classified.pageType,contentType:classified.contentType,
     extractedFrom:normalizedSourceListing(classified),tags:tags.restoreTagLabels(row.tags||[],language,dictionary,index,row.tagLabels)};
   if(JSON.stringify(next)!==JSON.stringify(row))changed.push({itemId:row.itemId,url:row.urlJP||row.urlEN,from:row.pageType,to:next.pageType});
   return next;
  });
  if(changed.length&&write){
   catalog.timestamp=new Date(Math.max(Date.now(),Date.parse(manifest.timestamp)+1)).toISOString();
   const json=Buffer.from(JSON.stringify(catalog)),compressed=z.gzipSync(json,{level:9}),sha256=crypto.createHash('sha256').update(compressed).digest('hex'),fileName='catalog-'+sha256+'.json.gz';
   fs.writeFileSync(path.join(directory,fileName),compressed);
   fs.writeFileSync(pointer+'.tmp',JSON.stringify({...manifest,timestamp:catalog.timestamp,fileName,sha256,bytes:compressed.length,decodedBytes:json.length})+'\n');
   fs.renameSync(pointer+'.tmp',pointer);
  }
  report.push({language,count:catalog.data.length,changed:changed.length,changes:changed});
 }
 return report;
}
if(require.main===module)console.log(JSON.stringify(repair(path.resolve(__dirname,'..'),{write:process.argv.includes('--write')}),null,2));
module.exports={repair};
