const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {LANGUAGES}=require('../languages');
const {loadCatalogs,matches,featureExcerpt,usableImage,FEATURE_WEEKS}=require('../generate-weekly-features');
const {publish,selectFeature}=require('../publish-weekly-features');
const {sendFeatures,featureWindow}=require('../send-feature-notifications');
const {TIMEZONES}=require('../send-scheduled-notifications');
const root=path.resolve(__dirname,'..');

test('the reviewed humanoid prototype contains six illustrated articles and keeps notification state unchanged',()=>{
 const editorial=JSON.parse(fs.readFileSync(path.join(root,'features/editorial/jp/weekly-001.json')));
 const feed=JSON.parse(fs.readFileSync(path.join(root,'features/jp/index.json')));
 const planned=JSON.parse(fs.readFileSync(path.join(root,'features/planned/jp.json')));
 assert.equal(editorial.articles.length,6);
 assert(editorial.articles.every(a=>a.imageUrl&&a.blurb.length>=25&&!a.blurb.startsWith('人間型 —')));
 assert.equal(editorial.coverImage,'features/images/humanoid-v1.png');
 assert.deepEqual(feed.features.find(f=>f.id===editorial.id),editorial);
 assert.deepEqual(planned.features.find(f=>f.id===editorial.id),editorial);
 const png=fs.readFileSync(path.join(root,editorial.coverImage));
 assert.equal(png.readUInt32BE(16)/png.readUInt32BE(20),2);
 assert(editorial.articles.find(a=>a.itemId==='scp-series-jp-1374').blurb.includes('顔'));
});

test('104 common Wednesday themes have valid 5–10 article language editions with source-backed introductions',{skip:process.env.FEATURE_PUBLICATION_RUN==='1'},()=>{
 const schedule=JSON.parse(fs.readFileSync(path.join(root,'features/schedule.json')));
 const catalogs=loadCatalogs(path.join(root,'local-data'));
 assert.equal(schedule.weeks.length,FEATURE_WEEKS);
 assert.equal(FEATURE_WEEKS,104);
 assert.equal(new Set(schedule.weeks.map(w=>w.themeId)).size,FEATURE_WEEKS);
 for(let i=0;i<FEATURE_WEEKS;i++){
  const time=new Date(schedule.weeks[i].publishedAt);assert.equal(time.getUTCDay(),3);assert.equal(time.getUTCHours(),10);
  if(i)assert.equal(time-new Date(schedule.weeks[i-1].publishedAt),7*86400000);
 }
 for(const language of Object.keys(LANGUAGES)){
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'features/planned',language+'.json')));
  const source=new Map(catalogs[language].map(row=>[row.itemId,row]));
  assert.equal(catalog.language,language);assert.equal(catalog.schemaVersion,1);
  assert.equal(new Set(catalog.features.map(f=>f.id)).size,catalog.features.length);
  for(const feature of catalog.features){
   const editorialFile=path.join(root,'features/editorial',language,feature.id+'.json');
   const editorial=fs.existsSync(editorialFile)?JSON.parse(fs.readFileSync(editorialFile)):null;
   if(editorial)assert.deepEqual(feature,editorial);
   const theme=schedule.weeks.find(w=>w.id===feature.id);assert(theme);
   assert.equal(theme.publishedAt,feature.publishedAt);assert.equal(theme.themeId,feature.themeId);
   assert(feature.coverImage);
   assert(!/[0-9０-９]+つの報告書/.test(feature.introduction));
   assert(feature.articles.length>=5&&feature.articles.length<=10);
   assert.equal(new Set(feature.articles.map(a=>a.itemId)).size,feature.articles.length);
   for(const article of feature.articles){const row=source.get(article.itemId);assert(row,language+'/'+article.itemId);if(!editorial)assert(matches(row,theme));assert.equal(article.url,row.urlJP);assert.equal(article.title,row.titleJP);assert(article.blurb.length>20);}
  }
 }
});

test('two years use 104 distinct original covers and individual Japanese titles',()=>{
 const catalog=JSON.parse(fs.readFileSync(path.join(root,'features/planned/jp.json')));
 assert.equal(catalog.features.length,104);
 assert.equal(new Set(catalog.features.map(f=>f.title)).size,104);
 assert.equal(new Set(catalog.features.map(f=>f.coverImage)).size,104);
 const hashes=new Set();
 for(const feature of catalog.features){
  const image=fs.readFileSync(path.join(root,feature.coverImage));
  assert.equal(image.subarray(1,4).toString(),'PNG');
  assert(image.readUInt32BE(16)/image.readUInt32BE(20)>=2);
  hashes.add(require('crypto').createHash('sha256').update(image).digest('hex'));
 }
 assert.equal(hashes.size,104);
});

