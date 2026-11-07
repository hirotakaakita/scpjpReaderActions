'use strict';

// Only explicit absence is terminal. Rate limits, TLS and bot challenges must
// never erase a previously usable article.
function inspectArticlePage(document, status = 200) {
  if ([404, 410].includes(status)) return { usable: false, terminal: true, reason: 'not_found' };
  if (status < 200 || status >= 300) return { usable: false, terminal: false, reason: `http_${status}` };
  const title = (document.querySelector('#page-title')?.textContent || document.title || '').trim();
  if (/^(?:access denied|security check|just a moment|verify you are human)/i.test(title) ||
      document.querySelector('#anubis_challenge,.cf-challenge,form#challenge-form')) {
    return { usable: false, terminal: false, reason: 'challenge' };
  }
  const root = document.querySelector('#page-content');
  if (!root) return { usable: false, terminal: false, reason: 'unknown_structure' };
  const intro = root.textContent.trim().replace(/\s+/g, ' ').slice(0, 240);
  const missing = /^(?:page not found|page does not exist|the page .{0,100}does not exist|¡?esta página no existe|esta p[áa]gina (?:a[úu]n|todav[íi]a) no existe|このページは(?:まだ)?存在しません|該当するページは存在しません|此页面不存在|這個頁面不存在|страница не (?:найдена|существует))/i;
  if (missing.test(title) || missing.test(intro) || root.querySelector('.page-not-found,#no-page-content') ||
      root.querySelector('a[href*="/system:page-create"]')) {
    return { usable: false, terminal: true, reason: 'not_found' };
  }
  const copy = root.cloneNode(true);
  for (const n of copy.querySelectorAll('script,style,noscript,.page-tags,.licensebox,.credit,.credit-box,#u-credit-view,.page-rate-widget-box,.footer-wikiwalk-nav,.page-navigation')) n.remove();
  if (!copy.textContent.trim() && !copy.querySelector('img,svg,canvas,video,audio,iframe,object,embed')) {
    return { usable: false, terminal: true, reason: 'empty_body' };
  }
  return { usable: true, terminal: false, reason: 'article' };
}

module.exports = { inspectArticlePage };
