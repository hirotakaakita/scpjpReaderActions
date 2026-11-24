'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const {buildBoard}=require('../research-board/catalog');
const {makeRecord,normalizePage,digest}=require('../research-board/extract');
const {verifiedScpOriginal}=require('../research-board/explicit-scp-origin');
const {validate,validateBoard,validateScpIdentities}=require('../research-board/validate');
const {saveSources}=require('../research-board/source-store');
const en='https://scp-wiki.wikidot.com/',es='https://lafundacionscp.wikidot.com/';
const cn='https://scp-wiki-cn.wikidot.com/',jp='https://scp-jp.wikidot.com/';
const stamp='2026-11-22T00:00:00Z';
const page=(base,slug)=>base+slug;
const row=(url,kind,id)=>({urlJP:url,isTranslatedJP:true,itemId:id,
  pageType:kind,contentType:'scp',numericItemId:parseInt((/\d+/.exec(id)||['0'])[0],10)});
const catalog=(language,entries)=>({language,timestamp:stamp,data:entries,totalCount:entries.length});
const html=body=>'<title>Article</title><div id="page-content">'+
  '<p>'+('Detailed SCP description. '.repeat(12))+'</p>'+body+'</div>';
function record(url,body='',originals=[]) {
 const r=makeRecord(url,html(body),'html',stamp);
 r.originalSources=originals.map(target=>({url:target,method:'credit_original_label',quote:'Original Article'}));
 return r;
}
function index(...records) {
 return new Map(records.map(r=>[r.pageId,{record:r,lastAttempt:{status:'success',at:stamp}}]));
}
const find=(board,url)=>board.nodes.find(n=>n[13].some(v=>v[1]===url));
function esCase(){
 const original=page(es,'scp-es-026'),other=page(es,'scp-es-179'),
   translated=page(en,'scp-179'),zh=page('https://scp-zh-tr.wikidot.com/','scp-179');
 const catalogs=[
  catalog('es',[row(original,'scp-series-es','scp-series-es-026'),
    row(other,'scp-series-es','scp-series-es-179')]),
  // A historical catalog that reused the local ES-179 ID for its translated EN article.
  catalog('en',[row(translated,'scp-series-es','scp-series-es-179')]),
  catalog('zh-tr',[row(zh,'scp-series','scp-series-179')])
 ];
 const src=index(record(original),record(other,'<a href="'+translated+'">ref</a>'),
   record(translated,'<a href="'+other+'">the other article</a>',[original]),record(zh));
 return {original,other,translated,zh,catalogs,src};
}
test('the EN SCP-179 with verified original ES-026 never merges into native ES-179',()=>{
 const f=esCase(),board=buildBoard(f.catalogs,f.src);
 const translated=find(board,f.translated),orig=find(board,f.original),other=find(board,f.other);
 assert(translated&&orig&&other);
 assert.equal(translated[14][0],orig[14][0],'translated EN page belongs to ES-026 work');
 assert.notEqual(translated[14][0],other[14][0],'native ES-179 is independent');
 assert.equal(other[14][0],'catalog:scp-series-es:scp-series-es-179','native keeps original legacy ID');
 assert.equal(orig[14][0],'catalog:scp-series-es:scp-series-es-026','credited original keeps native ID');
 assert(board.workIdentityProofs.some(p=>p.method==='explicit_scp_original_credit'&&
    p.source===f.translated&&p.target===f.original));
 const types=board.overview.types;
 assert(board.edges.some(e=>types[e[2]]==='references'&&
    board.nodes[e[0]][14][0]===other[14][0]&&
    board.nodes[e[1]][14][0]===orig[14][0]),'references now correctly connect two different works');
 assert(!board.nodes.some(n=>n[13].length!==new Set(n[13].map(v=>v[1])).size));
 assert.equal(validateBoard(board,f.catalogs,f.src).verified,true,
   'the real validator must accept the generated identity and reference proofs');
});

test('the real validator accepts a protected same-site split without accepting the original claim',()=>{
 const original='https://fondationscp.wikidot.com/scp-655-fr';
 const existing=en+'scp-655-fr',conflict=en+'scp-705-fr';
 const catalogs=[catalog('fr',[row(original,'scp-series-fr','scp-series-fr-655')]),
   catalog('en',[row(existing,'scp-series-fr','scp-series-fr-655'),
     row(conflict,'scp-series-fr','scp-series-fr-705')])];
 const sources=index(record(original),record(existing),record(conflict,'',[original]));
 const board=buildBoard(catalogs,sources);
 assert.equal(find(board,original)[14][0],find(board,existing)[14][0]);
 assert.notEqual(find(board,conflict)[14][0],find(board,original)[14][0]);
 assert(board.identityReview.some(r=>r.url===conflict&&r.reason==='same_site_identity_collision'));
 assert.equal(validateBoard(board,catalogs,sources).verified,true);
});

