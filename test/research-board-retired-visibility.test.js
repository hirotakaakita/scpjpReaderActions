'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {retiredVisibility,isRetiredArticle,BRIGHT,JP_NOTICE}=require('../research-board/retired-visibility');
const jp='https://scp-jp.wikidot.com/scp-963';
const en='https://scp-wiki.wikidot.com/scp-963';
const solo='https://scp-jp.wikidot.com/announceme';
const arc='https://scp-jp.wikidot.com/scp-963-arc';
const version=u=>['jp',u,'scp-963',u,'fetched'];
function record(url,title,credit){
 return {record:{url,title,originalSources:credit?[{url:credit,method:'credit_original_label'}]:[]},
  lastAttempt:{status:'success'}};
}
const node=(i,urls)=>{const n=Array(15).fill(null);n[0]=i;n[13]=urls.map(version);return n};
test('withdrawn Japanese publisher placeholder excluded without hiding unrelated live work',()=>{
 const nodes=[node(0,[jp,en]),node(1,[solo]),node(2,[arc])];
 const sources=new Map([
  ['jp',record(jp,JP_NOTICE,BRIGHT)],
  ['en',record(en,'The Old SCP-963','')],
  ['solo',record(solo,JP_NOTICE,BRIGHT)],
  ['arc',record(arc,'Archived SCP-963',BRIGHT)]
 ]);
 const r=retiredVisibility(nodes,sources);
 assert.deepEqual(r.pageUrls,[solo,jp].sort());
 assert.deepEqual(r.nodeIds,[1]);
 assert.equal(r.evidence.length,2);
});
test('same publisher title without explicit retired-original credit does not hide page',()=>{
 const s=record(jp,JP_NOTICE,null);
 assert.equal(isRetiredArticle(s.record,s),false);
});
test('English numbered SCP slot currently replaced by staff notice is retired',()=>{
 const s=record(en,'Bright Works Message',null);
 assert.equal(isRetiredArticle(s.record,s),true);
 const staff=record(BRIGHT,'Bright Works Message',null);
 assert.equal(isRetiredArticle(staff.record,staff),false);
});
test('inaccessible source, ARC version or old draft is not conflated with retirement',()=>{
 const s=record(jp,JP_NOTICE,BRIGHT);s.lastAttempt.status='not_found';
 assert.equal(isRetiredArticle(s.record,s),false);
 const old=record('https://scp-jp.wikidot.com/old:scp-8045',JP_NOTICE,BRIGHT);
 assert.equal(isRetiredArticle(old.record,old),true);
});
