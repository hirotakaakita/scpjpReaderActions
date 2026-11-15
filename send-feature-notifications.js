'use strict';
const path=require('node:path');
const {main:send}=require('./send-scheduled-notifications');
const labels=require('./feature-notification-messages.json');
const fs=require('node:fs');
const topicPrefix=fs.existsSync(path.join(__dirname,'staging-environment.js'))
 ? require('./staging-environment').TOPIC_PREFIX.replace('new_scp_','weekly_feature_') : 'weekly_feature_';
function featureWindow(now){
 const day=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate(),10));
 day.setUTCDate(day.getUTCDate()-(day.getUTCDay()-3+7)%7);
 if(day>now)day.setUTCDate(day.getUTCDate()-7);
 return day.toISOString().slice(0,10);
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