test('thematic excerpts select source evidence and retain decimal values',()=>{
 const camera={descriptionExcerpt:'SCP-978は普通のカメラのように見えます。被験者が撮影されると、写真にはその人物の欲望が写ります。'};
 assert(featureExcerpt(camera,{keys:['mind_affecting']}).includes('欲望'));
 const machine={descriptionExcerpt:'この機械の部品は直径5.5cmの円柱で構成されており、通常の構造とは異なります。'};
 assert(featureExcerpt(machine,{keys:['mechanical']}).includes('5.5cm'));
 assert(!usableImage({imageUrl:'https://example.com/scp-blank.png'}));
 assert(!usableImage({imageUrl:'https://example.com/local--files/component:header/logo.png'}));
 assert(!usableImage({imageUrl:'https://example.com/diagram.svg'}));
 assert(usableImage({imageUrl:'https://example.com/scp-978/camera.jpg'}));
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

test('release feed has no previews and retains the two-year publication plan',()=>{
 const feed=JSON.parse(fs.readFileSync(path.join(root,'features/jp/index.json')));
 const planned=JSON.parse(fs.readFileSync(path.join(root,'features/planned/jp.json')));
 assert.equal((feed.previewFeatures||[]).length,0);
 assert.equal(planned.features.length,104);
 assert.equal(selectFeature(feed,new Date('2026-11-15T10:00:00Z')).id,'weekly-001');
});

test('preview metadata cannot release an edition or enqueue a push before its Wednesday',t=>{
 const f=fixture(t),date=new Date('2026-11-15T10:00:00Z');
 publish({root:f.dir,now:date,bootstrap:true});
 const file=path.join(f.dir,'features/jp/index.json'),feed=JSON.parse(fs.readFileSync(file));
 feed.previewFeatures=[f.next];fs.writeFileSync(file,JSON.stringify(feed));
 assert.deepEqual(publish({root:f.dir,now:date}),[]);
 assert.deepEqual(f.read().pending,{});
 assert.equal(JSON.parse(fs.readFileSync(file)).features.length,1);
 publish({root:f.dir,now:new Date('2026-11-18T10:00:00Z')});
 assert.equal(f.read().pending.jp.items[0].itemId,'weekly-002');
 assert.equal(JSON.parse(fs.readFileSync(file)).features.length,2);
});

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
 assert.equal(featureWindow(before,'Asia/Tokyo'),null);assert.equal(featureWindow(after,'Asia/Tokyo'),'2026-11-18');
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

test('feature windows allow only local Wednesday 19:00-19:59, including DST and UTC Thursday',()=>{
 for(const date of ['2026-11-17T10:00:00Z','2026-11-18T09:59:59Z','2026-11-18T11:00:00Z','2026-11-19T10:00:00Z']){
  assert.equal(featureWindow(new Date(date),'Asia/Tokyo'),null,date);
 }
 assert.equal(featureWindow(new Date('2026-11-18T10:00:00Z'),'Asia/Tokyo'),'2026-11-18');
 assert.equal(featureWindow(new Date('2026-11-18T10:59:59Z'),'Asia/Tokyo'),'2026-11-18');
 assert.equal(featureWindow(new Date('2026-07-08T23:00:00Z'),'America/New_York'),'2026-07-08');
 assert.equal(featureWindow(new Date('2026-11-18T23:59:59Z'),'America/New_York'),null);
 assert.equal(featureWindow(new Date('2026-11-19T00:00:00Z'),'America/New_York'),'2026-11-18');
 assert.equal(featureWindow(new Date('2026-11-19T01:00:00Z'),'America/New_York'),null);
 assert.equal(featureWindow(new Date('2025-01-01T10:00:00Z'),'Asia/Tokyo'),'2025-01-01');
});

test('all 33 feature languages send once at their own Wednesday 19:00 and retain late arrivals',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'feature-timezones-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const queuePath=path.join(dir,'queue.json'),ledgerPath=path.join(dir,'ledger.json');
 const codes=Object.keys(LANGUAGES),staging=fs.existsSync(path.join(root,'staging-environment.js'));
 fs.writeFileSync(queuePath,JSON.stringify({version:1,pending:Object.fromEntries(codes.map(code=>[code,{
  items:[{itemId:'weekly-002',titleJP:`Feature ${code}`}],lastSentWindow:null,
 }]))}));
 let now;const sent=[];
 const options={queuePath,ledgerPath,clock:()=>now,
  secret:JSON.stringify({type:'service_account',project_id:staging?'scpjp-reader-stg':'mock-project'}),
  getAccessToken:async()=> 'mock',
  persist:async(q,l)=>{fs.writeFileSync(queuePath,JSON.stringify(q));fs.writeFileSync(ledgerPath,JSON.stringify(l));},
  sendRequest:async(host,url,method,payload)=>{
   const message=JSON.parse(payload).message,lang=message.data.language;
   assert.equal(featureWindow(now,TIMEZONES[lang]),'2026-11-18');
   assert.equal(message.topic,(staging?'stg_':'')+'weekly_feature_'+lang);
   assert.equal(message.data.feature_id,'weekly-002');
   assert.equal(message.data.delivery_id,lang+'/2026-11-18');
   assert.equal(message.notification.body,`Feature ${lang}`);
   const record=JSON.parse(fs.readFileSync(ledgerPath)).deliveries.find(r=>r.lang===lang);
   assert.equal(record.status,'sending');
   sent.push(lang);return JSON.stringify({name:`projects/mock/messages/${sent.length}`});
  }};
 // Twice per hour verifies both local scheduling and duplicate suppression within 19:00-19:59.
 for(let minute=0;minute<48*60;minute+=30){now=new Date(Date.UTC(2026,10,18,0,minute));await sendFeatures(options);}
 assert.deepEqual(sent.slice().sort(),codes.slice().sort());
 const queue=JSON.parse(fs.readFileSync(queuePath));
 assert(codes.every(code=>queue.pending[code].lastSentWindow==='2026-11-18'));
 for(const code of codes)queue.pending[code].items=[{itemId:'weekly-003',titleJP:'Later feature'}];
 fs.writeFileSync(queuePath,JSON.stringify(queue));
 now=new Date('2026-11-20T10:00:00Z');
 await sendFeatures({...options,getAccessToken:async()=>assert.fail('No late authentication'),
  sendRequest:async()=>assert.fail('No late send')});
 assert(codes.every(code=>JSON.parse(fs.readFileSync(queuePath)).pending[code].items.length===1));
});

test('feature reservation crossing 20:00 defers safely without calling FCM',async t=>{
 const f=fixture(t);publish({root:f.dir,now:new Date('2026-11-17T10:00:00Z'),bootstrap:true});
 publish({root:f.dir,now:new Date('2026-11-18T10:00:00Z')});
 const staging=fs.existsSync(path.join(root,'staging-environment.js'));
 let now=new Date('2026-11-18T10:59:59Z');
 await sendFeatures({queuePath:f.queuePath,ledgerPath:f.ledgerPath,clock:()=>now,
  secret:JSON.stringify({type:'service_account',project_id:staging?'scpjp-reader-stg':'mock-project'}),
  getAccessToken:async()=> 'mock',sendRequest:async()=>assert.fail('No send at 20:00'),
  persist:async(q,l)=>{fs.writeFileSync(f.queuePath,JSON.stringify(q));fs.writeFileSync(f.ledgerPath,JSON.stringify(l));now=new Date('2026-11-18T11:00:00Z');},
 });
 assert.equal(JSON.parse(fs.readFileSync(f.ledgerPath)).deliveries[0].status,'retry');
 assert.equal(f.read().pending.jp.items[0].itemId,'weekly-002');
});

test('feature workflow polls across local Wednesdays and isolates staging credentials',()=>{
 const workflow=fs.readFileSync(path.join(root,'.github/workflows/weekly-features.yml'),'utf8');
 assert.match(workflow,/cron: '2-57\/5 \* \* \* 3,4'/);
 if(fs.existsSync(path.join(root,'staging-environment.js'))){
  assert.match(workflow,/environment: stg/);
  assert.match(workflow,/github.repository == 'hirotakaakita\/scpjpReaderActions-stg'/);
  assert.match(workflow,/secrets.STG_FIREBASE_SERVICE_ACCOUNT_JSON/);
  assert.doesNotMatch(workflow,/secrets.FIREBASE_SERVICE_ACCOUNT_JSON/);
 }
});
