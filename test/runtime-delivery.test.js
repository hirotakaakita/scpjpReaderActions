'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const {runtimeBoard,writeDelivery,loadAudit}=require('../research-board/runtime-delivery');
const {buildBoard}=require('../research-board/catalog');
function fixture(){
  const board=buildBoard([{language:'en',timestamp:'2026-11-24T00:00:00Z',data:[1,2].map(i=>({
    itemId:'scp-series-00'+i,pageType:'scp-series',contentType:'scp',titleJP:'Title '+i,
    urlJP:'https://scp-wiki.wikidot.com/scp-00'+i,isTranslatedJP:true,
  }))}],new Map());
  board.overview.types=['references','experiment'];
  board.edges=[[0,1,0,0,[0]],[1,0,1,0,[0]]];
  board.proofs=[['https://scp-wiki.wikidot.com/scp-001','quote','article_body','a'.repeat(64),'','','2026-11-24']];
  board.pageImages={'https://scp-wiki.wikidot.com/scp-001':'https://example.com/photo.jpg'};
  return board;
}
test('runtime preserves pages, primary selection, aliases, images and directed references only',()=>{
  const board=fixture(),runtime=runtimeBoard(board);
  assert.equal(runtime.schemaVersion,4);
  assert.deepEqual(runtime.edges,[[0,1]]);
  assert.equal(runtime.overview.edgeCount,1);
  for(const key of ['proofs','workIdentityProofs','identityReview','pageImages'])assert(!(key in runtime));
  for(const key of ['points','tiles','types','trunks','branchLinks','aggregateLinks','bodyLinkCoverage'])assert(!(key in runtime.overview));
  for(const n of board.nodes){
    const r=runtime.nodes[n[0]],primary=r[6][r[8]];
    assert.deepEqual(r.slice(0,4),n.slice(0,4));
    assert.equal(r[4],n[8]);assert.equal(r[5],n[12]);
    assert.deepEqual(r[7],n[14][2]);
    assert.equal(primary[1],n[6]);assert.equal(primary[2],n[4]);assert.equal(primary[3],n[5]);
    assert.deepEqual(r[6].map(p=>p.slice(0,4)),n[13].map(p=>p.slice(0,4)));
  }
  assert.equal(runtime.nodes[0][6][0][4],'https://example.com/photo.jpg');
  assert.equal(runtime.nodes[1].length,9);
  board.nodes[0][14][1]='otherwise-unrepresented-id';
  assert.equal(runtimeBoard(board).nodes[0][9],'otherwise-unrepresented-id');
});
test('changing audit evidence does not change the runtime revision or bytes',()=>{
  const board=fixture(),before=runtimeBoard(board);
  board.proofs[0][3]='b'.repeat(64);board.proofs[0][6]='2026-11-25';
  board.overview.generatedAt='2026-11-25T00:00:00Z';
  board.identityReview=[{reason:'publisher-only review'}];board.workIdentityProofs=[{method:'publisher-only proof'}];
  assert.deepEqual(runtimeBoard(board),before);
});
test('retired-page-only references are omitted before proof records are stripped',()=>{
  const board=fixture();
  const retired=board.proofs[0][0];
  board.hiddenRetiredPageUrls=[retired];board.hiddenRetiredNodeIds=[];
  assert.deepEqual(runtimeBoard(board).edges,[]);
  const live='https://scp-jp.wikidot.com/scp-001';
  board.nodes[0][13].push(['jp',live,'scp-001','Japanese title','fetched']);
  board.proofs.push([live,'quote','article_body','b'.repeat(64),'','','2026-11-24']);
  board.edges[0][4].push(1);
  const runtime=runtimeBoard(board);
  assert.deepEqual(runtime.edges,[[0,1]]);
  assert.deepEqual(runtime.hiddenRetiredPageUrls,[retired]);
  assert(!('proofs' in runtime));
});
test('publisher retains a revision-paired audit outside the downloadable payload',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'runtime-board-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const input=path.join(root,'local-data');fs.mkdirSync(input);
  const board=fixture(),manifest=writeDelivery(board,input,path.join(input,'mobile-v3'));
  assert.deepEqual(loadAudit(input),board);
  const runtime=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(input,'mobile-v3/research-board',manifest.fileName))));
  assert.deepEqual(runtime,runtimeBoard(board));
  assert.deepEqual(fs.readdirSync(path.join(input,'mobile-v3/research-board')).sort(),[manifest.fileName,'manifest.json'].sort());
  const audit=path.join(input,'research-board-audit.json.gz');
  fs.writeFileSync(audit,zlib.gzipSync(JSON.stringify({runtimeRevision:'invalid',board})));
  assert.throws(()=>loadAudit(input),/revision mismatch/);
});
