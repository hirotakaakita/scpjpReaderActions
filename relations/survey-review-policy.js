"use strict";
const {digest}=require('./core');
const {strongClaim,relationKey}=require('./survey-assessment');
const POLICY='selective_review_v1';
const IMPORTANT=new Set(['hostile_to','member_of','canon_member','created_by','relative_of','ally_of','threatens','ordered_termination_of','termination_policy']);
function selectReview(unit,result,{samplePercent=5}={}){
 const reasons=[];
 if(unit.stage==='consolidation'||unit.totalParts>1)reasons.push('long_document_context');
 if(result.coverage!=='complete')reasons.push('incomplete_context');
 if(result.invalidRelations?.length)reasons.push('invalid_evidence_or_identity');
 if(result.relations.some(r=>r.certainty==='uncertain'||r.event_status==='unknown'||(r.polarity==='asserted'&&!strongClaim(r))))reasons.push('ambiguous_claim');
 if(result.relations.some(r=>IMPORTANT.has(r.type)))reasons.push('important_relationship');
 if(parseInt(digest(unit.url).slice(0,8),16)%100<samplePercent)reasons.push('deterministic_quality_sample');
 return{policy:POLICY,required:reasons.length>0,reasons,samplePercent};
}
function firstPass(unit,result,primary,selection=selectReview(unit,result)){
 const review={mode:'single_pass',primarySession:primary.unitSessions?.[unit.unitId]||primary.sessionId,primaryRun:primary.unitRuns?.[unit.unitId]||primary.run,promptHash:primary.unitPrompts?.[unit.unitId]||primary.promptSha256};
 const candidates=[],disputed=[],observations=[];
 for(const invalid of result.invalidRelations||[])disputed.push({id:digest(unit.unitId+JSON.stringify(invalid)),status:'invalid_model_claim',sourceUrl:unit.url,unitId:unit.unitId,documentKey:unit.documentKey,invalidClaim:invalid.relation,validationError:invalid.error,review});
 for(const r of result.relations){const item={id:relationKey(r,unit.url),relation:r,sourceUrl:unit.url,unitId:unit.unitId,documentKey:unit.documentKey,scope:'this_source_only',sourceContentSha256:unit.sourceContentSha256,sourceTextSha256:unit.sourceTextSha256,sourceParts:unit.totalParts,review};
  if(strongClaim(r)&&result.coverage==='complete')candidates.push({...item,evidence:r.evidence,status:'single_pass_validated_candidate'});
  else if(!selection.required&&r.polarity!=='asserted')observations.push({...item,evidence:r.evidence,status:'single_pass_non_affirmative_observation'});
  else disputed.push({...item,status:'requires_review',primary:r,reviewer:null});
 }
 return{schemaVersion:1,unitId:unit.unitId,documentKey:unit.documentKey,sourceUrl:unit.url,start:unit.start,end:unit.end,sourceParts:unit.totalParts,coverage:result.coverage==='complete'?'single_assessed':'needs_context',accepted:[],candidates,observations,disputed,review,reviewSelection:selection,reviewStatus:selection.required?'pending':'not_selected',notes:[result.notes],completedAt:new Date().toISOString()};
}
module.exports={POLICY,IMPORTANT,selectReview,firstPass};
