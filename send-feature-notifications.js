'use strict';
const path=require('node:path');
const {main:send}=require('./send-scheduled-notifications');
const labels=require('./feature-notification-messages.json');
const fs=require('node:fs');
const topicPrefix=fs.existsSync(path.join(__dirname,'staging-environment.js'))
 ? require('./staging-environment').TOPIC_PREFIX.replace('new_scp_','weekly_feature_') : 'weekly_feature_';
function featureWindow(now,timeZone){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
  timeZone,weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23',
 }).formatToParts(now).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 if(parts.weekday!=='Wed'||Number(parts.hour)!==19)return null;
 return `${parts.year}-${parts.month}-${parts.day}`;
}
function sendFeatures(options={}){return send({
 queuePath:path.join(__dirname,'local-data/feature-notification-queue.json'),
 ledgerPath:path.join(__dirname,'local-data/feature-notification-deliveries.json'),
 windowFor:featureWindow,
 topicPrefix,
 notificationBuilder:(lang,items)=>({title:labels[lang],body:items.at(-1).titleJP}),
 dataBuilder:record=>({type:'weekly_feature',feature_id:record.items.at(-1).itemId,language:record.lang,delivery_id:record.id}),
 ...options,
});}
if(require.main===module)sendFeatures().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={sendFeatures,featureWindow};
