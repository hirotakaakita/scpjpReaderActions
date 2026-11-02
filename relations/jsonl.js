"use strict";
const fs=require('node:fs'),crypto=require('node:crypto');
const {StringDecoder}=require('node:string_decoder');
function fileHash(file){const h=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),buf=Buffer.alloc(1048576);try{let n;while((n=fs.readSync(fd,buf,0,buf.length,null)))h.update(buf.subarray(0,n));return h.digest('hex');}finally{fs.closeSync(fd);}}
function* lines(file){const fd=fs.openSync(file,'r'),buf=Buffer.alloc(65536),decoder=new StringDecoder('utf8');let pending='';try{let n;while((n=fs.readSync(fd,buf,0,buf.length,null))){pending+=decoder.write(buf.subarray(0,n));let i;while((i=pending.indexOf('\n'))>=0){const line=pending.slice(0,i);pending=pending.slice(i+1);if(line.trim())yield line;}}pending+=decoder.end();if(pending.trim())yield pending;}finally{fs.closeSync(fd);}}
function rowsHash(rows,combined){const h=crypto.createHash('sha256');for(const row of rows){const line=JSON.stringify(row)+'\n';h.update(line);combined?.update(line);}if(!rows.length){h.update('\n');combined?.update('\n');}return h.digest('hex');}
function writeRows(file,rows,expected){if(fs.existsSync(file)){if(fileHash(file)!==expected)throw Error('Immutable graph content changed');return;}
 const tmp=file+'.'+process.pid+'.tmp',fd=fs.openSync(tmp,'w');let text='';try{for(const row of rows){text+=JSON.stringify(row)+'\n';if(text.length>=1048576){fs.writeFileSync(fd,text);text='';}}if(text)fs.writeFileSync(fd,text);if(!rows.length)fs.writeFileSync(fd,'\n');}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);
}
module.exports={fileHash,lines,rowsHash,writeRows};
