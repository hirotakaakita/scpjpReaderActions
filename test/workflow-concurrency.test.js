const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '../.github/workflows', name), 'utf8').replace(/\r/g, '');

test('catalog refresh runs Friday and notification polling covers Saturday evening in every timezone', () => {
  assert.match(read('scp-crawler.yml'), /cron: '0 0 \* \* 5'/);
  assert.match(read('scheduled-notifications.yml'), /cron: '2-57\/5 \* \* \* 6,0'/);
});
function job(workflow, name) {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `Missing job ${name}`);
  return workflow.slice(start + 1).split(/\n  [\w-]+:\n/)[0];
}
function concurrency(block) {
  const match = block.match(/(?:^|\n)( *)concurrency:\n((?:\1 +[^\n]*\n)+)/);
  assert.ok(match, 'Missing concurrency settings');
  return Object.fromEntries([...match[2].matchAll(/ +([\w-]+): ([^\n]+)/g)].map(m => [m[1], m[2]]));
}

test('resuming a crawl preserves incoming articles through retrieval and publication', () => {
  const workflow = read('scp-crawler.yml');
  const crawl = job(workflow, 'crawl');
  const refresh = job(workflow, 'refresh-article-text');
  const publisher = job(workflow, 'merge-and-deploy');
  assert.match(crawl, /run-id: \$\{\{ inputs.resume_crawl_run \}\}/);
  assert.match(crawl, /name: partial-\$\{\{ matrix.lang \}\}\n +path: partial-data/);
  assert.match(crawl, /if: always\(\) && \(inputs.repair_excerpts_only != true \|\| inputs.resume_crawl_run != ''\)/);
  assert.match(refresh, /name: Download current language crawl data\n +if: inputs.repair_excerpts_only != true \|\| inputs.resume_crawl_run != ''/);
  for (const step of ['Download all partial data', 'Merge partial data into local-data', 'Prepare notification queue']) {
    assert.ok(publisher.includes(`name: ${step}\n        if: inputs.repair_excerpts_only != true || inputs.resume_crawl_run != ''`), step);
  }
  assert.match(refresh, /name: article-text-\$\{\{ matrix.lang \}\}\n +path: excerpt-previous\/excerpt-repairs/);
});

test('long crawls never hold the notification write lock', () => {
  const crawler = read('scp-crawler.yml');
  const notification = read('scheduled-notifications.yml');
  const crawlLock = concurrency(crawler.split('\njobs:')[0]);
  const publishLock = concurrency(job(crawler, 'merge-and-deploy'));
  const sendLock = concurrency(job(notification, 'send'));
  assert.notEqual(crawlLock.group, sendLock.group);
  assert.equal(publishLock.group, sendLock.group);
  const publisherReadLock=concurrency(job(crawler,'crawl'));
  assert.notEqual(publisherReadLock.group,sendLock.group);
  assert.equal(publisherReadLock.group,'scp-publisher-${{ matrix.host }}');
  assert.equal(concurrency(job(crawler,'refresh-article-text')).group,publisherReadLock.group);
  assert.doesNotMatch(notification.split('\njobs:')[0], /concurrency:/);
  for (const lock of [crawlLock, publishLock, sendLock, publisherReadLock]) {
    assert.equal(lock['cancel-in-progress'], 'false');
    assert.equal(lock.queue, 'max');
  }
});

test('body-link completion shares the crawl lock, groups hosts, publishes without notifications and continues checkpoints',()=>{
  const workflow=read('research-board-body-links.yml'),normal=read('scp-crawler.yml');
  assert.equal(concurrency(workflow.split('\njobs:')[0]).group,concurrency(normal.split('\njobs:')[0]).group);
  const collect=job(workflow,'collect'),publish=job(workflow,'publish');
  assert.match(collect,/max-parallel: 3/);
  assert.match(collect,/BOARD_LINK_MAX_REQUESTS: '0'/);
  assert.match(collect,/BOARD_LINK_MAX_DURATION_MS: '0'/);
  assert.match(collect,/CRAWL_REQUEST_INTERVAL_MS: '1000'/);
  assert.match(collect,/if: always\(\)/);
  assert.equal(concurrency(publish).group,'scp-data-update');
  assert.match(publish,/generateResearchBoard/);
  assert.match(publish,/research-board\/validate.js/);
  assert.match(publish,/r.stopReason==='checkpoint'/);
  assert.match(publish,/gh workflow run research-board-body-links.yml/);
  assert.doesNotMatch(publish,/prepare-notification-queue|send-notifications|send-staging/);
});

test('writers load current master after acquiring the lock and never force conflict resolution', () => {
  const publisher = job(read('scp-crawler.yml'), 'merge-and-deploy');
  const sender = job(read('scheduled-notifications.yml'), 'send');
  for (const writer of [publisher, sender]) {
    assert.match(writer, /uses: actions\/checkout@v\d+\n +with:\n +ref: master/);
    assert.match(writer, /timeout-minutes: \d+/);
    assert.doesNotMatch(writer, /git pull|--force|--rebase|-X theirs/);
  }
  assert.ok(publisher.indexOf('ref: master') < publisher.indexOf('node prepare-notification-queue.js'));
});


test('full text retrieval has its own time budget and preserves current-run crawl captures', () => {
  const workflow = read('scp-crawler.yml');
  const crawl = job(workflow, 'crawl');
  const refresh = job(workflow, 'refresh-article-text');
  const publish = job(workflow, 'merge-and-deploy');
  assert.doesNotMatch(crawl, /run: node tool\/refresh-article-text/);
  assert.match(refresh, /needs: \[setup, crawl\]/);
  assert.match(refresh, /timeout-minutes: 360/);
  assert.match(refresh, /name: partial-\$\{\{ matrix.lang \}\}\n +path: partial-data/);
  assert.match(refresh, /run: node tool\/refresh-article-text.js/);
  assert.match(refresh, /CRAWL_REQUEST_INTERVAL_MS: '500'/);
  assert.match(refresh, /if: always\(\)\n +uses: actions\/upload-artifact/);
  assert.match(refresh, /name: article-text-\$\{\{ matrix.lang \}\}\n +path: partial-data\/excerpt-repairs\//);
  assert.match(publish, /needs: \[setup, crawl, refresh-article-text\]/);
  assert.match(publish, /needs.refresh-article-text.result == 'success'/);
  assert.match(publish, /pattern: article-text-\*\n +path: partial-data\/excerpt-repairs/);
  assert.ok(publish.indexOf('pattern: article-text-*') < publish.indexOf('node tool/apply-excerpt-repairs.js'));
});
