'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildBoard}=require('../research-board/catalog');
const {normalizePage}=require('../research-board/extract');
const stamp='2026-11-08T00:00:00Z';
const hosts={jp:'scp-jp.wikidot.com',cn:'scp-wiki-cn.wikidot.com',es:'lafundacionscp.wikidot.com',int:'scp-int.wikidot.com'};
function fixture(site,slug='aeliana',origin='jp',extra={}){
 const url=`https://${hosts[site]}/${slug}`,p=normalizePage(url);
 const row={itemId:`document-${site}--${slug}`,pageType:`related-document-${origin}`,contentType:'goi',urlJP:url,isTranslatedJP:true,titleJP:site+':'+slug,...extra};
 return {row,catalog:{language:site,timestamp:stamp,data:[row]},id:p.id,state:{record:{url,pageId:p.id,title:row.titleJP,tags:[origin],authors:site==='es'?[]:[{url:'https://www.wikidot.com/user:info/amamiel'}],catalogIdentity:{originBranch:origin,basis:'publisher_origin_tag'},limitations:['legacy_unchecked_links'],contentSha256:'a'.repeat(64),checkedAt:stamp},lastAttempt:{status:'success',at:stamp}}};
}
const board=items=>buildBoard(items.map(x=>x.catalog),new Map(items.map(x=>[x.id,x.state])));

test('raw IDs reused across reclassified non-SCP works are flagged without merging',()=>{
 const id='joke-scps-173-but-it-s-the-admonition-hub';
 const first=fixture('jp','different-joke','en',{itemId:id,pageType:'joke-scps',contentType:'scp'});
 const second=fixture('cn','different-hub','jp',{itemId:id,pageType:'related-document-jp',contentType:'hub'});
 const b=board([first,second]);
 assert.equal(b.nodes.length,2);
 assert(b.overview.ambiguousArticleIds.includes(id));
});
test('AELIANA original and three translations form one JP work with all old identities',()=>{
 const b=board(['jp','cn','es','int'].map(s=>fixture(s)));assert.equal(b.nodes.length,1);
 const n=b.nodes[0];assert.equal(n[8],'jp');assert.equal(n[11],'jp');assert.equal(n[13].length,4);assert.equal(n[14][2].length,4);
 assert.equal(n[14][0],'catalog:related-document-jp:document-jp--aeliana');assert.equal(b.edges.length,0);assert.equal(b.workIdentityProofs.length,3);
});
test('same slug without confirmed origin, incompatible author or original branch is not merged',()=>{
 for(const mode of ['unknown','author','branch']){
   const jp=fixture('jp'),cn=fixture('cn');
   if(mode==='unknown'){delete cn.state.record.catalogIdentity;cn.state.record.tags=[];}
   if(mode==='author')cn.state.record.authors=[{url:'https://www.wikidot.com/user:info/another-author'}];
   if(mode==='branch')cn.row.pageType='related-document-cn';
   assert.equal(board([jp,cn]).nodes.length,2,mode);
 }
});

test('work identity is independent of differing document categories when the author and original path agree',()=>{
 const jp=fixture('jp'),cn=fixture('cn');cn.row.contentType='record';
 const b=board([jp,cn]);assert.equal(b.nodes.length,1);assert.equal(b.nodes[0][3],6);
 assert.equal(b.nodes[0][14][0],'catalog:related-document-jp:document-jp--aeliana');
});

test('a distinctive hub with explicit publisher origin joins its native work without author metadata',()=>{
 const jp=fixture('jp','distinct-canon-hub','jp',{contentType:'hub'}),cn=fixture('cn','distinct-canon-hub','jp',{contentType:'hub'});
 jp.state.record.authors=[];cn.state.record.authors=[];assert.equal(board([jp,cn]).nodes.length,1);
 delete cn.state.record.catalogIdentity;cn.state.record.tags=[];assert.equal(board([jp,cn]).nodes.length,2);
});

test('numbered document/log paths join a native catalog work despite legacy SCP category and absent provenance metadata',()=>{
 hosts.en='scp-wiki.wikidot.com';hosts.ru='scpfoundation.net';
 const en=fixture('en','scp-093-blue-test','en',{contentType:'record'});
 const ru=fixture('ru','scp-093-blue-test','en',{itemId:'scp-series-093-blue-test',pageType:'scp-series',contentType:'scp'});
 delete ru.state.record.catalogIdentity;ru.state.record.authors=[];
 const b=board([en,ru]);assert.equal(b.nodes.length,1);assert.equal(b.nodes[0][3],1);
 assert.equal(b.nodes[0][13].length,2);assert(b.nodes[0][14][2].includes('catalog:scp-series:scp-series-093-blue-test'));
});

