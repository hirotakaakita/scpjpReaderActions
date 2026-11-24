'use strict';
const fs=require('node:fs'),path=require('node:path'),z=require('node:zlib');
const {LANGUAGES}=require('../languages');
const {repairStoredExcerpt,titleNeedsRepair}=require('../article-excerpts');
const {normalize}=require('../related-documents');
function read(file){return JSON.parse(file.endsWith('.gz')?z.gunzipSync(fs.readFileSync(file)):fs.readFileSync(file,'utf8'));}
function audit({root=path.resolve(__dirname,'..'),input=path.join(root,'local-data/mobile-v3'),strict=false,writeReport=true}={}){
 const report={version:1,checkedAt:new Date().toISOString(),total:0,languages:{},problems:[],emptySourceBodies:[],datePrefixes:[]};
 const previousFile=path.join(root,'local-data/article-text-audit.json.gz');
 const previousEmpty=new Set(fs.existsSync(previousFile)?(read(previousFile).emptySourceBodies||[]).map(r=>normalize(r.url)?.url):[]);
 for(const language of Object.keys(LANGUAGES)){
  const pointer=path.join(input,language,'manifest.json');if(!fs.existsSync(pointer))continue;
  const manifest=read(pointer),rows=read(path.join(path.dirname(pointer),manifest.fileName)).data;
  const verified=new Set(previousEmpty);const repair=path.join(root,'partial-data/excerpt-repairs',language+'.json.gz');
  if(fs.existsSync(repair))for(const edit of read(repair).edits||[])if(!edit.text&&(edit.descriptionStatus==='no_prose'||edit.method==='no_prose'))verified.add(normalize(edit.url)?.url);
  const stats={total:rows.length,missingTitles:0,emptyBodies:0,verifiedEmptyBodies:0,contaminated:0};report.languages[language]=stats;
  for(const row of rows){report.total++;const url=row.urlJP||row.urlEN,body=String(row.descriptionExcerpt||'').trim(),title=row.titleJP,issues=[];
   if(titleNeedsRepair(title)){stats.missingTitles++;issues.push('missing_or_technical_title');}
   const checked=repairStoredExcerpt(body);
   if(checked.needsFetch||checked.text!==body){stats.contaminated++;issues.push('technical_or_metadata_excerpt');}
   if(!body){stats.emptyBodies++;if(verified.has(normalize(url)?.url)){stats.verifiedEmptyBodies++;report.emptySourceBodies.push({language,id:row.itemId,url});}else issues.push('unverified_empty_excerpt');}
   if(/^\d{1,4}[年月/.-]\d{1,2}[月/.-]\d{1,4}|^\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}/u.test(body))report.datePrefixes.push({language,id:row.itemId,url,excerpt:body.slice(0,180)});
   if(issues.length)report.problems.push({language,id:row.itemId,url,title,issues,excerpt:body.slice(0,500)});
  }
 }
 if(!report.total)throw Error('No published articles to audit');
 if(writeReport){const file=path.join(root,'local-data/article-text-audit.json.gz');fs.writeFileSync(file,z.gzipSync(JSON.stringify(report),{level:9}));}
 console.log(JSON.stringify({audited:report.total,languages:Object.keys(report.languages).length,problems:report.problems.length,sourcePagesWithoutProse:report.emptySourceBodies.length,datePrefixesKept:report.datePrefixes.length,examples:report.problems.slice(0,5)}));
 if(strict&&report.problems.length)throw Error('Unresolved article text quality problems: '+report.problems.length);
 return report;
}
if(require.main===module)audit({strict:process.env.ARTICLE_TEXT_REQUIRE_COMPLETE==='1'||process.argv.includes('--strict'),...(process.argv[2]&&!process.argv[2].startsWith('--')?{input:path.resolve(process.argv[2])}:{})});
module.exports={audit};
