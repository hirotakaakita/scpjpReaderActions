'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),zlib=require('node:zlib');
const {generateResearchBoard}=require('../research-board/catalog');
const {digest}=require('../research-board/extract');
test('publication retains the actual prior manifest target regardless of unrelated payload modification times',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'board-backfill-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const input=path.join(root,'local-data'),output=path.join(input,'mobile-v3'),lang=path.join(output,'en');fs.mkdirSync(lang,{recursive:true});
 function writeCatalog(title){const c={language:'en',timestamp:'2026-11-08T00:00:00Z',totalCount:1,data:[{itemId:'scp-series-001',pageType:'scp-series',contentType:'scp',urlJP:'https://scp-wiki.wikidot.com/scp-001',isTranslatedJP:true,titleJP:title}]},bytes=zlib.gzipSync(JSON.stringify(c)),name='catalog-'+digest(bytes)+'.json.gz';fs.writeFileSync(path.join(lang,name),bytes);fs.writeFileSync(path.join(lang,'manifest.json'),JSON.stringify({fileName:name,sha256:digest(bytes),bytes:bytes.length}));}
 writeCatalog('First');const first=generateResearchBoard(input,output),dir=path.join(output,'research-board');
 const unrelated='board-'+('0'.repeat(64))+'.json.gz';fs.writeFileSync(path.join(dir,unrelated),'unpublished');fs.utimesSync(path.join(dir,unrelated),new Date('2099-01-01'),new Date('2099-01-01'));
 writeCatalog('Second');const second=generateResearchBoard(input,output);assert.notEqual(first.fileName,second.fileName);
 assert(fs.existsSync(path.join(dir,first.fileName)));assert(!fs.existsSync(path.join(dir,unrelated)));
 assert.equal(generateResearchBoard(input,output).fileName,second.fileName);assert(fs.existsSync(path.join(dir,first.fileName)));
});
test('manual backfill shares crawl and short publication locks without catalog or notification writes',()=>{
 const w=fs.readFileSync(path.join(__dirname,'../.github/workflows/research-board-backfill.yml'),'utf8');
 assert.match(w,/workflow_dispatch:/);assert.doesNotMatch(w,/schedule:|prepare-notification|send-notification|node mobile-catalog/);
 assert.match(w,/group: scp-crawl/);assert.match(w,/group: scp-data-update/);assert.match(w,/max-parallel: 4/);
 const publish=w.slice(w.indexOf('\n  publish:'));
 assert.match(publish,/ref: master/);assert.match(publish,/git add local-data\/research-board-sources\/ local-data\/mobile-v3\/research-board\//);
 assert.doesNotMatch(publish,/git pull|--force|--rebase/);
});
