'use strict';
const fs=require('node:fs'),path=require('node:path');
const {generateResearchBoard}=require('./catalog');
function publish(root=path.join(__dirname,'..')){
 const input=path.join(root,'local-data'),reportDir=path.join(root,'partial-data/body-link-reports');
 const reports=fs.existsSync(reportDir)?fs.readdirSync(reportDir).filter(n=>/^[a-z-]+\.json$/.test(n)).sort().map(n=>JSON.parse(fs.readFileSync(path.join(reportDir,n)))):[];
 const manifest=generateResearchBoard(input,path.join(input,'mobile-v3'));
 const attempted=reports.reduce((n,r)=>n+r.attempted,0),updated=reports.reduce((n,r)=>n+r.updated,0),failed=reports.reduce((n,r)=>n+r.failed,0);
 const summary=[`## Existing-article body-link collection`,
  `Checked ${attempted} pages; captured ${updated}; failed ${failed}.`,
  `Published graph: ${manifest.nodeCount} work nodes / ${manifest.edgeCount} edges.`,
  `Revision: ${manifest.revision}`, '',
  '| Site | Checked | Captured | Failed |', '|---|---:|---:|---:|',
  ...reports.map(r=>`| ${r.language} | ${r.attempted} | ${r.updated} | ${r.failed} |`),''].join('\n');
 if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary+'\n');
 console.log(JSON.stringify({manifest,attempted,updated,failed,reports}));return manifest;
}
if(require.main===module)publish();
module.exports={publish};
