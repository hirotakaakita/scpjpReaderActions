"use strict";
const {normalizePage,digest}=require('./core');const {pageKind}=require('./semantics');
const normalize=s=>String(s).normalize('NFKC').replace(/\s+/g,' ').trim();
const TERMS={
 co_appearance:['共演','同室','対面','会話','遭遇','same chamber','encounter','interact','communicat','convers','rencontr','разговор','встрет','общени','대화','交流','交谈','交談','begeg'],
 hostility:['敵対','攻撃','襲撃','交戦','hostil','attack','combat','fight','kill','агресс','атак','вражд','angriff','attaque','atac','敌对','攻击','攻擊','적대','공격','tấn công','โจมตี'],
 affiliation:['所属','加入','一員','member','affiliat','recruit','belong','член','состоит','membre','mitglied','miembro','membro','成员','成員','소속','thành viên'],
 experiment:['実験','試験','終了試行','experiment','termination','exposure','эксперимент','испытан','expérience','versuch','experimento','实验','實驗','실험','การทดลอง'],
 kinship:['兄弟','姉妹','父親','母親','親子','brother','sister','father','mother','брат','сестр','родств','frère','schwester','herman','irmão','형제'],
};
const scpPattern=/\bSCP[-‐‑–— ]?(?:[A-Z]{1,4}[-‐‑–—])?\d{1,6}(?:[-‐‑–—][A-Z0-9]{1,12}){0,3}\b/giu;
const labelKey=s=>normalize(s).replace(/[‐‑–—]/g,'-').toUpperCase();
function* windows(text,max=1200,overlap=200){let start=0;while(start<text.length){let end=Math.min(text.length,start+max);if(end<text.length){const n=text.lastIndexOf('\n',end);if(n>start+max/2)end=n;const c=text.charCodeAt(end-1);if(c>=0xd800&&c<=0xdbff)end--;}
 yield{start,end,text:text.slice(start,end)};if(end===text.length)break;let next=Math.max(start+1,end-overlap);const c=text.charCodeAt(next);if(c>=0xdc00&&c<=0xdfff)next--;start=next;}}
function maskFtml(text){return text.replace(/\[\[(?:code|html)[^\]]*\]\][\s\S]*?\[\[\/(?:code|html)\]\]/gi,m=>m.replace(/[^\n]/g,' ')).replace(/\[!--[\s\S]*?--\]/g,m=>m.replace(/[^\n]/g,' '));}
function evidence(doc,extra={}){return{sourceUrl:doc.url,contentSha256:doc.contentSha256,textSha256:doc.textSha256,fetchedAt:doc.fetchedAt,...extra};}
function structuralFacts(doc,record,lookup){
 const source=normalizePage(doc.url),kind=pageKind(source,doc),facts=[],seen=new Set();
 const add=f=>{const key=JSON.stringify([f.type,f.source,f.target,f.evidence.location,f.evidence.sourceAnchor,f.evidence.section]);if(seen.has(key))return;seen.add(key);facts.push({id:'structural:'+digest(key),...f});};
 const matching=record?.contentSha256===doc.contentSha256;
 const links=matching?record.links||[]:doc.links.map(l=>({target:l.url,location:'captured_source_link',sourceAnchor:null}));
 for(const link of links){const target=normalizePage(link.target,doc.url);if(!target||target.id===source.id)continue;
  const type=link.location==='footnote'?'footnote_reference':link.section?.kind==='addendum'?'addendum_reference':kind.type==='log'?'log_reference':doc.format==='ftml'?'source_reference':'body_reference';
  add({type,source:source.id,target:target.id,sourceUrl:doc.url,targetUrl:target.url,status:'verified_document_structure',evidence:evidence(doc,{location:link.location,sourceAnchor:link.sourceAnchor||null,...(link.section?{section:link.section}:{})})});
 }
 for(const meta of doc.publisherMetadata||[]){if(meta.kind!=='publisher_breadcrumb')continue;const chain=(meta.links||[]).map(x=>normalizePage(x.url)).filter(Boolean);
  if(chain[0]?.slug!=='canon-hub'||!chain[1]||chain[1].host!==source.host||chain[1].id===source.id)continue;
  const canon=chain[1],target=lookup(canon.url);if(!target||!(target.tags||[]).includes('canon-hub'))continue;
  add({type:'canon_member',source:source.id,target:canon.id,sourceUrl:doc.url,targetUrl:canon.url,status:'verified_publisher_metadata',note:'Publisher breadcrumb membership; no transfer to mentioned SCPs.',evidence:evidence(doc,{location:'publisher_breadcrumb',sourceAnchor:'breadcrumbs',excerpt:meta.text})});
 }
 if(matching)for(const claim of record.semanticRelations||[]){if(claim.method!=='source_specific_exact_quote'||!claim.quote||!normalize(doc.text).includes(normalize(claim.quote)))continue;
  const subject=claim.subject?normalizePage(claim.subject):source,target=claim.target?normalizePage(claim.target):null;if(!subject||(!target&&!claim.targetEntity))continue;
  add({type:claim.type,source:subject.id,target:target?.id||'entity:'+source.id+'/'+claim.targetEntity.key,sourceUrl:doc.url,targetUrl:target?.url||null,...(claim.targetEntity?{targetEntity:claim.targetEntity}:{}),status:'curated_source_assertion',note:claim.note||'',evidence:evidence(doc,{location:claim.location||'article_body',sourceAnchor:claim.sourceAnchor||null,excerpt:claim.quote})});
 }
 return facts;
}
function* semanticCandidates(doc){
 const source=normalizePage(doc.url),kind=pageKind(source,doc),text=doc.format==='ftml'?maskFtml(doc.text):doc.text,linksByLabel=new Map();
 for(const link of doc.links){const key=labelKey(link.label),p=normalizePage(link.url);if(!key||!p)continue;if(!linksByLabel.has(key))linksByLabel.set(key,new Set());linksByLabel.get(key).add(p.url);}
 for(const span of windows(text)){
  const mentions=[...new Set([...span.text.matchAll(scpPattern)].map(m=>labelKey(m[0])))];const lower=normalize(span.text).toLowerCase(),hints=[],matchedTerms={};
  for(const [hint,terms]of Object.entries(TERMS)){const found=terms.filter(t=>lower.includes(t));if(found.length){hints.push(hint);matchedTerms[hint]=found;}}
  if(mentions.length>=2&&kind.type!=='hub')hints.push('co_mention_only');
  const focal=/^scp-\d+(?:-|$)/.test(source.slug);if(!hints.length||(!mentions.length&&!focal))continue;
  // Keyword matches are candidates, never semantic assertions; no guessed URL binding.
  const context=doc.text.slice(span.start,span.end);
  yield{id:'candidate:'+digest(source.id+'\0'+doc.contentSha256+'\0'+span.start+'\0'+span.end),source:source.id,sourceUrl:doc.url,branch:source.branch,pageKind:kind,hintTypes:hints,matchedTerms,mentions:mentions.map(label=>({label,explicitUrls:[...(linksByLabel.get(label)||[])]})),status:'unreviewed_context_candidate',notAnAssertedRelationship:true,evidence:evidence(doc,{start:span.start,end:span.end,excerpt:context}),limitations:['Keyword/co-mention matching does not establish interaction, hostility, affiliation, negation, time or canon.',...(doc.limitations||[])]};
 }
}
module.exports={TERMS,windows,maskFtml,evidence,structuralFacts,semanticCandidates};
