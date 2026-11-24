'use strict';
const path=require('node:path');
const {repair}=require('./repair-catalog-excerpts');
async function refreshArticleText(options={}){
 const report=await repair({...options,force:true});
 if(report.failed.length||report.pending.length)throw Error(`Incomplete article refresh: ${report.language}: failed=${report.failed.length}, pending=${report.pending.length}`);
 return report;
}
if(require.main===module)refreshArticleText({root:path.resolve(__dirname,'..'),language:process.argv[2],maxRequests:Number(process.env.EXCERPT_MAX_REQUESTS||100000),intervalMs:Number(process.env.CRAWL_REQUEST_INTERVAL_MS||500),previousFile:process.env.EXCERPT_PREVIOUS_REPAIRS||null}).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={refreshArticleText};
