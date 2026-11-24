'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {extractOriginalSources,extractAuthorCredits}=require('../origin-provenance');
const user=id=>`<a href="https://www.wikidot.com/user:info/${id}">${id}</a>`;

test('license-box image creators are asset authors, not authors of the article',()=>{
 const dom=new JSDOM(`<div class="licensebox"><p>Author: ${user('writer')}</p><blockquote><p><strong>Filename:</strong> Logo<br><strong>Author:</strong> ${user('artist')}<br>License: CC BY-SA</p></blockquote></div>`);
 const r=extractAuthorCredits(dom.window.document);assert.equal(r.authorCreditVersion,2);
 assert.deepEqual(r.originalAuthors.map(a=>a.id),['writer']);assert.deepEqual(r.assetAuthors.map(a=>a.id),['artist']);dom.window.close();
});

test('an article creator who also provided an image remains an original author',()=>{
 const dom=new JSDOM(`<div class="licensebox"><p>Author: ${user('writer')}</p><p>Filename: sketch<br>Author: ${user('writer')}</p></div>`);
 const r=extractAuthorCredits(dom.window.document);assert.deepEqual(r.originalAuthors.map(a=>a.id),['writer']);assert.deepEqual(r.assetAuthors.map(a=>a.id),['writer']);dom.window.close();
});
test('credit author and translator roles exclude illustration and unlabelled contributors',()=>{
 const dom=new JSDOM(`<div class="credit"><p><strong>著者:</strong> ${user('author-a')} ${user('author-b')}<br>
 <strong>翻訳責任者:</strong> ${user('translator')}<br>画像: ${user('artist')}</p></div>
 <div id="page-content">作者: ${user('body-speaker')}</div>`);
 const r=extractAuthorCredits(dom.window.document);assert.deepEqual(r.originalAuthors.map(a=>a.id),['author-a','author-b']);
 assert.deepEqual(r.translators.map(a=>a.id),['translator']);dom.window.close();
});
test('Chinese original author and translator labels are separated, not inferred from every credited user',()=>{
 const dom=new JSDOM(`<div class="licensebox"><p>原作者：${user('original')}<br>译者：${user('translator')}</p><p>图片修改：${user('image-editor')}</p></div>`);
 const r=extractAuthorCredits(dom.window.document);assert.deepEqual(r.originalAuthors.map(a=>a.id),['original']);assert.deepEqual(r.translators.map(a=>a.id),['translator']);dom.window.close();
});
test('an explicitly named original anchor and JP original-article label resolve legacy CN publisher URLs',()=>{
 const dom=new JSDOM('<div class="credit"><p><a href="https://scp-wiki.wikidot.com/story">原文</a></p><p><strong>元記事:</strong> <a href="http://www.scp-wiki-cn.org/orgdoc:sacrifice">link</a></p><p><a href="https://scp-wiki.wikidot.com/another">Related article</a></p></div>');
 const r=extractOriginalSources(dom.window.document,'https://scp-jp.wikidot.com/translated');
 assert.deepEqual(r.map(s=>s.url),['https://scp-wiki-cn.wikidot.com/orgdoc:sacrifice','https://scp-wiki.wikidot.com/story']);dom.window.close();
});
test('JP original-link and copyright labels and plain Chinese original URLs are metadata',()=>{
 const dom=new JSDOM(`<div class="credit"><p>元記事リンク: <a href="https://scp-wiki-cn.wikidot.com/story">link</a><br>著作権者: ${user('creator')}</p><p>原文地址： [http://scp-wiki-de.wikidot.com/another]</p></div>`);
 assert.equal(extractOriginalSources(dom.window.document,'https://scp-jp.wikidot.com/translation').length,2);
 assert.deepEqual(extractAuthorCredits(dom.window.document).originalAuthors.map(a=>a.id),['creator']);dom.window.close();
});
test('a derivative work creator is distinguished from the upstream SCP creator',()=>{
 const dom=new JSDOM(`<div class="credit"><p>衍生作品作者: ${user('story-creator')}<br>原作者: ${user('upstream-creator')}</p></div>`);
 const r=extractAuthorCredits(dom.window.document);assert.deepEqual(r.originalAuthors.map(a=>a.id),['story-creator']);assert.deepEqual(r.upstreamAuthors.map(a=>a.id),['upstream-creator']);dom.window.close();
});