test('an original-number merge needs its exact proof and an isolated claim needs a real site collision',()=>{
 const f=esCase(),board=buildBoard(f.catalogs,f.src);
 const withoutProof=structuredClone(board);
 withoutProof.workIdentityProofs=withoutProof.workIdentityProofs.filter(p=>p.method!=='explicit_scp_original_credit');
 assert.throws(()=>validateBoard(withoutProof,f.catalogs,f.src),/Missing exact original SCP proof/);
 const separate=structuredClone(board),original=find(separate,f.original);
 const version=original[13].find(v=>v[1]===f.translated);
 original[13]=original[13].filter(v=>v[1]!==f.translated);
 const split=structuredClone(original);split[13]=[version];split[14][0]='isolated-without-collision';
 separate.nodes.push(split);
 assert.throws(()=>validateScpIdentities(separate,f.src),/Verified original SCP left in another work/);
});

test('persisted board validation checks the corrected graph, its source shards and its checksum',t=>{
 const f=esCase(),board=buildBoard(f.catalogs,f.src);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'scp-origin-validation-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const input=path.join(root,'local-data');
 function writePayload(directory,prefix,value,extra={}){
   fs.mkdirSync(directory,{recursive:true});
   const json=Buffer.from(JSON.stringify(value)),bytes=zlib.gzipSync(json),sha256=digest(bytes);
   const fileName=prefix+'-'+sha256+'.json.gz';
   fs.writeFileSync(path.join(directory,fileName),bytes);
   fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({fileName,sha256,
     bytes:bytes.length,decodedBytes:json.length,...extra}));
   return path.join(directory,fileName);
 }
 for(const c of f.catalogs)writePayload(path.join(input,'mobile-v3',c.language),'catalog',c);
 saveSources(f.src,path.join(input,'research-board-sources'));
 const payload=writePayload(path.join(input,'mobile-v3/research-board'),'board',board,
   {revision:board.revision,nodeCount:board.nodes.length,edgeCount:board.edges.length});
 assert.equal(validate(root).verified,true);
 fs.appendFileSync(payload,'corrupted');
 assert.throws(()=>validate(root),/Board checksum mismatch/);
});
test('EN SCP-179 has an exact cataloged native original, not an inferred numeric match',()=>{
 const f=esCase();
 const pages=new Map([
  [normalizePage(f.translated).id,{...normalizePage(f.translated),siteBranch:'en',branch:'es',pageType:'scp-series-es',kindIndex:0}],
  [normalizePage(f.original).id,{...normalizePage(f.original),siteBranch:'es',branch:'es',pageType:'scp-series-es',kindIndex:0}],
  [normalizePage(f.other).id,{...normalizePage(f.other),siteBranch:'es',branch:'es',pageType:'scp-series-es',kindIndex:0}]
 ]);
 assert.equal(verifiedScpOriginal(pages.get(normalizePage(f.translated).id),pages,f.src)?.url,f.original);
 const missing=index(record(f.translated,'',[page(es,'scp-es-999')]));
 assert.equal(verifiedScpOriginal(pages.get(normalizePage(f.translated).id),pages,missing),null);
});
test('a different credited number is general: ES-004 from EN-2104, CN-2469 from EN-6470',()=>{
 for(const scenario of [
   {lang:'es',host:es,foreign:'scp-es-004',nativeOther:'scp-es-2104',delivery:'scp-2104',type:'scp-series-es'},
   {lang:'cn',host:cn,foreign:'scp-cn-2469',nativeOther:'scp-cn-6470',delivery:'scp-6470',type:'scp-series-cn'}
 ]) {
  const original=page(scenario.host,scenario.foreign),other=page(scenario.host,scenario.nativeOther),
    translated=page(en,scenario.delivery);
  const board=buildBoard([
    catalog(scenario.lang,[row(original,scenario.type,scenario.type+'-'+scenario.foreign.split('-').at(-1)),
      row(other,scenario.type,scenario.type+'-'+scenario.nativeOther.split('-').at(-1))]),
    catalog('en',[row(translated,scenario.type,scenario.type+'-'+scenario.nativeOther.split('-').at(-1))])
  ],index(record(original),record(other),record(translated,'',[original])));
  assert.equal(find(board,translated)?.[14][0],find(board,original)?.[14][0],
    scenario.delivery+' must follow original '+scenario.foreign);
  assert.notEqual(find(board,other)?.[14][0],find(board,original)?.[14][0]);
 }
});
test('ordinary same-number translated SCPs remain grouped without new exceptions',()=>{
 const original=page(en,'scp-005'),translated=page(jp,'scp-005');
 const board=buildBoard([
  catalog('en',[row(original,'scp-series','scp-series-005')]),
  catalog('jp',[row(translated,'scp-series','scp-series-005')])
 ],index(record(original),record(translated)));
 assert.equal(find(board,original)[14][0],find(board,translated)[14][0]);
});
test('a two-hop international credit cannot invalidate a proven direct original identity',()=>{
 const f=esCase();
 const zh=normalizePage(f.zh);
 const record=makeRecord(f.zh,html(''), 'html',stamp);
 record.originalSources=[{url:f.translated,method:'credit_original_label',quote:'Original Article'}];
 f.src.set(zh.id,{record,lastAttempt:{status:'success',at:stamp}});
 const b=buildBoard(f.catalogs,f.src);
 assert.equal(find(b,f.translated)[14][0],find(b,f.original)[14][0],
  'direct native-original work must remain intact');
 assert.notEqual(find(b,f.translated)[14][0],find(b,f.other)[14][0]);
 assert.equal(find(b,f.zh)[14][0],find(b,f.original)[14][0]);
 const proof=b.workIdentityProofs.find(p=>p.method==='explicit_transitive_scp_original_credit');
 assert.deepEqual(proof.chain,[f.zh,f.translated,f.original]);
 assert.equal(validateBoard(b,f.catalogs,f.src).verified,true);
 const broken=structuredClone(b);broken.workIdentityProofs.find(p=>p.method==='explicit_transitive_scp_original_credit').chain=[f.zh,f.original];
 assert.throws(()=>validateBoard(broken,f.catalogs,f.src),/Unproven transitive original SCP credit/);
});