test('a category difference cannot split a distinctive work with confirmed origin and exact native path',()=>{
 const jp=fixture('jp'),cn=fixture('cn');cn.row.contentType='record';jp.state.record.authors=[];cn.state.record.authors=[];
 assert.equal(board([jp,cn]).nodes.length,1);
 delete cn.state.record.catalogIdentity;cn.state.record.tags=[];assert.equal(board([jp,cn]).nodes.length,2);
});

test('two collected translations join without inventing a native node when origin, full path and author agree',()=>{
 const cn=fixture('cn'),intl=fixture('int');
 const b=board([cn,intl]);assert.equal(b.nodes.length,1);assert.equal(b.nodes[0][13].length,2);
 assert(b.nodes[0][13].every(p=>p[0]!=='jp'));
 intl.state.record.authors=[];assert.equal(board([cn,intl]).nodes.length,1);
 intl.state.record.catalogIdentity.basis='publisher_default_origin';intl.state.record.tags=[];assert.equal(board([cn,intl]).nodes.length,2);
});

test('verified interwiki original pointers merge renamed translations and preserve legacy aliases',()=>{
 const jp=fixture('jp','original'),cn=fixture('cn','renamed-translation');
 cn.state.record.authors=[];
 cn.state.record.catalogIdentity={originBranch:'jp',basis:'interwiki_original_metadata',originalSources:[{url:jp.row.urlJP,method:'interwiki_original_metadata'}]};
 const b=board([jp,cn]);assert.equal(b.nodes.length,1);assert.equal(b.nodes[0][13].length,2);
 assert(b.nodes[0][14][2].includes('catalog:related-document-jp:document-cn--renamed-translation'));
 cn.state.record.originalSources=[{url:'https://scp-jp.wikidot.com/not-collected',method:'credit_original_label'}];
 assert.equal(board([jp,cn]).nodes.length,2,'current explicit credits override older interwiki metadata');
});

test('verified shared metadata can join two translations of an uncollected original across renamed paths',()=>{
 const cn=fixture('cn','translated-a'),es=fixture('es','translated-b');
 for(const x of [cn,es])x.state.record.catalogIdentity={originBranch:'jp',basis:'interwiki_original_metadata',originalSources:[{url:'https://scp-jp.wikidot.com/original-not-collected',method:'interwiki_original_metadata'}]};
 assert.equal(board([cn,es]).nodes.length,1);
 es.state.record.catalogIdentity.originalSources[0].url='https://scp-jp.wikidot.com/different';assert.equal(board([cn,es]).nodes.length,2);
});

test('a shared original with one credit and one metadata pointer is recorded as a mixed metadata proof',()=>{
 const cn=fixture('cn','mixed-a'),es=fixture('es','mixed-b'),url='https://scp-jp.wikidot.com/not-collected';
 cn.state.record.originalSources=[{url,method:'credit_original_label'}];
 es.state.record.catalogIdentity={originBranch:'jp',basis:'interwiki_original_metadata',originalSources:[{url,method:'interwiki_original_metadata'}]};
 const b=board([cn,es]);assert.equal(b.nodes.length,1);
 assert(b.workIdentityProofs.some(p=>p.method==='shared_verified_original_metadata'));
 assert(!b.workIdentityProofs.some(p=>p.method==='shared_explicit_original_credit'));
});

test('distinctive translated hubs with two explicit publisher origins merge without author metadata',()=>{
 const cn=fixture('cn','end-of-death-hub','jp',{contentType:'hub'}),es=fixture('es','end-of-death-hub','jp',{contentType:'hub'});
 cn.state.record.authors=[];es.state.record.authors=[];
 assert.equal(board([cn,es]).nodes.length,1);
 es.state.record.catalogIdentity.basis='publisher_default_origin';es.state.record.tags=[];assert.equal(board([cn,es]).nodes.length,2);
 es.state.record.catalogIdentity.basis='publisher_origin_tag';es.state.record.tags=[];assert.equal(board([cn,es]).nodes.length,2);
});

test('missing-original fallback still rejects conflicting authors and generic resource paths',()=>{
 const cn=fixture('cn'),es=fixture('es');es.state.record.authors=[{url:'https://www.wikidot.com/user:info/different'}];
 assert.equal(board([cn,es]).nodes.length,2);
 assert.equal(board([fixture('cn','canon-hub'),fixture('es','canon-hub')]).nodes.length,2);
});

