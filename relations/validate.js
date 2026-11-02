'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {fileHash,lines}=require('./jsonl');
const { digest, normalizePage } = require('./core');
function validate(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  function checkedFile(descriptor){
    const file=path.resolve(dir,descriptor.path);
    assert(file.startsWith(path.resolve(dir)+path.sep),'Graph file escaped output directory');
    assert.equal(fileHash(file),descriptor.sha256,`Checksum mismatch: ${descriptor.path}`);return file;
  }
  function read(descriptor){return fs.readFileSync(checkedFile(descriptor),'utf8');}
  const nodes=[...lines(checkedFile(manifest.files.nodes))].map(l=>JSON.parse(l));
  const edges=lines(checkedFile(manifest.files.edges));let edgeCount=0;
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  assert.equal(nodeMap.size, nodes.length, 'Duplicate nodes');
  const seen = new Set();
  for (const line of edges) {
    const edge=JSON.parse(line);edgeCount++;
    assert(nodeMap.has(edge.source) && nodeMap.has(edge.target), 'Dangling endpoint');
    assert.notEqual(edge.source, edge.target, 'Self reference');
    assert(!seen.has(edge.id), 'Duplicate edge'); seen.add(edge.id);
    assert(manifest.edgeTypes[edge.type], 'Unknown relation type');
    assert(edge.evidence.length > 0, 'Unproven edge');
    for (const proof of edge.evidence) {
      const proofSource=normalizePage(proof.sourceUrl)?.id;
      if (['references','has_tag','translation_assertion'].includes(edge.type)) assert.equal(proofSource, edge.source, 'Wrong source evidence');
      assert(nodeMap.has(proofSource), 'Missing evidence document');
      if (!['references','has_tag','translation_assertion'].includes(edge.type)) {
        assert(proof.quote && ['source_specific_exact_quote','explicit_canon_breadcrumb'].includes(proof.method), 'Semantic assertion requires exact source evidence');
      }
      assert.equal(proof.contentSha256, nodeMap.get(proofSource).contentSha256, 'Wrong source revision');
    }
  }
  assert.equal(nodes.length, manifest.counts.nodes);
  assert.equal(edgeCount, manifest.counts.edges);
  for (const [key, descriptor] of Object.entries(manifest.shards)) {
    const shard = JSON.parse(read(descriptor));
    assert.equal(shard.bucket, key);
    for (const root of shard.roots) assert.equal(digest(root.id).slice(0, 2), key);
  }
  return { nodes: nodes.length, edges: edgeCount, shards: Object.keys(manifest.shards).length };
}
if (require.main === module) console.log(validate(process.argv[2] || path.join(__dirname, 'output')));
module.exports = { validate };
