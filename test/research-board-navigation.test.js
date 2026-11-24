'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {makeRecord, extractFtml} = require('../research-board/extract');
const {buildBoard} = require('../research-board/catalog');
const base = 'https://scp-wiki.wikidot.com/';
const stamp = '2026-11-17T00:00:00Z';
const html = body => '<title>SCP-3113</title><div id="page-content"><p>' +
  'Narrative article content. '.repeat(10) + '</p>' + body + '</div>';
const extract = body => makeRecord(base + 'scp-3113', html(body), 'html', stamp);

test('classless HTML previous/current/next controls are excluded at any article position', () => {
  for (const [left, right] of [['≪','≫'],['«','»'],['<<','>>'],['〈','〉'],['←','→']]) {
    const nav = `<div style="text-align:center"><p><strong>${left} <a href="/scp-3112">SCP-3112</a> | SCP-3113 | <a href="/scp-3114">SCP-3114</a> ${right}</strong></p></div>`;
    const r = extract(nav + '<p>Actual reference: <a href="/scp-682">SCP-682</a>.</p><p>Credits follow navigation.</p>');
    assert.deepEqual(r.links.map(l => l.target), [base + 'scp-682']);
  }
});

test('navigation does not erase a real reference to an adjacent SCP elsewhere in the body', () => {
  const r = extract('<p>Experiment with <a href="/scp-3112">SCP-3112</a> and <a href="/scp-3114">SCP-3114</a> caused a breach.</p>' +
    '<p>≪ <a href="/scp-3112">SCP-3112</a> | <a href="/scp-3113">SCP-3113</a> | <a href="/scp-3114">SCP-3114</a> ≫</p>');
  assert.deepEqual(r.links.map(l => l.target), [base + 'scp-3112', base + 'scp-3114']);
  assert.equal(r.links[0].quote, 'SCP-3112');
});

test('unbracketed numbered triplets and generic story chapter controls are navigation', () => {
  const r = extract('<p><a href="/scp-3112">SCP-3112</a> | SCP-3113 | <a href="/scp-3114">SCP-3114</a></p>' +
    '<table><tr><td>« <a href="/scp-3112">3112</a></td><td> | SCP-3113 | </td><td><a href="/scp-3114">3114</a> »</td></tr></table>' +
    '<div>« <a href="/first-chapter">First chapter</a> | Current chapter | <a href="/last-chapter">Last chapter</a> »</div>' +
    '<p><a rel="prev" href="/previous-story">Previous story</a></p>');
  assert.deepEqual(r.links, []);
});

test('lists, comparisons, and narrative in a centered block remain references', () => {
  const r = extract('<div style="text-align:center">See <a href="/scp-3112">SCP-3112</a> and <a href="/scp-3114">SCP-3114</a> for the experiment.</div>' +
    '<p><a href="/alpha">Alpha</a> | different concept | <a href="/beta">Beta</a></p>');
  assert.deepEqual(r.links.map(l => l.target), [base + 'alpha', base + 'beta', base + 'scp-3112', base + 'scp-3114']);
});

test('plain story navigation may use the current page title instead of its URL slug', () => {
  const r = makeRecord(base + 'second-chapter',
    html('<p><a href="/first-chapter">First</a> | The second chapter | <a href="/third-chapter">Third</a></p>')
      .replace('<title>SCP-3113</title>', '<title>The second chapter</title>'), 'html', stamp);
  assert.deepEqual(r.links, []);
});

test('FTML chapter controls without navigation classes are excluded while body references survive', () => {
  const r = extractFtml({title: 'RU', source:
    '[[=]]\n**≪ [[[scp-3112|SCP-3112]]] | SCP-3113 | [[[scp-3114|SCP-3114]]] ≫**\n[[/=]]\n' +
    'Experiment: [[[scp-3112|real reference]]].\n' +
    '« [[[previous-tale|Previous tale]]] | Current chapter | [[[next-tale|Next tale]]] »\n' +
    'Credits follow.\n' +
    '[[=]]See [[[scp-682|682]]] and [[[scp-173|173]]] for details.[[/=]]'}, 'https://scpfoundation.net/scp-3113');
  assert.deepEqual(r.links.map(l => l.target), ['https://scpfoundation.net/scp-173', 'https://scpfoundation.net/scp-3112', 'https://scpfoundation.net/scp-682']);
});

test('SCP-3113 style single-line centered FTML navigation is excluded', () => {
  const r = extractFtml({title:'SCP-3113',source:
    'Body text.\n\n= [[size 90%]]**<< [[[SCP-3112]]] | SCP-3113 | [[[SCP-3114]]] >>**[[/size]]'},
    'https://scpfoundation.net/scp-3113');
  assert.deepEqual(r.links, []);
  const narrative = extractFtml({title:'SCP-3113',source:
    'Experiment: [[[SCP-3112|genuine reference]]].\n\n' +
    '= [[size 90%]]**<< [[[SCP-3112]]] | SCP-3113 | [[[SCP-3114]]] >>**[[/size]]'},
    'https://scpfoundation.net/scp-3113');
  assert.deepEqual(narrative.links.map(link=>link.target),['https://scpfoundation.net/scp-3112']);
});

test('navigation-only links do not become board connections or evidence', () => {
  const record = extract('<p>≪ <a href="/scp-3112">3112</a> | SCP-3113 | <a href="/scp-3114">3114</a> ≫</p>' +
    '<p>Test: <a href="/scp-682">SCP-682</a>.</p>');
  const rows = ['3112', '3113', '3114', '682'].map(id => ({itemId:'scp-series-' + id,
    pageType:'scp-series', contentType:'scp', urlJP:base + 'scp-' + id, isTranslatedJP:true}));
  const board = buildBoard([{language:'en', timestamp:stamp, totalCount:rows.length, data:rows}],
    new Map([[record.pageId, {record, lastAttempt:{status:'success', at:stamp}}]]));
  assert.equal(board.edges.length, 1);
  assert.equal(board.nodes[board.edges[0][1]][4], 'scp-682');
  assert.equal(board.proofs.length, 1);
});
