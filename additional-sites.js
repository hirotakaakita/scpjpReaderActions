'use strict';
const sites=require('./additional-sites.json');
function additionalLanguages(){
 return Object.fromEntries(Object.entries(sites).map(([code,site])=>{
  const origin=site.origin||code,namespace=site.namespace||'';
  const nativePattern=site.nativePrefix?`^\\/${namespace}scp-${site.nativePrefix}-(\\d+)$`:`^\\/${namespace}scp-(\\d+)-${origin}$`;
  const pages=[...(site.nativePrimary===false?[]:[{path:site.nativeIndex,pageType:'scp-series-'+origin,entryPattern:nativePattern,extractMode:'anyLink',scopedLinks:true,namespace}]),
   ...site.series.map(n=>({path:namespace+'scp-series'+(n===1?'':'-'+n),pageType:'scp-series',entryPattern:`^\\/${namespace}scp-(\\d+)$`,numberRange:[n===1?1:(n-1)*1000,n*1000-1],extractMode:'anyLink',scopedLinks:true,namespace}))];
  return [code,{baseUrl:'https://'+site.host,enBaseUrl:'https://scp-wiki.wikidot.com',namespace,pages}];
 }));
}
module.exports={additionalLanguages};
