'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),zlib=require('node:zlib');
const {decorativeImageReason}=require('../image-policy'),{extractImageUrlFromDocument}=require('../local-crawler');
const {extractImageUrl}=require('../rufoundation-crawler'),{audit,apply}=require('../tool/audit-image-metadata');
test('case-insensitive article images outrank excluded credits, warning templates and interface assets',()=>{
 const dom=new JSDOM('<div id="page-content"><img src="https://raw.githubusercontent.com/FondationSCP/module-de-credit/main/img/blank.png"><img src="/local--files/_template/Aviso%202.png"><img src="/local--files/nav%3Aside/blank.png"><div class="credit"><img src="/local--files/other/credit.jpg"></div><img src="/local--files/scp-001-j/red-button.PNG"></div>');
 try{assert.equal(extractImageUrlFromDocument(dom.window.document,'https://fondationscp.wikidot.com/scp-001-j'),'https://fondationscp.wikidot.com/local--files/scp-001-j/red-button.PNG');}finally{dom.window.close();}
 assert.equal(decorativeImageReason('https://example.com/real/red-button.PNG'),null);
 assert.equal(decorativeImageReason('https://example.com/real/iconography.jpg'),null);
 assert.equal(extractImageUrl('[[image https://example.com/blank.png]] [[image own.PNG]]','scp-001'),'https://scpfoundation.net/local--files/scp-001/own.PNG');
});
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'scp-global-images-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const stamp='2026-11-01T00:00:00Z',checked='2026-11-08T00:00:00Z';
 const row=(id,slug,img)=>({itemId:id,urlJP:'https://lafundacionscp.wikidot.com/'+slug,imageUrl:img,pageType:'joke-scps',numericItemId:1,titleJP:id,createdAt:stamp,lastUpdated:stamp,isTranslatedJP:true});
 const data=[
  row('one','scp-001-j','https://lafundacionscp.wdfiles.com/local--files/scp-001-ex-j/rock.jpg'),
  row('six','scp-006-j','https://lafundacionscp.wdfiles.com/local--files/scp-006-cu-ex/cute.jpg'),
  row('blank','scp-010-j','https://raw.githubusercontent.com/FondationSCP/module-de-credit/main/img/blank.png'),
  row('shared','scp-020-j','https://lafundacionscp.wdfiles.com/local--files/scp-021/illustration.png')
 ];
 const dir=path.join(root,'local-data/es');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'scp-data.json');
 fs.writeFileSync(file,JSON.stringify({language:'es',timestamp:stamp,totalCount:data.length,data}));fs.writeFileSync(path.join(dir,'meta.json'),JSON.stringify({totalCount:data.length,lastUpdated:stamp}));
 const record=(imageUrl)=>({imageUrl,checkedAt:checked,contentSha256:'a'.repeat(64),availabilityVersion:1});
 const records=Object.fromEntries(data.map(r=>[r.urlJP,record(r.imageUrl)]));
 records[data[0].urlJP].imageUrl=null;
 records[data[1].urlJP].imageUrl='https://lafundacionscp.wdfiles.com/local--files/scp-006-j/own.PNG';
 const indexDir=path.join(root,'local-data/catalog-indexes');fs.mkdirSync(indexDir,{recursive:true});fs.writeFileSync(path.join(indexDir,'es.json.gz'),zlib.gzipSync(JSON.stringify({schemaVersion:1,language:'es',records,indexes:{},attempts:{}})));
 return {root,file,data};
}
test('global audit uses same-URL positive evidence, rechecks negative cache, and leaves legitimate shared assets intact',async t=>{
 const f=fixture(t),requests=[];
 const report=await audit({root:f.root,languages:['es'],intervalMs:0,request:async url=>{requests.push(url);return {imageUrl:'https://lafundacionscp.wdfiles.com/local--files/scp-001-j/own.PNG',sha256:'b'.repeat(64)};}});
 assert.deepEqual(requests,[f.data[0].urlJP]);assert.equal(report.patches.length,3);
 assert(!report.patches.some(p=>p.itemId==='shared'));assert.equal(report.failures.length,0);
 const result=apply(f.root,report);assert.equal(result.counts.primary,3);assert.deepEqual(result.conflicts,[]);
 const after=JSON.parse(fs.readFileSync(f.file));assert.equal(after.totalCount,4);
 for(let i=0;i<4;i++){assert.equal(after.data[i].itemId,f.data[i].itemId);assert.equal(after.data[i].urlJP,f.data[i].urlJP);assert.equal(after.data[i].createdAt,f.data[i].createdAt);}
 assert.equal(after.data[2].imageUrl,null);assert(after.data[0].imageUrl.includes('/scp-001-j/'));
});
test('network failures retain the old image; concurrent newer images are not overwritten',async t=>{
 const f=fixture(t);
 const report=await audit({root:f.root,languages:['es'],intervalMs:0,request:async()=>{throw Error('Timeout');}});
 assert.equal(report.failures.length,1);assert(!report.patches.some(p=>p.itemId==='one'));
 const source=JSON.parse(fs.readFileSync(f.file));source.data[1].imageUrl='https://example.com/newer.png';fs.writeFileSync(f.file,JSON.stringify(source));
 const result=apply(f.root,report);assert(result.conflicts.some(c=>c.itemId==='six'));
 assert.equal(JSON.parse(fs.readFileSync(f.file)).data[1].imageUrl,'https://example.com/newer.png');
});
