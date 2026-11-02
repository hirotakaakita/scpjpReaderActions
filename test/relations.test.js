const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizePage, extractHtml, extractFtml, makeRecord } = require('../relations/core');
const { buildGraph, publishGraph, catalogIndex, importRecords } = require('../relations/build');
const { validate } = require('../relations/validate');
const { renderPreview } = require('../relations/preview');
const { skillLayout } = require('../relations/skill-layout');
const { refreshPage } = require('../relations/refresh');
const { atomicJson, recordPath, readRecord } = require('../relations/store');
const URL = 'https://scp-wiki.wikidot.com/scp-682';
const NOW = '2026-10-28T00:00:00.000Z';
const html = body => `<html><title>SCP-682</title><div id="page-title">SCP-682</div><div id="page-content">${body}</div><div class="page-tags"><a>reptile</a></div></html>`;
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-relations-test-'));
  t.after(() => {
    assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const records = path.join(root, 'records');
  const catalogDir = path.join(root, 'catalogs');
  atomicJson(path.join(catalogDir, 'en', 'scp-data.json'), { timestamp: NOW, data: [
    { itemId: '682', urlJP: URL, urlEN: URL, titleJP: 'Hard to destroy', isTranslatedJP: true },
    { itemId: '053', urlJP: 'https://scp-wiki.wikidot.com/scp-053', isTranslatedJP: true },
  ] });
  const options = { catalogDir, recordDirs: [records], now: NOW };
  const save = body => {
    const record = makeRecord(URL, html(body), 'html', NOW, { etag: 'original' });
    atomicJson(recordPath(records, URL), { record, lastAttempt: { status: 'success', at: NOW } });
    return record;
  };
  return { root, records, catalogDir, options, save };
}
test('URL identity preserves 001 proposals, J/EX and branch distinctions', () => {
  assert.equal(normalizePage('http://www.scp-wiki.net/SCP-682/#foo').id, normalizePage(URL).id);
  const values = ['scp-001', 'dr-clef-s-proposal', 'scp-001-j', 'scp-001-ex', 'scp-001-jp', 'scp-cn-001'];
  assert.equal(new Set(values.map(s => normalizePage(`https://scp-jp.wikidot.com/${s}`).id)).size, values.length);
  for (const value of ['https://evil.test/scp-682', 'javascript:alert(1)', 'https://scp-wiki.wikidot.com.evil.test/scp-682',
    `${URL}?module=edit`, `${URL}/offset/10`, 'https://scp-wiki.wikidot.com/component:footer']) assert.equal(normalizePage(value), null);
});
test('only body references survive: no menus, previous/next, credit links or bare numbers', () => {
  const doc = html(`<p>SCP-173 is mentioned but not linked. <a href="/scp-053">Child</a></p>
    <a href="#footnote">note</a><a class="newpage" href="/scp-99999">missing</a>
    <div class="footer-wikiwalk-nav"><a href="/scp-681">Previous</a><a href="/scp-683">Next</a></div>
    <div class="licensebox"><a href="https://scp-jp.wikidot.com/scp-682">Credit</a></div>
    <div class="licensebox22"><a href="/licensing-master-list">License</a></div>
    <div id="u-author_block"><a href="/author-personnel-file">Author</a></div>
    <div class="footnotes-footer"><a href="/scp-079">Source</a></div>
    <iframe src="https://evil.test"></iframe>`) + '<div id="side-bar"><a href="/scp-173">Sidebar</a></div>';
  const value = extractHtml(doc, URL);
  assert.deepEqual(value.links.map(l => l.target).sort(), [
    'https://scp-wiki.wikidot.com/scp-053', 'https://scp-wiki.wikidot.com/scp-079' ]);
  assert.equal(value.links.find(l => l.target.endsWith('079')).location, 'footnote');
  assert.deepEqual(value.translations, []);
  assert.deepEqual(value.limitations, ['iframe_content_not_expanded']);
});
test('translation assertion requires explicit metadata; ordinary foreign link stays a reference', () => {
  const value = extractHtml(html('<a href="https://scp-jp.wikidot.com/scp-682">Related</a>') +
    '<link rel="alternate" hreflang="ja" href="https://scp-jp.wikidot.com/scp-682">', URL);
  assert.equal(value.links.length, 1);
  assert.equal(value.translations.length, 1);
});
test('RuFoundation source links are explicit; plain mentions and code are not references', () => {
  const value = extractFtml({ pageId: 'scp-682', title: 'Test', source:
    'SCP-173 [[[scp-053|Child]]] [[code]] [[[scp-999]]] [[/code]] [https://scp-wiki.wikidot.com/scp-079 source]\n= [[size 90%]]**<< [[[SCP-681]]] | SCP-682 | [[[SCP-683]]] >>**[[/size]]', tags: [] },
    'https://scpfoundation.net/scp-682');
  assert.deepEqual(value.links.map(l => l.target).sort(), ['https://scp-wiki.wikidot.com/scp-079', 'https://scpfoundation.net/scp-053']);
});
test('soft errors never become empty successful pages', () => {
  assert.throws(() => extractHtml('<html>security check</html>', URL));
  assert.throws(() => extractHtml('<div id="page-content"><div class="error-block">Denied</div></div>', URL));
});
test('guessed urlEN never merges a branch original into an English work', t => {
  const f = fixture(t);
  atomicJson(path.join(f.catalogDir, 'jp', 'scp-data.json'), { timestamp: NOW, data: [{
    itemId: 'jp-001', urlJP: 'http://scp-jp.wikidot.com/scp-001-jp',
    urlEN: 'https://scp-wiki.wikidot.com/scp-001-jp', isTranslatedJP: true,
  }] });
  const { pages } = catalogIndex(f.catalogDir);
  assert(pages.has('page:scp-jp.wikidot.com/scp-001-jp'));
  assert(!pages.has('page:scp-wiki.wikidot.com/scp-001-jp'));
});
test('graph preserves direction, provenance, distinct tag layer and unknown coverage', t => {
  const f = fixture(t); f.save('<a href="/scp-053">Child</a>');
  const graph = buildGraph(f.options);
  const reference = graph.edges.find(e => e.type === 'references');
  assert.equal(reference.source, normalizePage(URL).id);
  assert.equal(reference.target, normalizePage('https://scp-wiki.wikidot.com/scp-053').id);
  assert.equal(reference.evidence[0].sourceUrl, URL);
  assert.match(reference.evidence[0].contentSha256, /^[a-f0-9]{64}$/);
  assert.equal(graph.edges.filter(e => e.type === 'has_tag').length, 1);
  assert.equal(graph.manifest.counts.unfetched, 1);
  const revision = publishGraph(graph, path.join(f.root, 'output'));
  assert.equal(publishGraph(buildGraph(f.options), path.join(f.root, 'output')), revision);
  assert.equal(validate(path.join(f.root, 'output')).edges, 2);
});
test('failed refresh keeps old edges marked stale; 304 renews observation; removal replaces links', async t => {
  const f = fixture(t); f.save('<a href="/scp-053">Child</a>');
  await refreshPage(normalizePage(URL), f.records, async () => ({ status: 503 }), () => NOW);
  assert.equal(buildGraph(f.options).edges.find(e => e.type === 'references').stale, true);
  let conditional;
  await refreshPage(normalizePage(URL), f.records, async (_, headers) => {
    conditional = headers; return { status: 304 };
  }, () => NOW);
  assert.equal(conditional['If-None-Match'], 'original');
  assert.equal(buildGraph(f.options).edges.find(e => e.type === 'references').stale, false);
  await refreshPage(normalizePage(URL), f.records, async () => ({ status: 200, data: html('No links now'), headers: {} }), () => NOW);
  assert.equal(buildGraph(f.options).edges.filter(e => e.type === 'references').length, 0);
});
test('404 preserves audit evidence but deactivates previous edges', async t => {
  const f = fixture(t); f.save('<a href="/scp-053">Child</a>');
  await refreshPage(normalizePage(URL), f.records, async () => ({ status: 404 }), () => NOW);
  const graph = buildGraph(f.options);
  assert.equal(graph.manifest.counts.missing, 1);
  assert.equal(graph.edges.find(e => e.type === 'references').inactive, true);
  assert.equal(readRecord(f.records, URL).lastAttempt.httpStatus, 404);
});
test('soft failures retain last successful content hash and evidence', async t => {
  const f = fixture(t); const old = f.save('<a href="/scp-053">Child</a>');
  await refreshPage(normalizePage(URL), f.records, async () => ({ status: 200, data: '<html>blocked</html>' }), () => NOW);
  assert.equal(readRecord(f.records, URL).record.contentSha256, old.contentSha256);
  assert.equal(readRecord(f.records, URL).lastAttempt.status, 'fetch_or_parse_error');
});
test('new failure sidecar does not overwrite old success evidence during import', t => {
  const f = fixture(t); const old = f.save('<a href="/scp-053">Child</a>');
  const incoming = path.join(f.root, 'incoming');
  atomicJson(recordPath(incoming, URL), { url: URL, record: null,
    lastAttempt: { at: '2026-10-28T01:00:00.000Z', status: 'fetch_error' } });
  importRecords(incoming, f.records);
  const graph = buildGraph(f.options);
  assert.equal(graph.edges.find(e => e.type === 'references').stale, true);
  assert.equal(readRecord(f.records, URL).record.contentSha256, old.contentSha256);
});
test('parallel-language sidecars are merged by observation time, not overwrite order', t => {
  const f = fixture(t);
  const incoming = path.join(f.root, 'parallel');
  const early = makeRecord(URL, html('<a href="/scp-053">Child</a>'), 'html', NOW);
  const late = makeRecord(URL, html('<a href="/scp-079">Computer</a>'), 'html', '2026-10-28T02:00:00.000Z');
  atomicJson(recordPath(path.join(incoming, 'aa'), URL), { record: late, lastAttempt: { at: late.checkedAt, status: 'success' } });
  atomicJson(recordPath(path.join(incoming, 'zz'), URL), { record: early, lastAttempt: { at: early.checkedAt, status: 'success' } });
  importRecords(incoming, f.records);
  const graph = buildGraph(f.options);
  assert.equal(graph.edges.filter(e => e.type === 'references').length, 1);
  assert(graph.edges.find(e => e.type === 'references').target.endsWith('/scp-079'));
});
test('preview is interactive and untrusted titles cannot execute scripts', t => {
  const { JSDOM, VirtualConsole } = require('jsdom');
  const f = fixture(t); f.save('<a href="/scp-053">Child</a>');
  const graph = buildGraph(f.options);
  graph.nodes.find(n => n.id === normalizePage(URL).id).title = '</script><script>window.injected=true</script>';
  const file = path.join(f.root, 'preview.html');
  renderPreview(graph, file);
  const errors = [];
  const console = new VirtualConsole(); console.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM(fs.readFileSync(file, 'utf8'), { runScripts: 'dangerously', virtualConsole: console,
    pretendToBeVisual: true, beforeParse(window) {
      window.HTMLCanvasElement.prototype.getContext = () => null;
    } });
  t.after(() => dom.window.close());
  assert.equal(dom.window.injected, undefined);
  assert.equal(dom.window.document.querySelector('#board').dataset.nodeCount, '2');
  dom.window.document.querySelector('#search').value = 'scp-053';
  dom.window.document.querySelector('#find').click();
  assert.match(dom.window.document.querySelector('#selectedTitle').textContent, /SCP-053/);
  dom.window.document.querySelector('#markRead').click();
  assert.equal(dom.window.document.querySelector('#readCount').textContent, '1');
  dom.window.document.querySelector('#fit').click();
  assert.equal(dom.window.document.querySelector('#panel').hidden, true);
  assert.deepEqual(errors, []);
});
test('skill-tree layout preserves all real references without inventing prerequisites', t => {
  const f = fixture(t); f.save('<a href="/scp-053">Child</a>');
  const graph = buildGraph(f.options);
  const layout = skillLayout(graph);
  assert.equal(layout.nodes.length, 2);
  assert.equal(layout.links.length, 1);
  assert(layout.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y) && n.kind === 'page'));
  for (const link of layout.links) {
    for (const id of link.evidence) {
      const proof = graph.edges.find(e => e.id === id);
      assert.equal(proof.type, 'references');
      assert.deepEqual([proof.source, proof.target].sort(), [layout.nodes[link.a].id, layout.nodes[link.b].id].sort());
    }
  }
  assert.deepEqual(skillLayout(graph), layout);
});

