'use strict';

const VERSION = 2;
const DESCRIPTION_LABELS = 'description|説明|描述|popis|beschreibung|descripción|descrizione|opis|설명|รายละเอียด|описание|опис|mô tả|الوصف|وصف|disgrifiad|beskrivelse|περιγραφή|leírás|descriptio|beschrijving|descrierea?|beskrivning|açıklama|escriptionday';
const INLINE_DESCRIPTION = new RegExp('^(?:'+DESCRIPTION_LABELS+')\\s*[:：]\\s*([\\s\\S]+)$','iu');
const DESCRIPTION_BOUNDARY = new RegExp('(?:'+DESCRIPTION_LABELS+')\\s*[:：]\\s*','iu');
const HEADER = /^(?:item\s*(?:#|(?:number|no\.?)\s*[:：])|アイテム番号\s*[:：]|(?:项目|項目)(?:编号|編號|編号)\s*[:：]|(?:object|containment|disruption|risk)\s*class\s*[:：]|(?:オブジェクトクラス|对象等级|對象等級|项目等级|項目等級)\s*[:：]|объект\s*(?:№|#)|класс\s+объекта\s*[:：]|objekt(?:nummer|-nr\.?|klasse)\s*[:：]|(?:classe\s+(?:d['’]objet|dell['’]oggetto)|classificazione|klassifizierung)\s*[:：]|(?:ítem|objet|objeto|artículo|elemento)\s*(?:#|n[º°])|(?:clase\s+de\s+objeto|clasificación\s+del\s+objeto)\s*[:：]|(?:numer|klasa)\s+obiektu\s*[:：]|(?:일련번호|등급)\s*[:：])/iu;
const BODY_BOUNDARY = /(?:special\s+containment\s+procedures|特別収容プロトコル|特殊收容措施|特殊收容程序|особые\s+условия\s+содержания|sicherheitsmaßnahmen|procedimientos\s+especiales\s+de\s+contención|procédures\s+de\s+confinement\s+spéciales|procedure\s+speciali\s+di\s+contenimento|특수\s*격리\s*절차)\s*[:：]\s*/iu;
const RATING_LABEL = '(?:rating|notation|評価|评分|評分|評價|평가|bewertung|puntuación|valoración|avaliação|voto|ocena|оценка|рейтинг|hodnocení|đánh giá|คะแนน|التقييم|تقييم|értékelés|bedømmelse|betyg|bedömning|raddio|βαθμολογία|beoordeling|evaluare)';
const WIDGET = new RegExp('^(?:'+RATING_LABEL+'\\s*[:：]\\s*){1,3}[+−–-]?\\s*\\d+\\s*\\+\\s*[−–-]\\s*[x×]\\s*','iu');
const CREDIT_CONTROLS = /^fermer\s+Crédits\s+close\s*/iu;
const EMBEDDED_WIDGET = /[+−–-]?\d+\s*\+\s*[−–-]\s*[x×]/u;
const EXCLUDED = 'script,style,noscript,iframe,.page-tags,.page-rate-widget-box,.creditRate,.licensebox,.license-box,.credit,.credit-box,#u-credit-view,.footer-wikiwalk-nav,.page-navigation,.interwiki-box,[role="navigation"],#toc,.toc,#anom-bar-container,.anom-bar-container,.acs-container,.acs-header';

function headerText(value){return String(value||'').replace(/^[\s*_]+/u,'');}
function repairStoredExcerpt(value){
 const original=String(value||'');let text=original.trim(),removed=false;
 while(WIDGET.test(text)){text=text.replace(WIDGET,'').trim();removed=true;}
 if(removed)text=text.replace(CREDIT_CONTROLS,'').trim();
 return {text,changed:text!==original,needsFetch:(!text&&removed)||HEADER.test(headerText(text))||EMBEDDED_WIDGET.test(text)||new RegExp('^'+RATING_LABEL+'\\s*[:：]','iu').test(headerText(text))};
}

function cleanExcerptRoot(document){
 const source=document.querySelector('#page-content')||document.body||document;
 const root=source.cloneNode(true);
 for(const node of root.querySelectorAll(EXCLUDED))node.remove();
 for(const node of root.querySelectorAll('p,dt,tr,h1,h2,h3,h4,h5,h6')){
  if(!node.parentNode)continue;
  const text=node.textContent.replace(/\u00a0/g,' ').trim();
  if(!HEADER.test(headerText(text)))continue;
  const description=DESCRIPTION_BOUNDARY.exec(text)||BODY_BOUNDARY.exec(text);
  if(description){node.textContent=text.slice(description.index+description[0].length);continue;}
  // Only remove a header-sized block, never an entire article container.
  if(text.length<240)node.remove();
 }
 return root;
}
function inlineDescription(root){
 for(const node of root.querySelectorAll('p,h1,h2,h3,h4,h5,h6,dt')){
  const match=INLINE_DESCRIPTION.exec(node.textContent.replace(/\u00a0/g,' ').trim());
  if(match)return match[1].replace(/\s+/g,' ').trim();
 }
 return null;
}
module.exports={VERSION,EXCLUDED,HEADER,DESCRIPTION_BOUNDARY,cleanExcerptRoot,inlineDescription,repairStoredExcerpt};