test('asset-only authors never create a false conflict against a translated article creator',()=>{
 const jp=fixture('jp'),cn=fixture('cn');jp.state.record.authorCreditVersion=2;
 jp.state.record.originalAuthors=[];jp.state.record.authors=[{id:'image-maker'}];jp.state.record.assetAuthors=[{id:'image-maker'}];
 assert.equal(board([jp,cn]).nodes.length,1);
});

test('publisher origin tags identify full unusual joke paths without numeric catalog metadata',()=>{
 hosts.en='scp-wiki.wikidot.com';hosts.ru='scpfoundation.net';
 const en=fixture('en','scp-botnik-j','en',{contentType:'scp',pageType:'joke-scps'}),ru=fixture('ru','scp-botnik-j','en',{contentType:'scp',pageType:'joke-scps'});
 delete ru.state.record.catalogIdentity;ru.state.record.tags=['филиал:en'];ru.state.record.authors=[];
 assert.equal(board([en,ru]).nodes.length,1);
});

test('translations with the same explicit original credit join across different paths even when the original is uncollected',()=>{
 const cn=fixture('cn','translated-a'),es=fixture('es','translated-b');
 for(const x of [cn,es])x.state.record.originalSources=[{url:'https://scp-jp.wikidot.com/not-in-catalog',method:'credit_original_label'}];
 const b=board([cn,es]);assert.equal(b.nodes.length,1);assert.equal(b.overview.sourcePageCount,2);assert.equal(b.nodes[0][13].length,2);
 es.state.record.originalSources=[{url:'https://scp-jp.wikidot.com/different-original',method:'credit_original_label'}];assert.equal(board([cn,es]).nodes.length,2);
});

test('known translator roles are excluded from original author identity and conflicts between actual authors stay separate',()=>{
 const jp=fixture('jp'),cn=fixture('cn');
 jp.state.record.authorCreditVersion=cn.state.record.authorCreditVersion=1;
 jp.state.record.originalAuthors=[{id:'original'}];cn.state.record.originalAuthors=[];
 cn.state.record.translators=[{id:'translator'}];cn.state.record.authors=[{url:'https://www.wikidot.com/user:info/translator'}];
 assert.equal(board([jp,cn]).nodes.length,1);
 cn.state.record.originalAuthors=[{id:'different-original'}];assert.equal(board([jp,cn]).nodes.length,2);
});

test('unlabelled fresh credits do not erase a legacy author conflict',()=>{
 const jp=fixture('jp'),cn=fixture('cn');cn.state.record.authorCreditVersion=1;cn.state.record.originalAuthors=[];cn.state.record.translators=[];
 cn.state.record.authors=[{url:'https://www.wikidot.com/user:info/different-author'}];assert.equal(board([jp,cn]).nodes.length,2);
});

test('only known translator accounts are removed when original-author labels are missing',()=>{
 const cn=fixture('cn'),intl=fixture('int');cn.state.record.authorCreditVersion=1;cn.state.record.originalAuthors=[];
 cn.state.record.translators=[{id:'translator'}];cn.state.record.authors.push({url:'https://www.wikidot.com/user:info/translator'});
 assert.equal(board([cn,intl]).nodes.length,1);
});

test('an explicit uncollected original compatible with path/author evidence does not split established translations',()=>{
 const cn=fixture('cn'),intl=fixture('int');cn.state.record.originalSources=[{url:'https://scp-jp.wikidot.com/aeliana',method:'credit_original_label'}];
 assert.equal(board([cn,intl]).nodes.length,1);
 cn.state.record.originalSources=[{url:'https://scp-jp.wikidot.com/different-original',method:'credit_original_label'}];
 assert.equal(board([cn,intl]).nodes.length,2);
});