test('semantic assertions require source-specific exact evidence, never a hyperlink alone',()=>{
 const {assertions,pageKind}=require('../relations/semantics');
 assert.equal(assertions(URL,'<a>SCP-079</a>').length,0);
 assert.equal(assertions(URL,'Dr. █████ attempts to use SCP-409 on SCP-682.')[0].type,'experiment');
 assert.equal(assertions(URL,'Dr. █████ proposes to use SCP-409 on SCP-682.').length,0);
 assert.equal(assertions('https://scp-wiki.wikidot.com/scp-409','Dr. █████ attempts to use SCP-409 on SCP-682.').length,0);
 assert.equal(pageKind({slug:'experiment-log-t-98816-oc108-682'}).type,'log');
 assert.equal(pageKind({slug:'scp-001'},{tags:['hub']}).type,'hub');
 assert.equal(pageKind({slug:'scp-682'}).type,'scp');
});
test('addendum reference retains section evidence and ends at the next heading',()=>{
 const result=extractHtml(html('<h2>補遺A</h2><p><a href="/scp-409">409</a></p><h2>Other</h2><p><a href="/scp-079">079</a></p>'),URL);
 assert.equal(result.links[0].section.kind,'addendum');
 assert.equal(result.links[0].section.title,'補遺A');
 assert.equal(result.links[1].section,undefined);
});

