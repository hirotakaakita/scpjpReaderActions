const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {LANGUAGES}=require('../languages');
const {loadCatalogs,matches}=require('../generate-weekly-features');
const {publish,selectFeature}=require('../publish-weekly-features');
const {sendFeatures,featureWindow}=require('../send-feature-notifications');
const root=path.resolve(__dirname,'..');

test('156 common Wednesday themes have valid 5–10 article language editions with source-backed introductions',{skip:process.env.FEATURE_PUBLICATION_RUN==='1'},()=>{
 const schedule=JSON.parse(fs.readFileSync(path.join(root,'features/schedule.json')));
 const catalogs=loadCatalogs(path.join(root,'local-data'));
 assert.equal(schedule.weeks.length,156);
 assert.equal(new Set(schedule.weeks.map(w=>w.themeId)).size,156);
 for(let i=0;i<156;i++){
  const time=new Date(schedule.weeks[i].publishedAt);assert.equal(time.getUTCDay(),3);assert.equal(time.getUTCHours(),10);
  if(i)assert.equal(time-new Date(schedule.weeks[i-1].publishedAt),7*86400000);
 }
 for(const language of Object.keys(LANGUAGES)){
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'features/planned',language+'.json')));
  const source=new Map(catalogs[language].map(row=>[row.itemId,row]));
  assert.equal(catalog.language,language);assert.equal(catalog.schemaVersion,1);
  assert.equal(new Set(catalog.features.map(f=>f.id)).size,catalog.features.length);
  for(const feature of catalog.features){
   const theme=schedule.weeks.find(w=>w.id===feature.id);assert(theme);
   assert.equal(theme.publishedAt,feature.publishedAt);assert.equal(theme.themeId,feature.themeId);
   assert(feature.articles.length>=5&&feature.articles.length<=10);
   assert.equal(new Set(feature.articles.map(a=>a.itemId)).size,feature.articles.length);
   for(const article of feature.articles){const row=source.get(article.itemId);assert(row,language+'/'+article.itemId);assert(matches(row,theme));assert.equal(article.url,row.urlJP);assert.equal(article.title,row.titleJP);assert(article.blurb.length>20);}
  }
 }
});

function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'scp-features-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.mkdirSync(path.join(dir,'local-data'));
 fs.mkdirSync(path.join(dir,'features/planned'),{recursive:true});
 const first={id:'weekly-001',themeId:'humanoid',title:'People',publishedAt:'2026-11-11T10:00:00.000Z',articles:Array.from({length:5},(_,i)=>({itemId:'scp-series-'+i}))};
 const next={...first,id:'weekly-002',title:'Spaces',publishedAt:'2026-11-18T10:00:00.000Z'};
 for(const code of Object.keys(LANGUAGES)){
  fs.mkdirSync(path.join(dir,'features',code),{recursive:true});
  fs.writeFileSync(path.join(dir,'features/planned',code+'.json'),JSON.stringify({schemaVersion:1,language:code,features:code==='jp'?[first,next]:code==='en'?[first]:[]}));
  fs.writeFileSync(path.join(dir,'features',code,'index.json'),JSON.stringify({schemaVersion:1,language:code,features:[]}));
  fs.mkdirSync(path.join(dir,'local-data',code));fs.writeFileSync(path.join(dir,'local-data',code,'scp-data.json'),JSON.stringify({data:first.articles.map(a=>({...a,isTranslatedJP:true}))}));
 }
 const queuePath=path.join(dir,'local-data/feature-notification-queue.json'),ledgerPath=path.join(dir,'local-data/feature-notification-deliveries.json');
 const read=()=>JSON.parse(fs.readFileSync(queuePath));return {dir,first,next,queuePath,ledgerPath,read};
}

test('bootstrap never backfills pushes; publication changes only eligible languages at Wednesday 19:00 JST',t=>{
 const f=fixture(t),before=new Date('2026-11-18T09:59:59Z'),after=new Date('2026-11-18T10:00:00Z');
 assert.throws(()=>publish({root:f.dir,now:before}),/Bootstrap/);
 publish({root:f.dir,now:before,bootstrap:true});assert.deepEqual(f.read().pending,{});
 assert.deepEqual(publish({root:f.dir,now:before}),[]);
 assert.deepEqual(publish({root:f.dir,now:after}),['jp']);
 assert.deepEqual(f.read().pending.jp.items,[{itemId:'weekly-002',titleJP:'Spaces'}]);
 assert.equal(f.read().pending.en,undefined);
 const bytes=fs.readFileSync(f.queuePath,'utf8');publish({root:f.dir,now:after});assert.equal(fs.readFileSync(f.queuePath,'utf8'),bytes);
 assert.equal(selectFeature({features:[f.first]},after).id,'weekly-001');
 assert.equal(featureWindow(before),'2026-11-11');assert.equal(featureWindow(after),'2026-11-18');
});

test('a feature push carries its exact language and feature ID, and retries never duplicate a sent notification',async t=>{
 const f=fixture(t);publish({root:f.dir,now:new Date('2026-11-17T10:00:00Z'),bootstrap:true});publish({root:f.dir,now:new Date('2026-11-18T10:00:00Z')});
 const staging=fs.existsSync(path.join(root,'staging-environment.js'));
 let sends=0;const options={queuePath:f.queuePath,ledgerPath:f.ledgerPath,now:new Date('2026-11-18T10:00:00Z'),
  secret:JSON.stringify({type:'service_account',project_id:staging?'scpjp-reader-stg':'mock-project'}),getAccessToken:async()=> 'mock',
  persist:async(q,l)=>{fs.writeFileSync(f.queuePath,JSON.stringify(q));fs.writeFileSync(f.ledgerPath,JSON.stringify(l));},
  sendRequest:async(host,url,method,payload)=>{sends++;const message=JSON.parse(payload).message;
   assert.equal(JSON.parse(fs.readFileSync(f.ledgerPath)).deliveries[0].status,'sending');
   assert.equal(message.topic,(staging?'stg_':'')+'weekly_feature_jp');
   assert.deepEqual(message.data,{type:'weekly_feature',feature_id:'weekly-002',language:'jp',delivery_id:'jp/2026-11-18'});
   assert.equal(message.notification.body,'Spaces');return JSON.stringify({name:'projects/mock/messages/1'});
  }};
 await sendFeatures(options);await sendFeatures(options);assert.equal(sends,1);
 assert.equal(f.read().pending.jp.items.length,0);
 assert.equal(JSON.parse(fs.readFileSync(f.ledgerPath)).deliveries[0].status,'sent');
});

test('if articles disappear after generation, publication keeps the previous edition and does not notify',t=>{
 const f=fixture(t);publish({root:f.dir,now:new Date('2026-11-17T10:00:00Z'),bootstrap:true});
 const file=path.join(f.dir,'local-data/jp/scp-data.json');const source=JSON.parse(fs.readFileSync(file));source.data.pop();fs.writeFileSync(file,JSON.stringify(source));
 assert.deepEqual(publish({root:f.dir,now:new Date('2026-11-18T10:00:00Z')}),[]);
 assert.deepEqual(f.read().pending,{});
 const feed=JSON.parse(fs.readFileSync(path.join(f.dir,'features/jp/index.json')));
 assert.deepEqual(feed.features.map(f=>f.id),['weekly-001']);
});
