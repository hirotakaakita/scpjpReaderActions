const { test } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { LocalSCPCrawler } = require('../local-crawler');

function fixture(t) {
  for (const key of ['FORCE_REFRESH_SCP_DETAILS', 'FORCE_REFRESH_TAGS']) {
    const original = process.env[key];
    delete process.env[key];
    t.after(() => {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    });
  }
  const crawler = new LocalSCPCrawler('jp');
  crawler.startTime = new Date();
  crawler.totalUrls = 1;
  crawler.entryDelayMs = 0;
  crawler.waitForArticleRequestSlot = async () => {};
  crawler.displayProgress = () => {};
  const listingUrl = `${crawler.baseUrl}/scp-series`;
  let html = '<div id="page-content"><p>Article</p></div><div class="page-tags"><a>humanoid</a></div>';
  let failure = false;
  let requests = 0;
  t.mock.method(axios, 'get', async url => {
    if (url === listingUrl) return { status: 200,
      data: '<ul><li><a href="/scp-002">SCP-002</a> - Test article</li></ul>' };
    requests++;
    if (failure) throw new Error('Simulated article timeout');
    return { status: 200, data: html };
  });
  const extractDetails = crawler.extractScpDetailsFromPage.bind(crawler);
  // Most cases exercise the full catalog path with a single failed attempt.
  crawler.extractScpDetailsFromPage = url => extractDetails(url, 1);
  const crawl = async existing => {
    const rows = await crawler.extractScpDataFromUrl(listingUrl,
      new Map(existing ? [[existing.itemId, existing]] : []), 1);
    assert.equal(rows.length, 1);
    return rows[0];
  };
  return { crawler, extractDetails, crawl, setFailure: value => { failure = value; },
    setHtml: value => { html = value; }, requests: () => requests };
}

test('exhausted retries report failure without a current tag version', async t => {
  const f = fixture(t); f.setFailure(true);
  const result = await f.extractDetails('https://example.invalid/scp-002', 2);
  assert.equal(f.requests(), 2);
  assert.equal(result.fetchSucceeded, false);
  assert.equal(result.tagVersion, null);
});

test('old tags and version survive failure and refresh on the next crawl', async t => {
  const f = fixture(t);
  const original = await f.crawl();
  const old = { ...original, tags: ['old-tag'], tagVersion: original.tagVersion - 1 };
  f.setFailure(true);
  const failed = await f.crawl(old);
  assert.deepEqual(failed.tags, ['old-tag']);
  assert.equal(failed.tagVersion, old.tagVersion);
  assert.equal(failed.tagFetchStatus, 'failed');
  f.setFailure(false);
  const recovered = await f.crawl(failed);
  assert.deepEqual(recovered.tags, ['humanoid']);
  assert.equal(recovered.tagVersion, original.tagVersion);
  assert.equal(recovered.tagFetchStatus, 'success');
});

test('new article failure stays pending; a successful empty tag list is valid', async t => {
  const f = fixture(t); f.setFailure(true);
  const failed = await f.crawl();
  assert.deepEqual(failed.tags, []);
  assert.equal(failed.tagVersion, null);
  assert.equal(failed.tagFetchStatus, 'failed');
  f.setFailure(false);
  f.setHtml('<div id="page-content"><p>Article with no tags</p></div>');
  const empty = await f.crawl(failed);
  assert.deepEqual(empty.tags, []);
  assert.equal(typeof empty.tagVersion, 'number');
  assert.equal(empty.tagFetchStatus, 'success');
  f.setFailure(true);
  const cached = await f.crawl(empty);
  assert.equal(cached.tagFetchStatus, 'success');
  assert.equal(cached.tagVersion, empty.tagVersion);
});

test('failed forced refresh at current version retries without the force flag', async t => {
  const f = fixture(t);
  const original = await f.crawl();
  process.env.FORCE_REFRESH_TAGS = '1';
  f.setFailure(true);
  const failed = await f.crawl(original);
  assert.deepEqual(failed.tags, original.tags);
  assert.equal(failed.tagVersion, original.tagVersion);
  assert.equal(failed.tagFetchStatus, 'failed');
  delete process.env.FORCE_REFRESH_TAGS;
  f.setFailure(false);
  f.setHtml('<div class="page-tags"><a>new-tag</a></div>');
  const recovered = await f.crawl(failed);
  assert.deepEqual(recovered.tags, ['new-tag']);
  assert.equal(recovered.tagFetchStatus, 'success');
});

test('legacy empty tags at current version are fetched again to repair poisoned cache', async t => {
  const f = fixture(t);
  const original = await f.crawl();
  const legacy = { ...original, tags: [] };
  delete legacy.tagFetchStatus;
  f.setFailure(true);
  const failed = await f.crawl(legacy);
  assert.equal(failed.tagVersion, original.tagVersion);
  assert.equal(failed.tagFetchStatus, 'failed');
  f.setFailure(false);
  const recovered = await f.crawl(failed);
  assert.deepEqual(recovered.tags, ['humanoid']);
  assert.equal(recovered.tagFetchStatus, 'success');
});