test('the same target in addendum and ordinary section retains both provenances',()=>{
 const result=extractHtml(html('<h2>Addendum A</h2><p><a href="/scp-173">A</a></p><h2>Description</h2><p><a href="/scp-173">B</a></p>'),URL);
 assert.equal(result.links.length,2);
 assert.equal(result.links[0].section.title,'Addendum A');
 assert.equal(result.links[1].section,undefined);
});

test('bold paragraph headings end the preceding addendum',()=>{
 const result=extractHtml(html('<p><strong>Addendum:</strong></p><p><a href="/scp-173">A</a></p><p><strong>Description:</strong></p><p><a href="/scp-174">B</a></p>'),URL);
 assert.equal(result.links[0].section.kind,'addendum');
 assert.equal(result.links[1].section,undefined);
});

test('canon membership requires explicit reviewed publisher hierarchy, not shared tags',()=>{
 const url='https://scp-wiki.wikidot.com/calm';
 assert.equal(extractHtml(html('<p>resurrection</p>'),url).semanticRelations.length,0);
 const value=extractHtml('<div id="breadcrumbs"><a href="/canon-hub">Canon Hub</a><a href="/resurrection">Resurrection</a></div>'+html('text'),url);
 assert.equal(value.semanticRelations[0].type,'canon_member');
 assert.equal(value.semanticRelations[0].target,'https://scp-wiki.wikidot.com/resurrection');
});
test('third-party hostility evidence and historical organization membership remain scoped',t=>{
 const f=fixture(t);
 for(const [slug,text] of [['follow-the-keter','SCP-076-2 breached containment and engaged in combat with SCP-682.'],['scp-105','SCP-105 was the second humanoid SCP recruited to Mobile Task Force Omega-7']]){
  const url='https://scp-wiki.wikidot.com/'+slug,record=makeRecord(url,html(text),'html',NOW);
  atomicJson(recordPath(f.records,url),{record,lastAttempt:{status:'success',at:NOW}});
 }
 const graph=buildGraph(f.options),hostile=graph.edges.find(e=>e.type==='hostile_to'),membership=graph.edges.find(e=>e.type==='member_of');
 assert.equal(hostile.source,normalizePage('https://scp-wiki.wikidot.com/scp-076').id);
 assert.equal(hostile.evidence[0].sourceUrl,'https://scp-wiki.wikidot.com/follow-the-keter');
 assert.match(membership.evidence[0].note,/過去の所属/);
 assert.equal(graph.nodes.find(n=>n.id===membership.target).kind,'entity');
 const dir=path.join(f.root,'publish');publishGraph(graph,dir);validate(dir);
 assert(skillLayout(graph).nodes.some(n=>n.id===membership.target));
});

