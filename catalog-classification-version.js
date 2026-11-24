'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
// Clients compare timestamps before importing; a metadata-only rebuild must
// advance the version even if no source article was refetched.
function advanceClassificationTimestamp(delivery,directory){
 const pointer=path.join(directory,'manifest.json');if(!fs.existsSync(pointer))return;
 const manifest=JSON.parse(fs.readFileSync(pointer));
 if(!/^catalog-[a-f0-9]{64}\.json\.gz$/.test(manifest.fileName))throw Error('Invalid previous delivery pointer');
 const bytes=fs.readFileSync(path.join(directory,manifest.fileName));
 if(crypto.createHash('sha256').update(bytes).digest('hex')!==manifest.sha256)throw Error('Previous delivery checksum mismatch');
 const prior=JSON.parse(zlib.gunzipSync(bytes)),{normalize}=require('./related-documents');
 const key=row=>JSON.stringify([row.itemId,row.pageType,row.contentType,row.extractedFrom,row.numericItemId]);
 const page=row=>normalize(row.urlJP||row.urlEN)?.url;
 const identity=row=>JSON.stringify([page(row),row.itemId]);
 const sources=new Map(prior.data.map(row=>[identity(row),key(row)]));
 const oldPages=new Set(prior.data.map(page));
 const changed=delivery.data.some(row=>{
  const old=sources.get(identity(row));
  return old===undefined?oldPages.has(page(row)):old!==key(row);
 });
 const previous=Date.parse(manifest.timestamp),current=Date.parse(delivery.timestamp);
 if(!Number.isFinite(previous)||!Number.isFinite(current))throw Error('Invalid delivery timestamp');
 if(changed&&current<=previous)delivery.timestamp=new Date(Math.max(Date.now(),previous+1)).toISOString();
 else if(current<previous)delivery.timestamp=manifest.timestamp;
}
module.exports={advanceClassificationTimestamp};
