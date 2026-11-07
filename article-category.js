'use strict';

// Article type and original branch are independent. A canon's member is not
// necessarily a hub, and a translated work keeps its original branch.
function articleCategory(record, evidence = [], url = record.url || '') {
  const tags = new Set((record.tags || []).map(t => t.toLowerCase()));
  const has = values => values.some(t => tags.has(t));
  if (has(['hub','ハブ','中心','结构','структура:хаб','허브','centrum','concentrador','centre','portalseite','hub-vn'])) return 'hub';
  if (has(['goi-format','goiフォーマット','goi格式','формат-goi','format-goi','format-goi-fr','goi-格式','goi서식','структура:свор_формат'])) return 'goi';
  if (has(['experiment-log','exploration-log','interview','incident-report','supplement','実験','実験記録','探査','探査記録','インタビュー','補足','実験ログ'])) return 'record';
  if (has(['tale','tales','conte','relato','racconto','opowiadanie','рассказ','이야기','故事','структура:рассказ','geschichte'])) return 'tale';
  if (has(['personnel','facility','mobile-task-force','department','人物','施設','機動部隊','部門','要注意団体','goi-hub'])) return 'setting';
  const kinds = new Set(evidence.map(e => e.kind));
  if (evidence.some(e => e.kind === 'canon' && e.source === url)) return 'hub';
  if (/(?:experiment|exploration|incident|test)[-_](?:log|record)|(?:^|\/)interview[-_]/i.test(url)) return 'record';
  if (kinds.has('record')) return 'record';
  if (kinds.has('goi-format')) return 'goi';
  if (kinds.has('tale')) return 'tale';
  if (kinds.has('setting')) return 'setting';
  return 'other';
}
module.exports = { articleCategory };