test('one failed source cannot hide another fresh source for the same semantic relation',t=>{
 const f=fixture(t);
 for(const [slug,failed] of [['follow-the-keter',true],['another-account',false]]){
  const url='https://scp-wiki.wikidot.com/'+slug,record=makeRecord(url,html('evidence'),'html',NOW);
  record.semanticRelations=[{subject:'https://scp-wiki.wikidot.com/scp-076',target:URL,type:'hostile_to',quote:'evidence',method:'source_specific_exact_quote',location:'article_body'}];
  atomicJson(recordPath(f.records,url),{record,lastAttempt:{status:failed?'timeout':'success',at:NOW}});
 }
 const graph=buildGraph(f.options),edge=graph.edges.find(e=>e.type==='hostile_to');
 assert.equal(edge.evidence.length,2);assert.equal(edge.stale,false);assert.equal(edge.inactive,false);
 assert.equal(edge.evidence.filter(p=>p.stale).length,1);
 const dir=path.join(f.root,'output');publishGraph(graph,dir);validate(dir);
 const {digest}=require('../relations/core'),manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
 const shard=JSON.parse(fs.readFileSync(path.join(dir,manifest.shards[digest(edge.source).slice(0,2)].path)));
 const docs=new Set([...shard.roots,...shard.neighbors].map(n=>n.id));
 for(const proof of edge.evidence)assert(docs.has(normalizePage(proof.sourceUrl).id));
});

