'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const {extractArticleImage}=require('../article-images');
const base='https://scp-wiki.wikidot.com/scp-001';
function extract(body){const d=new JSDOM('<div id="page-content">'+body+'</div>');try{return extractArticleImage(d.window.document,base);}finally{d.window.close();}}
test('all Flutter raster extensions are case-insensitive, including BMP and WBMP',()=>{
 for(const extension of ['jpg','JPEG','PNG','GiF','WEBP','BMP','WbMp'])assert.equal(extract('<img src="/files/photo.'+extension+'?v=2">'),'https://scp-wiki.wikidot.com/files/photo.'+extension+'?v=2');
});
test('extensionless and dynamic image URLs remain valid when explicitly declared as images',()=>{
 for(const url of ['https://cdn.example/image/123','https://cdn.example/render.php?id=1&format=png','https://cdn.example/photo.jpg/revision/latest'])assert.equal(extract('<img src="'+url+'">'),url);
 assert.equal(extract('<img src="../photo%2EPNG">'),'https://scp-wiki.wikidot.com/photo%2EPNG');
});
test('lazy attributes, srcset and picture fallback images are extracted',()=>{
 assert.equal(extract('<img src="data:image/gif;base64,R0lGODlh" data-src="/actual.PNG">'),'https://scp-wiki.wikidot.com/actual.PNG');
 assert.equal(extract('<img data-original="/actual.bmp">'),'https://scp-wiki.wikidot.com/actual.bmp');
 assert.equal(extract('<img data-lazy-src="/actual.webp">'),'https://scp-wiki.wikidot.com/actual.webp');
 assert.equal(extract('<img srcset="/wide.webp 2x, /small.webp 1x">'),'https://scp-wiki.wikidot.com/wide.webp');
 assert.equal(extract('<picture><source type="image/avif" srcset="/unsupported.avif"><source type="image/webp" srcset="/actual.WEBP"><img></picture>'),'https://scp-wiki.wikidot.com/actual.WEBP');
});
test('unsupported vectors, avatars, decorative images and non-HTTP sources do not become thumbnails',()=>{
 assert.equal(extract('<img src="/figure.svg"><img src="/figure.avif"><img src="javascript:alert(1)"><img src="file:///tmp/photo.png"><img src="//user:pass@cdn.example/a.png"><img src="/avatar.php?id=1">'),null);
 assert.equal(extract('<div role="navigation"><img src="/navigation.jpg"></div><img src="/nav/help.png"><img src="/proper.WBMP">'),'https://scp-wiki.wikidot.com/proper.WBMP');
 assert.equal(extract('<img srcset="data:image/png;base64,AAAA 1x">'),null);
});
