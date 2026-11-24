'use strict';
const fs=require('node:fs'),path=require('node:path'),z=require('node:zlib');
const {loadCatalogs}=require('../research-board/catalog');
const {readSources,importDirectory}=require('../research-board/source-store');
const {buildCoverage}=require('../research-board/link-coverage');
function audit(root=path.join(__dirname,'..')){
  const input=path.join(root,'local-data'),sources=readSources(path.join(input,'research-board-sources'));
  importDirectory(sources,path.join(root,'partial-data/related-documents/research-board'));
  return buildCoverage(loadCatalogs(input),sources);
}

if(require.main===module){
  const result=audit(),args=process.argv.slice(2),output=args.includes('--output')?args[args.indexOf('--output')+1]:null;
  if(output){const data=JSON.stringify(result)+'\n';fs.writeFileSync(output,output.endsWith('.gz')?z.gzipSync(data):data);}
  if(args.includes('--matrix')){
    const groups=process.env.BOARD_LINK_FULL_REFRESH==='1'?result.groups:result.groups.filter(g=>g.eligible>0);
    const matrix={include:groups.length?groups:[{id:'none',languages:'all'}]};
    fs.appendFileSync(process.env.GITHUB_OUTPUT,`matrix=${JSON.stringify(matrix)}\nhas_work=${groups.length>0}\n`);
  }
  const {unresolved,groups,...summary}=result;console.log(JSON.stringify(summary,null,2));
}
module.exports={audit};