test('RuFoundation uses only public article API without touching HTML bot challenge',async()=>{
 const {accessPolicy}=require('../relations/refresh');
 const policy=await accessPolicy('scpfoundation.net',()=>{throw new Error('HTML endpoint must not be requested');});
 assert.equal(policy.isAllowed('https://scpfoundation.net/api/articles/scp-682'),true);
 for(const url of ['https://scpfoundation.net/scp-682','https://scpfoundation.net/robots.txt','https://scpfoundation.net/api/articles','https://evil.test/api/articles/scp-682','https://scpfoundation.net/api/articles/scp-682?edit=1'])assert.equal(policy.isAllowed(url),false);
 assert.equal(policy.getCrawlDelay(),0.5);
 const blocked=await accessPolicy('scp-wiki.wikidot.com',async()=>({status:200,data:'User-agent: *\nDisallow: /blocked'}));
 assert.equal(blocked.isAllowed('https://scp-wiki.wikidot.com/blocked','SCPReaderRelations'),false);
 await assert.rejects(()=>accessPolicy('scp-wiki.wikidot.com',async()=>({status:403,data:'challenge'})));
});

test('full scan waits through a network outage and resumes after connectivity returns',async()=>{
 const {waitForNetwork}=require('../relations/network');let attempts=0,waits=0,notices=0,clock=0;
 await waitForNetwork({probe:async()=>++attempts>=3,sleep:async ms=>{waits++;clock+=ms;},notify:()=>notices++,now:()=>clock});
 assert.equal(attempts,3);assert.equal(waits,2);assert.equal(notices,2);
 await assert.rejects(()=>waitForNetwork({probe:async()=>false,sleep:async ms=>clock+=ms,now:()=>clock,maxWaitMs:1}),/expired/);
});

test('API pool bounds concurrency, shares rate limit and retries rate-limited work',async()=>{
 const {apiQueue}=require('../relations/api-queue');let active=0,peak=0,clock=0;const starts=[],attempts=new Map(),waits=[];
 const result=await apiQueue([1,2,3,4,5],{now:()=>clock,sleep:async ms=>{waits.push(ms);clock+=ms;},fetchPage:async page=>{starts.push(clock);active++;peak=Math.max(peak,active);await new Promise(r=>setImmediate(r));active--;const n=(attempts.get(page)||0)+1;attempts.set(page,n);return page===1&&n===1?{status:'rate_limited',retryAfterMs:45000}:{status:'success'};}});
 assert(peak<=3);assert.equal(attempts.get(1),2);assert.equal(attempts.size,5);assert(result.intervalMs>=1000);assert(waits.some(w=>w>=44000));
 for(let i=1;i<starts.length;i++)assert(starts[i]-starts[i-1]>=500);
});

test('JSONL writer and reader preserve multibyte content and incremental content hashes',t=>{
 const f=fixture(t),{fileHash,lines,rowsHash,writeRows}=require('../relations/jsonl');
 const {digest}=require('../relations/core');
 const rows=Array.from({length:12000},(_,id)=>({id,title:'補遺の根拠🦎'.repeat(5)}));
 const expected=rows.map(x=>JSON.stringify(x)).join('\n')+'\n';
 const file=path.join(f.root,'rows.jsonl'),hash=rowsHash(rows);
 assert.equal(hash,digest(expected));writeRows(file,rows,hash);
 assert.equal(fileHash(file),hash);assert.deepEqual([...lines(file)].map(x=>JSON.parse(x)),rows);
 writeRows(file,rows,hash);fs.appendFileSync(file,'tamper');assert.throws(()=>writeRows(file,rows,hash),/Immutable/);
});
