import{hasCategoryOnlyMembership}from'../web/facility-membership.js';
import{facilityCategoryTree}from'./facility-categories.mjs';
import{boundWalkingEvidence}from'../web/reachable-presentation.js';
import{specialtyEvidenceRecords,SPECIALTY_EVIDENCE_VERSION}from'./specialty-gap-evidence.mjs';
import{MAJOR_WALKING_SERVICE_SET_VERSION}from'../web/specialty-gap-evidence.js';
const valid=p=>p&&[p.lng,p.lat].every(Number.isFinite);
// Compact, read-only projection. It retains circle-exterior facilities and
// geographically bounds unresolved relevant candidates without changing their
// classification, accessibility or score.
export function serviceGapEvidence(job){
 const a=job?.analysis;if(!a?.origin)return null;const tree=facilityCategoryTree(a.categoryMappingVersion??job.categoryMappingVersion),pool=new Map();
 for(const p of[...a.poiMarkers??[],...job.display?.facilities??[]]){const k=p.identityKey??(p.uid?'uid:'+p.uid:null);if(k)pool.set(k,{...pool.get(k),...p});}
 const routeMap=new Map();for(const g of a.categories??[])for(const s of[...(g.subtypeResults??[]),{routes:g.categoryOnlyRoutes??[]}])for(const r of s.routes??[]){if(!routeMap.has(r.identityKey))routeMap.set(r.identityKey,[]);routeMap.get(r.identityKey).push(r);}
 const walking=p=>{const r=[p.routeEvidence,...routeMap.get(p.identityKey??'uid:'+p.uid)??[]].filter(Boolean).filter(r=>boundWalkingEvidence({...p,routeEvidence:r},a.origin)).sort((a,b)=>a.distanceMeters-b.distanceMeters)[0];return{walkingVerified:!!r,walkingDistanceMeters:r?.distanceMeters??null,walkingReachability:r?r.distanceMeters<=1200?'within_15min':'outside_15min':'unavailable'};};
 return{version:'service-gap-evidence-v1',walkingServiceSetVersion:MAJOR_WALKING_SERVICE_SET_VERSION,analysisId:job.analysisId,origin:a.origin,sourceEvidenceFingerprint:job.score?.evidenceFingerprint,specialtyEvidenceVersion:SPECIALTY_EVIDENCE_VERSION,specialties:specialtyEvidenceRecords(job,tree),groups:tree.categories.map(g=>{
  const ids=new Set(g.subtypes.map(s=>s.id)),evidence=a.categories?.find(c=>c.categoryId===g.id),confirmed=[...pool.values()].filter(p=>(p.subtypeIds?.some(id=>ids.has(id))||g.id==='eldercare'&&hasCategoryOnlyMembership(p))&&valid(p.location)).map(p=>({identityKey:p.identityKey??'uid:'+p.uid,uid:p.uid,name:p.name,location:p.location,...walking(p)}));
  const pending=new Map();for(const s of evidence?.subtypeResults??[])for(const d of s.candidateDiagnostics??[]){if(d.classification?.candidateStatus!=='pending_review')continue;const key=d.identityKey??(d.uid?'uid:'+d.uid:null);if(key)pending.set(key,{...d,...pool.get(key)});}
  const expected=Math.max(0,...(evidence?.subtypeResults??[]).map(s=>s.pendingClassificationCount??0)),terms=[...new Set([...g.recallQueries??[],...g.subtypes.flatMap(s=>[...s.namePatterns,...s.rawCategoryHints,...s.searchQueries])])],relevant=[...pending.values()].filter(p=>{const text=[p.name,p.rawCategory,...p.rawCategoryTags??[]].join(' ');return terms.some(t=>text.includes(t))||(g.id==='eldercare'&&/养老|康养|托老|为老|老年|敬老/.test(text));}),potential=relevant.filter(p=>valid(p.location)&&!confirmed.some(c=>c.identityKey===(p.identityKey??'uid:'+p.uid))).map(p=>({identityKey:p.identityKey??'uid:'+p.uid,uid:p.uid,name:p.name,location:p.location,...walking(p)}));
  return{categoryId:g.id,confirmed,potential,pendingEvidenceComplete:pending.size>=expected&&relevant.every(p=>valid(p.location)),pendingCount:pending.size,relevantPendingCount:relevant.length,ignoredUnrelatedPendingCount:pending.size-relevant.length};
 })};
}