test('shared deletion notices or collection credits cannot combine different works',()=>{
 const items=[fixture('cn','work-a'),fixture('int','work-a'),fixture('cn','work-b'),fixture('int','work-b')];
 for(const x of items)x.state.record.originalSources=[{url:'https://scp-jp.wikidot.com/deletion-notice',method:'credit_original_label'}];
 const b=board(items);assert.equal(b.nodes.length,2);
 assert(b.nodes.every(n=>new Set(n[13].map(p=>p[2])).size===1));
 assert(b.identityReview.some(r=>r.reason==='non_unique_original_credit'));
});
test('generic hubs, different proposal paths and uncorroborated translation-only catalogs remain separate',()=>{
 assert.equal(board([fixture('jp','groups-of-interest'),fixture('cn','groups-of-interest')]).nodes.length,2);
 assert.equal(board([fixture('jp','scp-001-proposal-a'),fixture('cn','scp-001-proposal-b')]).nodes.length,2);
 const es=fixture('es');es.state.record.catalogIdentity.basis='official_index_section';es.state.record.tags=[];
 assert.equal(board([fixture('cn'),es]).nodes.length,2);
});
test('explicit original credit handles changed translation URLs but never creates uncataloged nodes',()=>{
 const jp=fixture('jp'),cn=fixture('cn','translated-name');cn.state.record.originalSources=[{url:jp.row.urlJP,method:'credit_original_label',quote:'原文:'}];
 assert.equal(board([jp,cn]).nodes.length,1);assert.equal(board([cn]).nodes.length,1);
});
test('conflicting original credits cannot join two originals transitively',()=>{
 const a=fixture('jp','a'),b=fixture('jp','b'),cn=fixture('cn','translation');cn.state.record.originalSources=[a,b].map(x=>({url:x.row.urlJP,method:'credit_original_label'}));
 assert.equal(board([a,b,cn]).nodes.length,3);
});
test('temporary fetch errors retain established identity while semantic relations remain excluded',()=>{
 const jp=fixture('jp'),cn=fixture('cn');cn.state.lastAttempt={status:'failed',at:stamp};assert.equal(board([jp,cn]).nodes.length,1);
});
test('an explicit original wins over a same-path native page, including an uncollected original',()=>{
 const original=fixture('jp'),samePath=fixture('jp','translated-name'),cn=fixture('cn','translated-name');
 cn.state.record.originalSources=[{url:original.row.urlJP,method:'credit_original_label'}];
 const b=board([original,samePath,cn]);assert.equal(b.nodes.length,2);assert.equal(b.nodes.find(n=>n[13].some(p=>p[0]==='cn'))[4],'aeliana');
 assert.equal(board([samePath,cn]).nodes.length,2);
});
test('multiple original sources cannot turn a compilation into one constituent work',()=>{
 const jp=fixture('jp'),cn=fixture('cn');cn.state.record.originalSources=[jp.row.urlJP,'https://scp-jp.wikidot.com/not-collected'].map(url=>({url,method:'credit_original_label'}));
 assert.equal(board([jp,cn]).nodes.length,2);
});
test('traditional Chinese native page is the representative rather than its CN translation',()=>{
 hosts['zh-tr']='scp-zh-tr.wikidot.com';
 const original=fixture('zh-tr','example','zh'),cn=fixture('cn','example','zh');
 const b=board([original,cn]);assert.equal(b.nodes.length,1);assert.equal(b.nodes[0][11],'zh-tr');
});
test('SCP translations with legacy document IDs join their full original identity without rewriting IDs',()=>{
 const jp=fixture('jp','scp-749-jp','jp',{itemId:'scp-series-jp-749',pageType:'scp-series-jp',contentType:'scp'});
 const ko=fixture('cn','scp-749-jp','jp',{itemId:'document-ko--scp-749-jp',pageType:'scp-series-jp',contentType:'scp',urlJP:'https://scpko.wikidot.com/scp-749-jp'});
 ko.catalog.language='ko';ko.id=normalizePage(ko.row.urlJP).id;ko.state.record.url=ko.row.urlJP;ko.state.record.pageId=ko.id;
 const b=board([jp,ko]);assert.equal(b.nodes.length,1);assert.equal(b.nodes[0][13].length,2);
 assert(b.nodes[0][14][2].includes('catalog:scp-series-jp:document-ko--scp-749-jp'));
 assert.equal(b.nodes[0][14][1],'scp-series-jp-749');
});
test('full SCP identity never merges different suffixes, branches, J/EX categories or 001 proposals',()=>{
 const variants=[
  ['scp-749-jp','scp-series-jp','scp'],['scp-749-jp-j','joke-scps-jp','scp'],
  ['scp-749-jp-ex','scp-jp-ex','scp'],['scp-749-ko','scp-series-ko','scp'],
  ['scp-001-jp-a','scp-series-jp','scp'],['scp-001-jp-b','scp-series-jp','scp']
 ];
 const items=variants.map(([slug,pageType,contentType],i)=>fixture('jp',slug,pageType.includes('ko')?'ko':'jp',{itemId:'legacy-'+i,pageType,contentType}));
 assert.equal(board(items).nodes.length,variants.length);
});
test('reused legacy IDs cannot attach a different branch work to the same-numbered EN work',()=>{
 hosts.en='scp-wiki.wikidot.com';hosts.de='scp-wiki-de.wikidot.com';
 const en=fixture('en','scp-015-j','en',{itemId:'joke-scps-015',pageType:'joke-scps',contentType:'scp'});
 const de=fixture('de','scp-015-de-j','en',{itemId:'joke-scps-015',pageType:'joke-scps',contentType:'scp'});
 const translated=fixture('int','scp-015-de-j','de',{itemId:'joke-scps-de-015',pageType:'joke-scps-de',contentType:'scp'});
 const b=board([en,de,translated]);assert.equal(b.nodes.length,2);
 const native=b.nodes.find(n=>n[8]==='de');assert.deepEqual(native[13].map(p=>p[0]).sort(),['de','int']);
 assert(!native[14][2].includes('catalog:joke-scps:joke-scps-015'));
 assert.equal(b.nodes.find(n=>n[8]==='en')[13].length,1);
});
test('001 suffix variants sharing an old numeric ID stay separate while their translations join',()=>{
 hosts.en='scp-wiki.wikidot.com';hosts.th='scp-th.wikidot.com';
 const button=fixture('en','scp-001-j','en',{itemId:'joke-scps-001',pageType:'joke-scps',contentType:'scp'});
 const ckg=fixture('en','scp-001-ex-j','en',{itemId:'joke-scps-001-ex-j',pageType:'joke-scps',contentType:'scp'});
 const th=fixture('th','scp-001-ex-j','en',{itemId:'joke-scps-001',pageType:'joke-scps',contentType:'scp'});
 const b=board([button,ckg,th]);assert.equal(b.nodes.length,2);assert.equal(b.nodes.find(n=>n[4]==='scp-001-ex-j')[13].length,2);
});
test('language-like words later in an SCP suffix do not become original branch codes',()=>{
 hosts.en='scp-wiki.wikidot.com';
 const p=fixture('en','scp-173-but-it-s-the-admonition-hub','en',{itemId:'joke-scps-173-long',pageType:'joke-scps',contentType:'scp'});
 assert.equal(board([p]).nodes[0][8],'en');
});
test('branch-scoped fallback keeps actual catalog IDs when a legacy ID is reused without another alias',()=>{
 hosts.en='scp-wiki.wikidot.com';hosts.de='scp-wiki-de.wikidot.com';
 const en=fixture('en','scp-015-j','en',{itemId:'joke-scps-015',pageType:'joke-scps',contentType:'scp'});
 const de=fixture('de','scp-015-de-j','en',{itemId:'joke-scps-015',pageType:'joke-scps',contentType:'scp'});
 const b=board([en,de]);assert.equal(b.nodes.length,2);assert(b.nodes.every(n=>n[14][2].length));
 assert(b.overview.ambiguousArticleIds.includes('joke-scps-015'));
 assert.equal(b.nodes.find(n=>n[8]==='de')[14][1],'joke-scps-015');
 assert.equal(new Set(b.nodes.flatMap(n=>n[14][2])).size,b.nodes.flatMap(n=>n[14][2]).length);
});
test('prefix and suffix branch spelling share the same full SCP identity',()=>{
 hosts.de='scp-wiki-de.wikidot.com';
 const de=fixture('de','scp-272-de','de',{itemId:'scp-series-de-272',pageType:'scp-series-de',contentType:'scp'});
 const es=fixture('es','scp-de-272','de',{itemId:'document-es--scp-de-272',pageType:'scp-series-de',contentType:'scp'});
 const b=board([de,es]);assert.equal(b.nodes.length,1);assert.equal(b.nodes[0][13].length,2);
});
test('same-branch variants reusing a legacy ID get distinct work keys while keeping the article ID',()=>{
 hosts.ko='scpko.wikidot.com';
 const original=fixture('ko','scp-001-ex-ko-j','ko',{itemId:'joke-scps-ko-001',pageType:'joke-scps-ko',contentType:'scp'});
 const other=fixture('cn','scp-001-ko-j','ko',{itemId:'joke-scps-ko-001',pageType:'joke-scps-ko',contentType:'scp'});
 const b=board([original,other]);assert.equal(b.nodes.length,2);assert(b.nodes.every(n=>n[14][2].length));
 assert(b.nodes.some(n=>n[14][0].includes('@work-')));assert(b.nodes.every(n=>n[14][1]==='joke-scps-ko-001'));
});
test('explicit original-language tags resolve legacy EN list entries without positional branch codes',()=>{
 hosts.en='scp-wiki.wikidot.com';
 const jp=fixture('jp','scp-001-ex-solvex','jp',{itemId:'scp-jp-ex-solvex',pageType:'scp-jp-ex',contentType:'scp'});
 const en=fixture('en','scp-001-ex-solvex','en',{itemId:'scp-ex-solvex',pageType:'scp-ex',contentType:'scp'});
 en.state.record.tags=['international','_jp'];
 const b=board([jp,en]);assert.equal(b.nodes.length,1);assert.equal(b.nodes[0][8],'jp');
});
