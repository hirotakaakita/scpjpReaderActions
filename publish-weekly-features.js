'use strict';
const fs=require('node:fs'),path=require('node:path');
const {LANGUAGES}=require('./languages');
function selectFeature(catalog,now){return catalog.features.filter(f=>Date.parse(f.publishedAt)<=now.getTime()).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt))[0]||null;}
function publish({root=__dirname,now=new Date(),bootstrap=false}={}){
 const stateFile=path.join(root,'features/published.json'),queueFile=path.join(root,'local-data/feature-notification-queue.json');
 if(!fs.existsSync(stateFile)&&!bootstrap)throw Error('Bootstrap published features before enabling notifications');
 const state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile)):{version:1,languages:{}};
 const queue=fs.existsSync(queueFile)?JSON.parse(fs.readFileSync(queueFile)):{version:1,pending:{}};
 if(state.version!==1||!state.languages||queue.version!==1||!queue.pending)throw Error('Invalid feature publication state');
 const changed=[];
 for(const language of Object.keys(LANGUAGES)){
  const file=path.join(root,'features/planned',language+'.json');
  const catalog=JSON.parse(fs.readFileSync(file));
  if(catalog.schemaVersion!==1||catalog.language!==language)throw Error('Feature language mismatch');
  const selected=selectFeature(catalog,now);if(!selected)continue;
  if(selected.articles.length<5||selected.articles.length>10)throw Error('Invalid feature size');
  const publicFile=path.join(root,'features',language,'index.json');
  const published=JSON.parse(fs.readFileSync(publicFile));
  if(state.languages[language]?.featureId===selected.id&&published.features.some(f=>f.id===selected.id))continue;
  const sourceFile=path.join(root,'local-data',language,'scp-data.json');
  const available=new Set(JSON.parse(fs.readFileSync(sourceFile)).data.filter(r=>r.isTranslatedJP!==false).map(r=>r.itemId));
  const articles=selected.articles.filter(a=>available.has(a.itemId));
  if(articles.length<5)continue;
  if(state.languages[language]&&Date.parse(state.languages[language].publishedAt)>Date.parse(selected.publishedAt))continue;
  state.languages[language]={featureId:selected.id,publishedAt:selected.publishedAt};
  if(!published.features.some(f=>f.id===selected.id))published.features.push({...selected,articles});
  fs.writeFileSync(publicFile,JSON.stringify(published,null,2)+'\n');
  if(!bootstrap){const previous=queue.pending[language]||{lastSentWindow:null};queue.pending[language]={...previous,items:[{itemId:selected.id,titleJP:selected.title}]};}
  changed.push(language);
 }
 if(changed.length||bootstrap){fs.writeFileSync(stateFile,JSON.stringify(state,null,2)+'\n');fs.writeFileSync(queueFile,JSON.stringify(queue,null,2)+'\n');}
 return changed;
}
if(require.main===module)console.log(JSON.stringify(publish({bootstrap:process.argv.includes('--bootstrap')})));
module.exports={publish,selectFeature};
