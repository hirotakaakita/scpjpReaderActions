'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { LANGUAGES } = require('./languages');
const sites = require('./additional-sites.json');
const dictionary = require('./tag-dictionary.json').tags;
const FEATURE_WEEKS = 104;
const KEYS = ['humanoid','sentient','spatial','temporal','mind_affecting','reality_altering','mechanical','plant','liquid','biological','artifact','hostile','infectious','infohazard','regenerative','self_replicating'];
const EXTRA = { biological:['生物学','生命','生物'], artifact:['物品','人工','道具'], hostile:['敵対的','敵対性'], regenerative:['再生','自己修復'] };
const LOCALES = {jp:'ja',cn:'zh','zh-tr':'zh-Hant',ua:'uk',vn:'vi',int:'en',...Object.fromEntries(Object.entries(sites).map(([code,site])=>[code,site.uiLocale]))};
const additionalLabels = {
 ar:['بشري الشكل','ذكي','المكان','الزمن','تأثير عقلي','تغيير الواقع','الآلات','النباتات','السوائل','الأحياء','الأشياء','العداء','العدوى','خطر معلوماتي','التجدد','التكاثر الذاتي'],
 cy:['Dynolffurf','Ymdeimladol','Gofod','Amser','Dylanwad meddyliol','Newid realiti','Peiriannau','Planhigion','Hylifau','Bioleg','Gwrthrychau','Gelyniaeth','Heintiau','Perygl gwybodaeth','Adfywio','Hunan-ddyblygu'],
 da:['Menneskelignende','Intelligens','Rum','Tid','Sindspåvirkning','Virkelighedsændring','Maskiner','Planter','Væsker','Biologi','Genstande','Fjendtlighed','Smitte','Informationsfare','Regeneration','Selvreplikation'],
 el:['Ανθρωπόμορφα','Νοημοσύνη','Χώρος','Χρόνος','Επίδραση στον νου','Αλλοίωση πραγματικότητας','Μηχανές','Φυτά','Υγρά','Βιολογία','Αντικείμενα','Εχθρότητα','Μετάδοση','Πληροφοριακός κίνδυνος','Αναγέννηση','Αυτοαναπαραγωγή'],
 hu:['Emberalak','Értelem','Tér','Idő','Elmebefolyásolás','Valóságmódosítás','Gépek','Növények','Folyadékok','Biológia','Tárgyak','Ellenségesség','Fertőzés','Információs veszély','Regeneráció','Önreplikáció'],
 nl:['Mensachtig','Bewustzijn','Ruimte','Tijd','Geestesbeïnvloeding','Realiteitsverandering','Machines','Planten','Vloeistoffen','Biologie','Voorwerpen','Vijandigheid','Besmetting','Informatiegevaar','Regeneratie','Zelfreplicatie'],
 nb:['Menneskelignende','Intelligens','Rom','Tid','Sinnspåvirkning','Virkelighetsendring','Maskiner','Planter','Væsker','Biologi','Gjenstander','Fiendtlighet','Smitte','Informasjonsfare','Regenerasjon','Selvreplikasjon'],
 ro:['Umanoid','Inteligență','Spațiu','Timp','Influență mentală','Modificarea realității','Mașini','Plante','Lichide','Biologie','Obiecte','Ostilitate','Infecție','Pericol informațional','Regenerare','Autoreplicare'],
 hr:['Čovjekoliki','Inteligencija','Prostor','Vrijeme','Utjecaj na um','Promjena stvarnosti','Strojevi','Biljke','Tekućine','Biologija','Predmeti','Neprijateljstvo','Zaraza','Informacijska opasnost','Regeneracija','Samoreplikacija'],
 sl:['Človeku podobni','Inteligenca','Prostor','Čas','Vpliv na um','Spreminjanje resničnosti','Stroji','Rastline','Tekočine','Biologija','Predmeti','Sovražnost','Okužba','Informacijska nevarnost','Regeneracija','Samopodvajanje'],
 sv:['Människoliknande','Intelligens','Rum','Tid','Sinnespåverkan','Verklighetsförändring','Maskiner','Växter','Vätskor','Biologi','Föremål','Fientlighet','Smitta','Informationsfara','Återbildning','Självreplikation'],
 tr:['İnsansı','Zekâ','Uzay','Zaman','Zihinsel etki','Gerçeklik değişimi','Makineler','Bitkiler','Sıvılar','Biyoloji','Nesneler','Düşmanlık','Bulaşma','Bilgi tehlikesi','Yenilenme','Kendini kopyalama']
};
const normalize = value => value.normalize('NFKC').toLowerCase().replace(/[ _-]/g,'');
const japaneseTitles=['人間に似たものたち','考える異常存在','ありえない空間','時間が壊れるとき','心に触れる異常','現実を書き換えるもの','機械仕掛けの異常','植物の静かな異常','液体に潜むもの','生物の境界線','日常の道具、その異常','敵意を持つ存在','広がる感染','知ることの危険','何度でも再生するもの','増え続ける異常'];
const intros={
 en:'Explore {theme}: compare what these SCPs have in common and how their anomalies differ.',
 ja:'「{theme}」を手がかりに、異常の共通点と違いを読み比べる特集です。',
 ar:'استكشف موضوع «{theme}» وقارن أوجه التشابه والاختلاف بين هذه الظواهر الشاذة.',
 cs:'Prozkoumejte téma „{theme}“ a porovnejte podobnosti a rozdíly mezi těmito anomáliemi.',
 cy:'Archwiliwch thema {theme} a chymharwch debygrwydd a gwahaniaethau’r anomaleddau hyn.',
 da:'Udforsk temaet {theme}, og sammenlign disse anomalier og deres forskelle.',
 de:'Entdecke das Thema „{theme}“ und vergleiche Gemeinsamkeiten und Unterschiede dieser Anomalien.',
 el:'Εξερευνήστε το θέμα «{theme}» και συγκρίνετε τις ομοιότητες και τις διαφορές αυτών των ανωμαλιών.',
 es:'Explora el tema «{theme}» y compara las semejanzas y diferencias de estas anomalías.',
 fr:'Explorez le thème « {theme} » et comparez les points communs et les différences de ces anomalies.',
 hr:'Istražite temu „{theme}” i usporedite sličnosti i razlike ovih anomalija.',
 hu:'Fedezze fel a(z) „{theme}” témát, és hasonlítsa össze ezen anomáliák közös és eltérő jellemzőit.',
 it:'Esplora il tema «{theme}» e confronta somiglianze e differenze di queste anomalie.',
 ko:'「{theme}」를 주제로 이 변칙들의 공통점과 차이점을 비교해 보세요.',
 nb:'Utforsk temaet {theme}, og sammenlign likhetene og forskjellene mellom disse anomaliene.',
 nl:'Verken het thema ‘{theme}’ en vergelijk de overeenkomsten en verschillen tussen deze anomalieën.',
 pl:'Poznaj temat „{theme}” i porównaj podobieństwa oraz różnice między tymi anomaliami.',
 pt:'Explore o tema «{theme}» e compare as semelhanças e diferenças entre estas anomalias.',
 ro:'Explorează tema „{theme}” și compară asemănările și diferențele dintre aceste anomalii.',
 ru:'Изучите тему «{theme}» и сравните общие черты и различия этих аномалий.',
 sl:'Raziščite temo »{theme}« in primerjajte podobnosti ter razlike med temi anomalijami.',
 sv:'Utforska temat {theme} och jämför likheter och skillnader mellan dessa anomalier.',
 th:'สำรวจหัวข้อ {theme} และเปรียบเทียบความเหมือนและความแตกต่างของสิ่งผิดปกติเหล่านี้',
 tr:'“{theme}” temasını keşfedin ve bu anomalilerin benzerliklerini ve farklarını karşılaştırın.',
 uk:'Дослідіть тему «{theme}» та порівняйте спільні риси й відмінності цих аномалій.',
 vi:'Khám phá chủ đề «{theme}» và so sánh những điểm giống và khác nhau giữa các dị thể này.',
 zh:'围绕“{theme}”，对比这些异常的共同点与差异。',
 'zh-Hant':'圍繞「{theme}」，對比這些異常的共同點與差異。'
};
function label(key, locale) { return additionalLabels[locale]?.[KEYS.indexOf(key)] || dictionary[key]?.labels?.[locale] || dictionary[key]?.labels?.en || key; }
const aliases = new Map(KEYS.map(key=>[key,new Set([key,...(dictionary[key]?.aliases||[]),...Object.values(dictionary[key]?.labels||{}),...(EXTRA[key]||[]),...Object.values(additionalLabels).map(values=>values[KEYS.indexOf(key)])].map(normalize))]));
function groups(row) {
 const tags = (row.tags||[]).flatMap(tag=>{
  const id=typeof tag==='string'?tag:tag.id, entry=dictionary[id]||{};
  return [id,...(entry.aliases||[]),...Object.values(entry.labels||{})];
 }).map(normalize);
 return new Set(KEYS.filter(key=>tags.some(tag=>aliases.get(key).has(tag))));
}
function excerpt(row) {
 const text=(row.descriptionExcerpt||'').replace(/<[^>]*>/g,' ').replace(/https?:\/\/\S+/g,'').replace(/\s+/g,' ').trim();
 const sentences=text.split(/(?<=[。！？])\s*|(?<=[.!?])\s+(?=\p{L})|\n/u).map(s=>s.trim()).filter(s=>s.length>20&&s.replace(/\[[^\]]*\]|[●|█:]/g,'').trim().length>20);
 const first=sentences.find(s=>!/^\s*(?:特別収容|収容手順|クレジット|著作|copyright|license|special containment|процедур)/iu.test(s));
 if(!first || /(?:javascript|window\.|cookie|captcha|access denied|Cloudflare|Verify you are human|John Doe ログイン|プログラム起動中|ログイン.*データベースへのアクセス|アイテムばんごう|とじこめかた)/iu.test(first))return null;
 return [...first].slice(0,120).join('')+([...first].length>120?'…':'');
}
const themeSignals={
 humanoid:/人間|人型|人の|人類|男性|女性|human|humanoid|person/iu,
 sentient:/知性|知能|意識|会話|意思|思考|自我|目的|望ん|コミュニケーション|intelligen|sentien|conscious|communicat/iu,
 spatial:/空間|内部|部屋|扉|空洞|距離|寸法|広さ|階段|space|spatial|interior|room|door/iu,
 temporal:/時間|時刻|未来|過去|年代|経過|年齢|time|temporal|future|past/iu,
 mind_affecting:/精神|感情|記憶|認識|衝動|欲望|心理|気分|心|memory|mental|mind|desire|emotion/iu,
 reality_altering:/現実|改変|法則|変化|変容|reality|alter|transform/iu,
 mechanical:/機械|装置|回路|部品|動作|電気|歯車|機構|machine|mechanic|device|motor/iu,
 plant:/植物|花|木|葉|根|種子|樹|成長|plant|tree|flower|seed/iu,
 liquid:/液体|溶液|流体|液状|水|液|liquid|fluid|water/iu,
 biological:/生物|生命|動物|細胞|体内|組織|繁殖|生態|biolog|organism|animal|living/iu,
 artifact:/物品|道具|装置|製造|作られ|使用|利用|object|artifact|artefact|device|use/iu,
 hostile:/敵対|敵意|攻撃|捕食|殺害|憎悪|襲|hostil|attack|aggress/iu,
 infectious:/感染|伝染|伝播|拡散|接触|広が|infect|contagio|transmi|spread/iu,
 infohazard:/情報|知識|認識|知る|閲覧|読|見た|見る|理解|info|knowledge|read|view|cognit/iu,
 regenerative:/再生|回復|治癒|修復|復元|傷|破壊|regenerat|heal|repair|recover/iu,
 self_replicating:/自己複製|複製|増殖|繁殖|増加|増え|産卵|replicat|reproduc|multiply/iu
};
function featureExcerpt(row,theme){
 const text=(row.descriptionExcerpt||'').replace(/<[^>]*>/g,' ').replace(/https?:\/\/\S+/g,'');
 const sentences=text.split(/(?<=[。！？])\s*|(?<=[.!?])\s+(?=\p{L})|\n+/u).map(s=>s.replace(/\s+/g,' ').trim()).filter(s=>s.length>20&&s.length<=300&&/[。！？.!?]$/.test(s)&&!/(?:特別収容|補遺.*参照|クレジット|copyright|license|javascript|ログイン|セキュリティクリアランス|データベースへのアクセス|以下の(?:通り|とおり|よう)|下記|as follows)/iu.test(s));
 if(!sentences.length)return excerpt(row);
 const scored=sentences.map((text,index)=>({text,index,score:theme.keys.reduce((n,key)=>n+(themeSignals[key].test(text)?3:0),0)+(/異常|効果|能力|変化|しかし|一方|anomal|effect|ability/iu.test(text)?2:0)+(index>0?1:0)-(text.length>170?2:0)}));
 scored.sort((a,b)=>b.score-a.score||a.index-b.index);
 const chosen=scored[0];
 // Retain a short identifying sentence when the thematic sentence otherwise
 // starts halfway through a description. Never invent an article's behavior.
 const limit=/[ぁ-んァ-ヶ\u3400-\u9fff]/u.test(text)?120:220;
 const lead=sentences[0],joined=chosen.index>0&&lead.length+chosen.text.length<=limit?lead+chosen.text:chosen.text;
 return [...joined].length>limit?[...joined].slice(0,limit-1).join('')+'…':joined;
}
function usableImage(row){return Boolean(row.imageUrl)&&!/(?:scp-blank|classified|component|favicon|\{\$|logo\.|\/waku\.png|\/header|\/banner|\.svg(?:[?#]|$))/iu.test(row.imageUrl);}
function loadCatalogs(root) {
 const catalogs=Object.fromEntries(Object.keys(LANGUAGES).map(code=>{
  const file=path.join(root,code,'scp-data.json');
  const rows=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)).data:[];
  return [code,rows.filter(r=>r.isTranslatedJP!==false&&r.contentType==='scp'&&r.pageType.startsWith('scp-series')&&r.titleJP&&r.urlJP&&!/^scp-series(?:-[a-z]+)?-0*1$/.test(r.itemId)&&excerpt(r)).map(r=>({...r,groups:groups(r)}))];
 }));
 // Article identities are shared across translations. Reuse verified thematic
 // tags from another translation when a smaller branch has sparse tag metadata.
 const byId=new Map();
 for(const rows of Object.values(catalogs))for(const row of rows){if(!byId.has(row.itemId))byId.set(row.itemId,new Set());for(const key of row.groups)byId.get(row.itemId).add(key);}
 for(const rows of Object.values(catalogs))for(const row of rows)row.groups=byId.get(row.itemId);
 return catalogs;
}
function createPlan(catalogs, start='2026-11-11T10:00:00.000Z') {
 const themes=KEYS.map(key=>({keys:[key]}));
 for(let a=0;a<KEYS.length;a++)for(let b=a+1;b<KEYS.length;b++)themes.push({keys:[KEYS[a],KEYS[b]]});
 for(const key of KEYS)for(const objectClass of ['Safe','Euclid','Keter'])themes.push({keys:[key],objectClass});
 const valid=themes.map(t=>({...t,id:t.keys.join('-')+(t.objectClass?'-'+t.objectClass.toLowerCase():''),
   coverage:Object.values(catalogs).filter(rows=>rows.filter(r=>matches(r,t)).length>=5).length})).filter(t=>t.coverage>0);
 // Interleave broad topics and narrower combinations rather than grouping a year's themes by one tag.
 const singles=valid.filter(t=>t.keys.length===1&&!t.objectClass), rest=valid.filter(t=>t.keys.length>1||t.objectClass);
 rest.sort((a,b)=>b.coverage-a.coverage||hash(a.id).localeCompare(hash(b.id)));
 const ordered=[];while(ordered.length<FEATURE_WEEKS&&(singles.length||rest.length)){if(ordered.length%4===0&&singles.length)ordered.push(singles.shift());else if(rest.length)ordered.push(rest.shift());else ordered.push(singles.shift());}
 if(ordered.length!==FEATURE_WEEKS)throw Error('Insufficient distinct supported themes');
 return ordered.map((theme,i)=>({id:`weekly-${String(i+1).padStart(3,'0')}`,themeId:theme.id,keys:theme.keys,...(theme.objectClass?{objectClass:theme.objectClass}:{}),publishedAt:new Date(Date.parse(start)+i*7*86400000).toISOString()}));
}
function hash(value){return crypto.createHash('sha256').update(value).digest('hex');}
function matches(row,theme){return theme.keys.every(key=>row.groups.has(key))&&(!theme.objectClass||String(row.objectClass).toLowerCase()===theme.objectClass.toLowerCase());}
function generate(root,output,{start,plan:fixedPlan}={}) {
 const scheduleFile=path.join(output,'schedule.json');
 const catalogs=loadCatalogs(root),plan=(fixedPlan||(!start&&fs.existsSync(scheduleFile)?JSON.parse(fs.readFileSync(scheduleFile)).weeks:createPlan(catalogs,start))).slice(0,FEATURE_WEEKS),report={};fs.mkdirSync(output,{recursive:true});
 const japaneseEditorial=JSON.parse(fs.readFileSync(path.join(output,'theme-editorial-ja.json')));
 fs.writeFileSync(path.join(output,'schedule.json'),JSON.stringify({schemaVersion:1,timeZone:'Asia/Tokyo',updateDay:'Wednesday',updateHour:19,weeks:plan},null,2)+'\n');
 for(const [language,rows]of Object.entries(catalogs)){
  const locale=LOCALES[language]||language,used=new Map(),features=[];
  for(const theme of plan){
   const editorialFile=path.join(output,'editorial',language,theme.id+'.json');
   if(fs.existsSync(editorialFile)){
    const feature=JSON.parse(fs.readFileSync(editorialFile));
    // Reviewed editorial selections use the article's contents, which may cover
    // a theme without carrying the automatic selector's exact Wiki tags.
    if(feature.id!==theme.id||feature.themeId!==theme.themeId||feature.publishedAt!==theme.publishedAt||feature.articles.length<5||feature.articles.length>10||new Set(feature.articles.map(a=>a.itemId)).size!==feature.articles.length||feature.articles.some(a=>!a.blurb||!rows.some(r=>r.itemId===a.itemId&&r.titleJP===a.title&&r.urlJP===a.url)))throw Error('Invalid editorial override '+language+'/'+theme.id);
    features.push(feature);for(const article of feature.articles)used.set(article.itemId,(used.get(article.itemId)||0)+1);
    continue;
   }
   const candidates=rows.filter(row=>matches(row,theme));if(candidates.length<5)continue;
   candidates.sort((a,b)=>Number(usableImage(b))-Number(usableImage(a))||(used.get(a.itemId)||0)-(used.get(b.itemId)||0)||(b.rating||0)-(a.rating||0)||hash(theme.id+a.itemId).localeCompare(hash(theme.id+b.itemId)));
   const picked=candidates.slice(0,8);if(picked.some(r=>r.itemId===undefined))throw Error('Missing identity');
   const focus=[...theme.keys.map(key=>label(key,locale)),...(theme.objectClass?[theme.objectClass]:[])].join(' × ');
   const title=locale==='ja'?japaneseEditorial[theme.id]?.[0]||japaneseTitles[KEYS.indexOf(theme.keys[0])]:focus;
   const introduction=locale==='ja'?japaneseEditorial[theme.id]?.[1]:(intros[locale]||intros.en).replace('{theme}',focus);
   if(!title||!introduction)throw Error('Missing feature editorial '+theme.id);
   const articles=picked.map(row=>{used.set(row.itemId,(used.get(row.itemId)||0)+1);return {itemId:row.itemId,title:row.titleJP,blurb:featureExcerpt(row,theme),url:row.urlJP,...(usableImage(row)?{imageUrl:row.imageUrl}:{}),sourceTags:theme.keys};});
   const coverImage=theme.id==='weekly-001'?'features/images/humanoid-v1.png':theme.id==='weekly-002'?'features/images/spatial-v1.png':theme.id==='weekly-003'?'features/images/everyday-v1.png':`features/images/${theme.id}-v1.png`;
   features.push({id:theme.id,themeId:theme.themeId,publishedAt:theme.publishedAt,title,introduction,coverImage,articles});
  }
  const dir=path.join(output,language);fs.mkdirSync(dir,{recursive:true});
  const catalog={schemaVersion:1,language,timeZone:'Asia/Tokyo',license:'CC BY-SA 3.0',licenseUrl:'https://creativecommons.org/licenses/by-sa/3.0/',attribution:'Article titles and introductory excerpts are derived from the linked SCP Wiki pages. See each source page for its authors and credits.',features};
  fs.mkdirSync(path.join(output,'planned'),{recursive:true});
  fs.writeFileSync(path.join(output,'planned',language+'.json'),JSON.stringify(catalog,null,2)+'\n');
  if(!fs.existsSync(path.join(dir,'index.json')))fs.writeFileSync(path.join(dir,'index.json'),JSON.stringify({...catalog,features:[]},null,2)+'\n');
  report[language]={features:features.length,articles:new Set(features.flatMap(f=>f.articles.map(a=>a.itemId))).size};
 }
 fs.writeFileSync(path.join(output,'generation-report.json'),JSON.stringify(report,null,2)+'\n');return report;
}
if(require.main===module)console.log(JSON.stringify(generate(process.argv[2]||'local-data',process.argv[3]||'features'),null,2));
module.exports={generate,matches,groups,excerpt,featureExcerpt,usableImage,createPlan,loadCatalogs,FEATURE_WEEKS};
