'use strict';
// After repeated local generations, retain the payload still referenced by the
// published HEAD manifest, rather than an unpublished intermediate generation.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {LANGUAGES}=require('../languages');
const root=path.resolve(__dirname,'..');
const dirs=[];for(const channel of ['mobile-v1','mobile-v2'])for(const language of Object.keys(LANGUAGES))dirs.push(`local-data/${channel}/${language}`);
let recovered=0,removed=0;
for(const dir of dirs){
  const absolute=path.join(root,dir),pointer=dir+'/manifest.json';if(!fs.existsSync(path.join(root,pointer)))continue;
  const current=JSON.parse(fs.readFileSync(path.join(root,pointer)));let previous;
  try{previous=JSON.parse(cp.execFileSync('git',['show','HEAD:'+pointer],{cwd:root,stdio:['ignore','pipe','ignore']}));}catch{}
  const pattern=/^(catalog|board)-[a-f0-9]{64}\.json\.gz$/;
  for(const m of [current,previous].filter(Boolean))if(!pattern.test(m.fileName))throw Error('Unsafe payload name');
  const keep=new Set([current.fileName,previous?.fileName].filter(Boolean));
  if(previous&&!fs.existsSync(path.join(absolute,previous.fileName))){
    const b=cp.execFileSync('git',['show',`HEAD:${dir}/${previous.fileName}`],{cwd:root,maxBuffer:40*1024*1024});
    if(crypto.createHash('sha256').update(b).digest('hex')!==previous.sha256)throw Error('Old payload checksum mismatch');
    fs.writeFileSync(path.join(absolute,previous.fileName),b,{flush:true});recovered++;
  }
  for(const name of fs.readdirSync(absolute)){
    if(!pattern.test(name)||keep.has(name))continue;
    const target=path.resolve(absolute,name);if(!target.startsWith(absolute+path.sep))throw Error('Invalid cleanup path');
    fs.unlinkSync(target);removed++;
  }
}
console.log(JSON.stringify({recoveredPublishedPayloads:recovered,removedUnpublishedIntermediatePayloads:removed}));
