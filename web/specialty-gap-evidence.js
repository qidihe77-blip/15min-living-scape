import{boundWalkingEvidence}from'./reachable-presentation.js';
export const SPECIALTY_EVIDENCE_VERSION='specialty-evidence-v2';
export const MAJOR_WALKING_SERVICE_SET_VERSION='origin-walking-15min-v1';
const straightDistanceMeters=(a,b)=>{const rad=v=>v*Math.PI/180,h=Math.sin(rad(b.lat-a.lat)/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lng-a.lng)/2)**2;return 12742000*Math.asin(Math.min(1,Math.sqrt(h)));};
const valid=p=>p&&[p.lng,p.lat].every(Number.isFinite)&&Math.abs(p.lng)<=180&&Math.abs(p.lat)<=90;
const key=p=>p.uid?'uid:'+p.uid:p.identityKey??null;
export function hasCurrentServiceGapEvidence(job,tree){
 const p=job?.serviceGapEvidence,o=job?.analysis?.origin;
 return !!(valid(o?.location)&&p?.version==='service-gap-evidence-v1'&&p.walkingServiceSetVersion===MAJOR_WALKING_SERVICE_SET_VERSION&&p.analysisId===job.analysisId&&p.sourceEvidenceFingerprint===job.score?.evidenceFingerprint&&(p.origin?.uid??null)===(o.uid??null)&&valid(p.origin?.location)&&straightDistanceMeters(p.origin.location,o.location)<.1&&p.specialtyEvidenceVersion===SPECIALTY_EVIDENCE_VERSION&&Array.isArray(p.specialties)&&Array.isArray(p.groups)&&(tree?.categories??[]).every(g=>p.groups.some(r=>r.categoryId===g.id)));
}
const parts=query=>String(query??'').split('$');
// Only complete pages of the subtype's actual query packets can certify its
// search. A failed unrelated broad-recall query cannot invalidate those pages.
export function specialtySearchEvidence(sub,definition,group,discardedCandidates=null,observedCandidates=[]){
 const pages=sub.searchPages??[],errors=sub.searchErrors??[],queries=definition.searchQueries??[],required=packet=>queries.some(q=>parts(packet).includes(q));
 const packets=[...new Set([...pages.map(p=>p.keyword),...errors.map(e=>e.keyword)].filter(Boolean))];
 const tasks=queries.map(query=>{const own=packets.filter(p=>parts(p).includes(query)),ownPages=pages.filter(p=>own.includes(p.keyword)),ownErrors=errors.filter(e=>own.includes(e.keyword)),completed=own.filter(packet=>{
  const rows=ownPages.filter(p=>p.keyword===packet&&p.shardId==='root').sort((a,b)=>a.pageNum-b.pageNum),total=rows[0]?.reportedTotal;
  const unique=new Set(observedCandidates.filter(p=>(p.retrievalEvidence??[]).some(e=>e.query===packet)||(p.matchedQueries??[]).includes(packet)).map(key).filter(Boolean));for(const p of discardedCandidates??[])if(p.query===packet&&p.uid)unique.add('uid:'+p.uid);
  // New records carry provider-side unique counts. Older full audit records
  // reconstruct these from actual UID/query provenance, never returned-row sums.
  const end=rows.at(-1),uniqueCount=Number.isInteger(end?.uniqueSeenRows)?end.uniqueSeenRows:unique.size;
  return Number.isInteger(total)&&total>=0&&!ownErrors.some(e=>e.keyword===packet)&&rows.every((p,i)=>p.pageNum===i&&p.reportedTotal===total&&Number.isInteger(p.returned)&&p.returned>=0)&&rows.reduce((n,p)=>n+p.returned,0)>=uniqueCount&&uniqueCount>=total&&end?.queryComplete!==false;
 });return{taskId:definition.id+':'+query,query,status:completed.length?'complete':ownPages.length?'truncated':ownErrors.length?'failed':'not_searched',complete:completed.length>0,packets:own,pages:ownPages,errors:ownErrors};});
 const invalid=(discardedCandidates??[]).filter(p=>p.reasonCode==='invalid_candidate'),unassignedInvalid=Math.max(0,(sub.invalidCandidateCount??0)-invalid.length),requiredInvalid=invalid.filter(p=>!p.query||required(p.query)).length;
 return{version:'specialty-search-v1',source:'independent_required_query_packets',hasTaskEvidence:pages.length>0||errors.length>0,requiredQueries:[...queries],auxiliaryQueries:[...new Set([...(group.recallQueries??[]),...packets.flatMap(parts)].filter(q=>!queries.includes(q)))],requiredTasks:tasks,
  complete:tasks.length>0&&tasks.every(t=>t.complete)&&!requiredInvalid&&!unassignedInvalid,
  status:tasks.length&&tasks.every(t=>t.complete)&&!requiredInvalid&&!unassignedInvalid?'complete':tasks.some(t=>t.pages.length)?'partial':'failed',
  pages:pages.filter(p=>required(p.keyword)),errors:errors.filter(e=>e.keyword&&required(e.keyword)),auxiliaryPages:pages.filter(p=>!required(p.keyword)),auxiliaryErrors:errors.filter(e=>e.keyword&&!required(e.keyword)),unassignedErrors:errors.filter(e=>!e.keyword),invalidCandidateCount:requiredInvalid,unassignedInvalidCandidateCount:unassignedInvalid};
}
// These only retain uncertain candidates; they never assign a facility type.
const possibleTypeHints={market:/农贸|菜市场|菜场|菜店|集贸|农副产品市场/,pharmacy:/药店|药房|医药零售|大药房/,primary_school:/小学|九年一贯制|十二年一贯制|一贯制学校|义务教育学校/};
function relevant(p,id,definition){const text=[p.name,p.rawCategory,...p.rawCategoryTags??[]].join(' ');return[...definition.searchQueries??[],...definition.namePatterns??[],...definition.rawCategoryHints??[]].some(t=>text.includes(t))||possibleTypeHints[id]?.test(text);}
export function specialtyEvidenceRecords(job,tree){
 const a=job.analysis,o=a?.origin;if(!valid(o?.location))return[];
 const pool=new Map();for(const p of[...a.poiMarkers??[],...job.display?.facilities??[]])if(key(p))pool.set(key(p),{...pool.get(key(p)),...p});
 const allRoutes=new Map();for(const g of a.categories??[])for(const s of g.subtypeResults??[])for(const r of s.routes??[]){const k=key({uid:r.facilityUid??r.destinationUid,identityKey:r.identityKey});if(!allRoutes.has(k))allRoutes.set(k,r);}
 return['market','pharmacy','primary_school'].flatMap(id=>{
  const group=tree.categories.find(g=>g.subtypes.some(s=>s.id===id)),definition=group?.subtypes.find(s=>s.id===id),sub=a.categories?.find(g=>g.categoryId===group?.id)?.subtypeResults?.find(s=>s.subtypeId===id),original=job.serviceGaps?.specialties?.find(s=>s.subtypeId===id)?.walking_1km_gap;
  if(!sub||!definition||!original)return[];
  const search=specialtySearchEvidence(sub,definition,group,a.diagnostics?.searches?.find(s=>s.subtypeId===id)?.discardedCandidates,[...pool.values()]),center=a.searchWindow?.center??a.analysisLocation?.location??o.location,windowComplete=valid(center)&&a.searchRadiusMeters>=1000+straightDistanceMeters(o.location,center);
  const base={subtypeId:id,categoryId:group.id,scope:'origin_walking_1km',search,searchComplete:search.complete,gridEligible:false,diagnostic:original};
  // Historical snapshots without per-task records remain evidence-preserving.
  if(!search.hasTaskEvidence)return[{...base,legacyEvidence:true}];
  const diagnostics=[...new Map((sub.candidateDiagnostics??[]).filter(d=>d.classification?.candidateStatus==='pending_review').map(d=>[key(d),d])).values()],possible=diagnostics.filter(p=>relevant(p,id,definition)),confirmed=[...pool.values()].filter(p=>p.subtypeIds?.includes(id)),confirmedKeys=new Set(confirmed.map(key)),candidates=new Map([...confirmed,...possible.map(d=>({...d,...pool.get(key(d))}))].map(p=>[key(p),p]));
  const candidateEvidenceComplete=diagnostics.length>=(sub.pendingClassificationCount??0)&&!candidates.has(null)&&confirmed.length===sub.confirmedCandidateCount;
  const checked=[],verified=[],failures=[];for(const p of candidates.values()){
   const r=p.routeEvidence??p.circleRouteEvidence??allRoutes.get(key(p));
   // A negative result requires a real route and completed entrance selection.
   // Ambiguous school types remain ambiguous: a known>1km route only excludes
   // them from this origin's1km service scope, never from facility classification.
   if(!valid(p.location)||p.destinationConflict||!r||r.destinationConflict||!boundWalkingEvidence({...p,routeEvidence:r},o)||r.distanceMeters>1000&&r.entranceVerification?.complete===false){failures.push({identityKey:key(p),uid:p.uid,name:p.name,status:'unavailable'});continue;}
   checked.push({identityKey:key(p),uid:p.uid,name:p.name,location:p.location,distanceMeters:r.distanceMeters,evidenceId:r.evidenceId,classificationPending:!confirmedKeys.has(key(p)),status:r.distanceMeters<=1000?'within_1km':'outside_1km'});
   if(confirmedKeys.has(key(p)))verified.push(r);
  }
  verified.sort((a,b)=>a.distanceMeters-b.distanceMeters);const nearby=verified.filter(r=>r.distanceMeters<=1000),uncertainNearby=checked.some(p=>p.classificationPending&&p.distanceMeters<=1000),complete=search.complete&&windowComplete&&candidateEvidenceComplete&&!failures.length&&!uncertainNearby,status=nearby.length?'present':complete?'absent_in_declared_search':'unknown',reasons=[];
  if(!search.complete)reasons.push('required_search_incomplete');if(!windowComplete)reasons.push('origin_1km_window_not_fully_searched');if(!candidateEvidenceComplete||uncertainNearby)reasons.push('candidate_evidence_incomplete');if(failures.length)reasons.push('walking_evidence_incomplete');
  const diagnostic={...original,status,evidenceComplete:complete,noFacilityWithinOneKilometer:status==='present'?false:complete?true:null,nearbyCountLowerBound:nearby.length,nearestWithinOneKilometer:nearby[0]??null,nearestVerified:verified[0]??null,unknownReasons:reasons,evidenceSource:'scoped_query_pages_and_existing_walking',evidenceIds:checked.map(p=>p.evidenceId).filter(Boolean)};
  // An origin route>1km does not remove a facility's geographic support for
  // other grid cells. Retain all confirmed and relevant possible subtype POIs.
  const spatialConfirmed=confirmed.filter(p=>valid(p.location)).map(p=>({identityKey:key(p),uid:p.uid,name:p.name,location:p.location,walkingVerified:checked.some(r=>r.identityKey===key(p))})),spatialPotential=possible.map(d=>({...d,...pool.get(key(d))})).filter(p=>!confirmedKeys.has(key(p))&&valid(p.location)).map(p=>({identityKey:key(p),uid:p.uid,name:p.name,location:p.location}));
  return[{...base,diagnostic,pendingEvidenceComplete:candidateEvidenceComplete,walkingResults:[...checked,...failures],confirmedCandidateCount:confirmed.length,potentialCandidateCount:possible.length,gridEligible:status==='absent_in_declared_search'&&complete,spatialSupportScope:'subtype_poi_geometric_service_distance',confirmed:spatialConfirmed,potential:spatialPotential,excludedFromOriginOneKm:checked.filter(p=>p.distanceMeters>1000),queryProof:{queries:search.requiredQueries,packets:[...new Set(search.requiredTasks.filter(t=>t.complete).flatMap(t=>t.packets))],ignoredQueryErrors:search.auxiliaryErrors.map(e=>({keyword:e.keyword,code:e.code}))}}];
 });
}
export function specialtyGapEvidence(job,tree){return specialtyEvidenceRecords(job,tree).filter(r=>r.gridEligible);}

// Compatibility for an already running server or a historical compact snapshot
// which predates this projection. This GET reads saved audit evidence only;
// it never starts Place/Walking requests and never replaces the scored analysis.
export async function hydrateSpecialtyGapEvidence(job,tree,loadAudit){
 if(!valid(job?.analysis?.origin?.location)||hasCurrentServiceGapEvidence(job,tree))return job;
 const full=await loadAudit(job.analysisId);
 if(full?.analysisId!==job.analysisId||full.score?.evidenceFingerprint!==job.score?.evidenceFingerprint||full.analysis?.origin?.uid!==job.analysis.origin.uid||!valid(full.analysis?.origin?.location)||straightDistanceMeters(full.analysis.origin.location,job.analysis.origin.location)>.1)return job;
 if(hasCurrentServiceGapEvidence(full,tree))return{...job,serviceGapEvidence:structuredClone(full.serviceGapEvidence)};
 if(!job.serviceGapEvidence)return job;
 return{...job,serviceGapEvidence:{...job.serviceGapEvidence,specialtyEvidenceVersion:SPECIALTY_EVIDENCE_VERSION,specialties:specialtyEvidenceRecords(full,tree)}};
}