test('cyclic and ambiguous intermediary credits do not supply a transitive proof',()=>{
 for(const ambiguous of [false,true]){
  const f=esCase();
  f.src.get(normalizePage(f.zh).id).record.originalSources=[{url:f.translated,method:'credit_original_label'}];
  f.src.get(normalizePage(f.translated).id).record.originalSources=ambiguous?
   [{url:f.original,method:'credit_original_label'},{url:f.other,method:'credit_original_label'}]:
   [{url:f.zh,method:'credit_original_label'}];
  const b=buildBoard(f.catalogs,f.src);
  assert(!b.workIdentityProofs.some(p=>p.method==='explicit_transitive_scp_original_credit'));
 }
});
test('Nordic delivery namespaces follow exact credits while retaining every legacy alias',()=>{
 const original=en+'scp-002',translated='https://scp-nd.wikidot.com/sv:scp-002';
 const src=index(record(translated,'',[original]));
 const p={...normalizePage(translated),siteBranch:'nd',branch:'en',pageType:'scp-series',kindIndex:0};
 const native={...normalizePage(original),siteBranch:'en',branch:'en',pageType:'scp-series',kindIndex:0};
 const pages=new Map([[p.id,p],[native.id,native]]);
 assert.equal(verifiedScpOriginal(p,pages,src)?.url,original);
 const legacy='scp-series-sv:scp-002';
 const board=buildBoard([catalog('en',[row(original,'scp-series','scp-series-002')]),
   catalog('sv',[row(translated,'scp-series',legacy)])],src);
 assert.equal(find(board,translated)[14][0],find(board,original)[14][0]);
 assert(find(board,translated)[14][2].includes('catalog:scp-series:'+legacy));
 assert.equal(validateBoard(board,[catalog('en',[row(original,'scp-series','scp-series-002')]),
   catalog('sv',[row(translated,'scp-series',legacy)])],src).verified,true);
 const draft={...p,slug:'draft:scp-002'};
 assert.equal(verifiedScpOriginal(draft,pages,src),null);
});

test('a reused Nordic catalog ID retains its historical scoped work alias',()=>{
 const original=en+'scp-002',translated='https://scp-nd.wikidot.com/sv:scp-002';
 const catalogs=[catalog('en',[row(original,'scp-series','scp-series-002')]),
   catalog('sv',[row(translated,'scp-series','scp-series-002')])];
 const src=index(record(translated,'',[original]));
 const b=buildBoard(catalogs,src);
 const signature='en\0scp-series\0sv:scp-002';
 const hash=require('../research-board/extract').digest(signature).slice(0,12);
 assert.equal(find(b,translated)[14][0],find(b,original)[14][0]);
 assert(find(b,translated)[14][2].includes('catalog:scp-series:scp-series-002@work-'+hash));
 assert.equal(validateBoard(b,catalogs,src).verified,true);
});
test('missing target, cross-branch credit and non-native target are not auto trusted',()=>{
 const f=esCase();
 const src=index(record(f.translated,'',[f.original]));
 const pageEN={...normalizePage(f.translated),branch:'es',pageType:'scp-series-es',siteBranch:'en',kindIndex:0};
 const native={...normalizePage(f.original),branch:'es',pageType:'scp-series-es',siteBranch:'es',kindIndex:0};
 const bad={...native,siteBranch:'cn'};
 const map=new Map([[native.id,bad],[pageEN.id,pageEN]]);
 assert.equal(verifiedScpOriginal(pageEN,map,src),null);
 native.pageType='scp-series';map.set(native.id,native);
 assert.equal(verifiedScpOriginal(pageEN,map,src),null);
});
