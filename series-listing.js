'use strict';
// Delivery grouping is independent of the wiki's physical index-page names.
function normalizedSourceListing(row) {
 const type=row.pageType,source=row.extractedFrom,n=row.numericItemId;
 const series=type==='scp-series'||/^scp-series-[a-z][a-z-]*$/.test(type||'');
 if(!series)return source==='api'?type:source;
 const aliases={'serie-scp-es':'scp-series-es','liste-fr':'scp-series-fr','scp-it-serie-i':'scp-series-it','lista-pl':'scp-series-pl'};
 const alias=Object.keys(aliases).find(key=>aliases[key]===type&&(source===key||new RegExp('^'+key+'-\\d+$').test(source)));
 const canonical=source===type||new RegExp('^'+type+'-\\d+$').test(source);
 const portuguese=type==='scp-series-pt'&&/^series-\d+-pt$/.test(source);
 if(source!=='api'&&!alias&&!canonical&&!portuguese)return source;
 if(!Number.isSafeInteger(n)||n<0)return source;
 const size=['scp-series-es','scp-series-pt'].includes(type)?100:1000;
 const number=Math.floor(n/size)+1;
 return number===1?type:type+'-'+number;
}
module.exports={normalizedSourceListing};
