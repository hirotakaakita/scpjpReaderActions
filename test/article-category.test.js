'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { articleCategory } = require('../article-category');
test('article tags outrank broad official index membership', () => {
  for (const [tag, category] of [['tale','tale'],['goi-format','goi'],['実験記録','record'],['施設','setting'],['hub','hub']]) {
    assert.equal(articleCategory({ tags:[tag] }, [{ kind:'canon',source:'https://example.com/canon-hub' }]), category);
  }
});
test('canon members do not become hubs without evidence', () => {
  const source='https://example.com/canon-hub', evidence=[{kind:'canon',source}];
  assert.equal(articleCategory({},evidence,source),'hub');
  assert.equal(articleCategory({},evidence,'https://example.com/unknown-work'),'other');
});
test('specific official listings provide fallback categories', () => {
  for (const [kind,category] of [['goi-format','goi'],['record','record'],['setting','setting'],['tale','tale']]) {
    assert.equal(articleCategory({},[{kind}]),category);
  }
  assert.equal(articleCategory({},[],'https://example.com/experiment-log-t-98816-oc108-682'),'record');
});
