'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {reconcile,refresh}=require('../refresh-weekly-features');
const {featureArticle}=require('../generate-weekly-features');
const theme={id:'weekly-001',themeId:'mechanical',keys:['mechanical'],publishedAt:'2026-11-11T10:00:00.000Z'};
function row(id,extra={}){
 return {itemId:id,titleJP:id,urlJP:'https://scp-wiki.wikidot.com/'+id,
  descriptionExcerpt:'This machine has anomalous moving parts that change shape whenever it is activated.',
  groups:new Set(['mechanical']),...extra};
}
const rows=()=>Array.from({length:8},(_,i)=>row('scp-'+(i+1)));
function plan(language='en'){
 return {schemaVersion:1,language,features:[{...theme,title:'Machines',introduction:'Original introduction',
  coverImage:'features/images/original.png',articles:rows().slice(0,6).map(r=>featureArticle(r,theme))}]};
}

test('refresh replaces disappeared or no-longer-thematic articles while retaining the edition and valid selections',()=>{
 const catalog=plan(),source=rows().filter(r=>r.itemId!=='scp-2');
 source.find(r=>r.itemId==='scp-3').groups=new Set(['plant']);
 const result=reconcile(catalog,source,[theme]),next=result.catalog.features[0];
 assert.equal(next.articles.length,6);
 assert(!next.articles.some(a=>['scp-2','scp-3'].includes(a.itemId)));
 assert.deepEqual(next.articles.filter(a=>['scp-1','scp-4','scp-5','scp-6'].includes(a.itemId)),
  catalog.features[0].articles.filter(a=>['scp-1','scp-4','scp-5','scp-6'].includes(a.itemId)));
 assert.deepEqual({...next,articles:[]},{...catalog.features[0],articles:[]});
 assert.equal(result.changes[0].replacements.length,2);
 assert.deepEqual(reconcile(result.catalog,source,[theme]).changes,[],'second run is idempotent');
});

test('refresh updates changed article URLs and titles without selecting another article',()=>{
 const source=rows();source[0]={...source[0],titleJP:'New title',urlJP:'https://scp-wiki.wikidot.com/moved-page'};
 const result=reconcile(plan(),source,[theme]);
 assert.equal(result.catalog.features[0].articles[0].itemId,'scp-1');
 assert.equal(result.catalog.features[0].articles[0].title,'New title');
 assert.equal(result.catalog.features[0].articles[0].url,source[0].urlJP);
});

test('a theme with fewer than five eligible articles is removed from the plan',()=>{
 const result=reconcile(plan(),rows().slice(0,4),[theme]);
 assert.deepEqual(result.catalog.features,[]);
 assert.equal(result.changes[0].removed,true);
 assert.deepEqual(result.catalog.deferredFeatures,plan().features);
 assert.deepEqual(reconcile(result.catalog,rows().slice(0,4),[theme]).changes,[]);
 const recovered=reconcile(result.catalog,rows(),[theme]);
 assert.deepEqual(recovered.catalog.features,plan().features);
 assert.equal(recovered.changes[0].restored,true);
 assert.equal(recovered.catalog.deferredFeatures,undefined);
 assert.deepEqual(reconcile(recovered.catalog,rows(),[theme]).changes,[]);
});

test('reviewed editorial selections fail closed and all languages are checked before any writes',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'weekly-refresh-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'features/planned'),{recursive:true});
 fs.mkdirSync(path.join(root,'features/editorial/jp'),{recursive:true});
 fs.writeFileSync(path.join(root,'features/schedule.json'),JSON.stringify({weeks:[theme]}));
 for(const lang of ['en','jp'])fs.writeFileSync(path.join(root,'features/planned',lang+'.json'),JSON.stringify(plan(lang)));
 fs.writeFileSync(path.join(root,'features/editorial/jp/weekly-001.json'),JSON.stringify(plan('jp').features[0]));
 const planned=path.join(root,'features/planned/en.json'),before=fs.readFileSync(planned);
 assert.throws(()=>refresh({root,catalogs:{en:rows().slice(1),jp:rows().slice(1)}}),/Editorial feature requires review/);
 assert(fs.readFileSync(planned).equals(before),'earlier language was not partially written');
});

test('refresh only changes planned editions and never publishes or changes notification state',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'weekly-refresh-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'features/planned'),{recursive:true});
 fs.mkdirSync(path.join(root,'features/en'),{recursive:true});
 fs.mkdirSync(path.join(root,'local-data'),{recursive:true});
 fs.writeFileSync(path.join(root,'features/schedule.json'),JSON.stringify({weeks:[theme]}));
 fs.writeFileSync(path.join(root,'features/planned/en.json'),JSON.stringify(plan()));
 const preserved=['features/en/index.json','features/published.json','local-data/feature-notification-queue.json','local-data/feature-notification-deliveries.json'];
 for(const name of preserved)fs.writeFileSync(path.join(root,name),'original '+name);
 const report=refresh({root,catalogs:{en:rows().slice(1)}});
 assert.equal(report.en.length,1);
 for(const name of preserved)assert.equal(fs.readFileSync(path.join(root,name),'utf8'),'original '+name);
 assert.deepEqual(refresh({root,catalogs:{en:rows().slice(1)}}),{});
});
