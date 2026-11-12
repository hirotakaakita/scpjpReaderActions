// Keys are content branch codes (not Flutter UI locale codes).
const MESSAGES = {
  jp: { locale: 'ja', title: '新着SCPのお知らせ', summary: n => `新着記事：${n}件。` },
  en: { locale: 'en', title: 'New SCP articles', summary: n => `New articles: ${n}.` },
  ru: { locale: 'ru', title: 'Новые статьи SCP', summary: n => `Новых статей: ${n}.` },
  cn: { locale: 'zh-Hans', title: 'SCP新文章通知', summary: n => `新文章：${n}篇。` },
  cs: { locale: 'cs', title: 'Nové články SCP', summary: n => `Nové články: ${n}.` },
  de: { locale: 'de', title: 'Neue SCP-Artikel', summary: n => `Neue Artikel: ${n}.` },
  es: { locale: 'es', title: 'Nuevos artículos SCP', summary: n => `Artículos nuevos: ${n}.` },
  fr: { locale: 'fr', title: 'Nouveaux articles SCP', summary: n => `Nouveaux articles : ${n}.` },
  int: { locale: 'en', title: 'New SCP articles', summary: n => `New articles: ${n}.` },
  it: { locale: 'it', title: 'Nuovi articoli SCP', summary: n => `Nuovi articoli: ${n}.` },
  ko: { locale: 'ko', title: '새 SCP 문서', summary: n => `새 문서 ${n}개:` },
  pl: { locale: 'pl', title: 'Nowe artykuły SCP', summary: n => `Nowe artykuły: ${n}.` },
  pt: { locale: 'pt-BR', title: 'Novos artigos SCP', summary: n => `Novos artigos: ${n}.` },
  th: { locale: 'th', title: 'บทความ SCP ใหม่', summary: n => `บทความใหม่ ${n} บทความ:` },
  ua: { locale: 'uk', title: 'Нові статті SCP', summary: n => `Нових статей: ${n}.` },
  vn: { locale: 'vi', title: 'Bài viết SCP mới', summary: n => `Số bài viết mới: ${n}.` },
  'zh-tr': { locale: 'zh-Hant', title: 'SCP新文章通知', summary: n => `新增文章：${n}篇。` },
};

const additionalMessages = {
  ar: ['ar','مقالات SCP جديدة', n => `مقالات جديدة: ${n}.`],
  cy: ['cy','Erthyglau SCP newydd', n => `Erthyglau newydd: ${n}.`],
  da: ['da','Nye SCP-artikler', n => `Nye artikler: ${n}.`],
  el: ['el','Νέα άρθρα SCP', n => `Νέα άρθρα: ${n}.`],
  hu: ['hu','Új SCP-cikkek', n => `Új cikkek: ${n}.`],
  nl: ['nl','Nieuwe SCP-artikelen', n => `Nieuwe artikelen: ${n}.`],
  no: ['nb','Nye SCP-artikler', n => `Nye artikler: ${n}.`],
  ro: ['ro','Articole SCP noi', n => `Articole noi: ${n}.`],
  sh: ['hr','Novi SCP članci', n => `Novi članci: ${n}.`],
  sl: ['sl','Novi članki SCP', n => `Novi članki: ${n}.`],
  sv: ['sv','Nya SCP-artiklar', n => `Nya artiklar: ${n}.`],
  tr: ['tr','Yeni SCP makaleleri', n => `Yeni makaleler: ${n}.`],
};
for (const [code, [locale,title,summary]] of Object.entries(additionalMessages)) MESSAGES[code]={locale,title,summary};
for (const code of ['la','pig','sga','tok']) MESSAGES[code]={...MESSAGES.en};

// Same ID formatting as the existing weekly notification sender.
const DISPLAY_ID_PATTERNS = [
  [/^scp-([a-z][a-z-]*)-ex-(\d+(?:-.+)?)$/, m => `SCP-EX-${m[1].toUpperCase()}-${m[2].toUpperCase()}`],
  [/^scp-ex-(\d+(?:-.+)?)$/, m => `SCP-EX-${m[1].toUpperCase()}`],
  [/^joke-scps-([a-z][a-z-]*)-(\d+(?:-.+)?)$/, m => `JOKE-SCP-${m[1].toUpperCase()}-${m[2].toUpperCase()}`],
  [/^joke-scps-(\d+(?:-.+)?)$/, m => `JOKE-SCP-${m[1].toUpperCase()}`],
  [/^scp-series-([a-z][a-z-]*)-(\d+(?:-.+)?)$/, m => `SCP-${m[1].toUpperCase()}-${m[2].toUpperCase()}`],
  [/^scp-series-(\d+(?:-.+)?)$/, m => `SCP-${m[1].toUpperCase()}`],
];

function formatDisplayId(itemId) {
  for (const [pattern, formatter] of DISPLAY_ID_PATTERNS) {
    const match = itemId.match(pattern);
    if (match) return formatter(match);
  }
  return itemId.toUpperCase();
}

function buildNotification(language, items) {
  const message = Object.hasOwn(MESSAGES, language) ? MESSAGES[language] : MESSAGES.en;
  const segmenter = new Intl.Segmenter(message.locale, { granularity: 'grapheme' });
  const labels = items.slice(0, 2).map(item => {
    // Preserve combining characters and emoji when shortening article titles.
    const title = (item.titleJP || '').replace(/\s+/g, ' ').trim();
    const segments = [...segmenter.segment(title)];
    const shortTitle = segments.slice(0, 20).map(part => part.segment).join('') + (segments.length > 20 ? '…' : '');
    const id = formatDisplayId(item.itemId);
    return [message.locale === 'ar' ? '\u2066'+id+'\u2069' : id, shortTitle].filter(Boolean).join(' ');
  });
  const count = new Intl.NumberFormat(message.locale).format(items.length);
  const list = labels.join(' / ') + (items.length > labels.length ? ' / …' : '');
  return { title: message.title, body: [message.summary(count), list].filter(Boolean).join(' ') };
}

module.exports = { buildNotification, formatDisplayId, MESSAGES };
