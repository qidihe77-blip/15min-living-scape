import{SERVICE_FUNCTION_RULE_VERSION,SERVICE_FACETS,FUNCTION_STATUS,identifyFreshCapabilities}from'./service-capabilities.mjs';
import{straightDistanceMeters}from'./facility-coverage.mjs';
import{validBd09ll}from'./walking-provider.mjs';
export const SERVICE_FUNCTION_VERSION='walking-1km-service-functions-origin-v2';
export const poiIdentity=p=>p.uid?'uid:'+p.uid:p.identityKey??'anonymous:'+JSON.stringify([p.name,p.address,p.location]);
const point=p=>p?.location??p;
const same=(a,b)=>validBd09ll(point(a))&&validBd09ll(point(b))&&Math.abs(point(a).lng-point(b).lng)<=1e-6&&Math.abs(point(a).lat-point(b).lat)<=1e-6;
export function boundServiceCost(route,origin,poi){
 if(route?.routeStatus!=='ok'||route.mode!=='walking'||route.coordinateSystem!=='BD-09LL'||!Number.isFinite(route.distanceMeters)||route.distanceMeters<0||!Number.isFinite(route.durationSeconds)||route.durationSeconds<0||route.destinationConflict||poi.coordinateConflict)return false;
 const a=route.requestedOrigin??{location:point(route.origin),uid:route.originUid??route.origin?.uid??null},b=route.requestedDestination??{location:point(route.destination),uid:route.destinationUid??route.facilityUid??null};
 return same(a,origin)&&(a.uid??null)===(origin.uid??null)&&(b.uid??null)===(poi.uid??null)&&[poi.location,poi.naviLocation].filter(validBd09ll).some(p=>same(b,p));
}
export function mergeServicePois(rows){
 const out=new Map();for(const p of rows??[]){if(!validBd09ll(p?.location)||p.coordinateSystem&&p.coordinateSystem!=='BD-09LL')continue;const key=poiIdentity(p),old=out.get(key);
  if(!old){out.set(key,{...structuredClone(p),identityKey:key,businessEvidence:[...(p.businessEvidence??[])]});continue;}
  old.businessEvidence=[...new Map([...old.businessEvidence,...(p.businessEvidence??[])].map(e=>[JSON.stringify(e),e])).values()];old.rawCategoryTags=[...new Set([...(old.rawCategoryTags??[]),...(p.rawCategoryTags??[])])];old.subtypeIds=[...new Set([...(old.subtypeIds??[]),...(p.subtypeIds??[])])];
  if(straightDistanceMeters(old.location,p.location)>30)old.coordinateConflict=true;
 }return[...out.values()];
}
export function recordedServiceRoutes(job){return[...(job.display?.facilities??[]).map(p=>p.routeEvidence),...(job.analysis?.categories??[]).flatMap(g=>g.subtypeResults.flatMap(s=>s.routes??[])),...(job.analysis?.poiMarkers??[]).map(p=>p.circleRouteEvidence)].filter(Boolean);}
export function serviceCostIndex(routes){
 const index=new Map(),key=r=>(r.requestedDestination?.uid??r.destinationUid??r.facilityUid??null);
 const add=r=>{const k=key(r),list=index.get(k)??[];list.push(r);index.set(k,list);};routes.forEach(add);
 return{add,get(origin,p){let best=null;for(const r of index.get(p.uid??null)??[])if(boundServiceCost(r,origin,p)&&(!best||r.distanceMeters<best.distanceMeters))best=r;return best;}};
}
export function existingServicePois(job){return mergeServicePois([...(job.display?.facilities??[]),...(job.analysis?.poiMarkers??[]),...(job.analysis?.categories??[]).flatMap(g=>g.poiMarkers??[])]);}
export function serviceSearchComplete(search,origin){return Boolean(search?.complete===true&&!search.truncated&&validBd09ll(search.center)&&Number.isFinite(search.radiusMeters)&&straightDistanceMeters(origin.location,search.center)+1000<=search.radiusMeters+1&&search.queryScope==='fresh_food_and_supermarkets');}
export function diagnoseFreshService({origin,candidates,search,getCost}){
 const missing=new Set(SERVICE_FACETS),facets={},witnesses=[],uncertain=[],outOfRange=[];
 for(const p of candidates){const cap=p.capabilities??identifyFreshCapabilities(p);if(!cap.candidate)continue;
  if(straightDistanceMeters(origin.location,p.location)>1001){outOfRange.push({identityKey:p.identityKey,reason:'geometric_lower_bound_exceeds_1km'});continue;}
  if(p.coordinateConflict){uncertain.push({identityKey:p.identityKey,reason:'conflicting_branch_coordinates',facets:SERVICE_FACETS});continue;}
  if(cap.confidence==='insufficient'&&!cap.deniedFacets.length){uncertain.push({identityKey:p.identityKey,reason:'branch_business_evidence_insufficient',facets:SERVICE_FACETS});continue;}
  const supplied=SERVICE_FACETS.filter(f=>cap.facets[f]);if(!supplied.length)continue;const r=getCost(origin,p);
  if(!boundServiceCost(r,origin,p)){uncertain.push({identityKey:p.identityKey,reason:r?.routeStatus??'walking_cost_missing',facets:supplied});continue;}
  if(r.distanceMeters>1000){outOfRange.push({identityKey:p.identityKey,distanceMeters:r.distanceMeters,evidenceId:r.evidenceId,reason:'verified_walking_exceeds_1km'});continue;}
  const witness={identityKey:p.identityKey,uid:p.uid??null,name:p.name,location:p.location,distanceMeters:r.distanceMeters,walkingEvidenceId:r.evidenceId??null,walkingSource:r.source??null,walkingRetrievedAt:r.retrievedAt??null,walkingBinding:{origin:r.requestedOrigin??{uid:r.originUid??null,location:point(r.origin)},destination:r.requestedDestination??{uid:r.destinationUid??null,location:point(r.destination)},mode:r.mode,coordinateSystem:r.coordinateSystem},capabilityEvidence:cap.evidence};witnesses.push(witness);
  for(const f of supplied){missing.delete(f);const candidate={...witness,confidence:cap.facets[f].level,evidence:cap.facets[f].evidence};if(!facets[f]||facets[f].confidence!=='explicit'&&candidate.confidence==='explicit'||facets[f].confidence===candidate.confidence&&candidate.distanceMeters<facets[f].distanceMeters)facets[f]=candidate;}
 }
 const all=missing.size===0,complete=serviceSearchComplete(search,origin),blocking=uncertain.filter(p=>p.facets.some(f=>missing.has(f))),status=all?Object.values(facets).every(f=>f.confidence==='explicit')?'confirmed_covered':'high_confidence_substitute':complete&&!blocking.length?'confirmed_missing':'pending_verification';
 return{functionId:'daily_fresh_food',label:'日常生鲜购买服务',status,statusLabel:FUNCTION_STATUS[status],ruleVersion:SERVICE_FUNCTION_RULE_VERSION,thresholdMeters:1000,distanceDefinition:'provider_walking_distance_meters',facets,missingFacets:[...missing],partialCoverage:witnesses.length>0&&!all,comprehensiveFreshSupply:all,witnesses:[...new Map(witnesses.map(w=>[w.identityKey,w])).values()],outOfRange,unknownCandidates:blocking,searchComplete:complete,reasonCodes:all?[status==='confirmed_covered'?'all_fresh_facets_with_explicit_branch_evidence':'all_fresh_facets_with_labelled_inference']:[...(!complete?['function_search_incomplete_for_1km_window']:[]),...(blocking.length?['candidate_business_or_walking_evidence_missing']:[]),...(complete&&!blocking.length?['fresh_bundle_missing_in_declared_search']:[])],absenceScope:status==='confirmed_missing'?'returned_candidates_and_declared_queries_only':null};
}
export function assessServiceFunctions({job,candidates=existingServicePois(job),search=null,routes=recordedServiceRoutes(job),requestStats={},enrichmentState='not_started'}={}){
 const pool=mergeServicePois(candidates).map(p=>({...p,capabilities:identifyFreshCapabilities(p)})),costs=serviceCostIndex(routes),mapKeys=new Set(existingServicePois(job).map(p=>p.identityKey)),origin=diagnoseFreshService({origin:job.analysis.origin,candidates:pool,search,getCost:(o,p)=>costs.get(o,p)});
 return{version:SERVICE_FUNCTION_VERSION,ruleVersion:SERVICE_FUNCTION_RULE_VERSION,analysisId:job.analysisId,sourceEvidenceSnapshotId:job.score.evidenceFingerprint,origin:job.analysis.origin,scope:'analysis_origin_only',thresholdMeters:1000,affectsOverallScore:false,taxonomyUnchanged:true,automatedOnly:true,createdAt:new Date().toISOString(),enrichmentState,originDiagnostic:origin,search,candidates:pool.filter(p=>p.capabilities.candidate).map(p=>({identityKey:p.identityKey,uid:p.uid??null,name:p.name,location:p.location,capabilities:p.capabilities,existingMapPoi:mapKeys.has(p.identityKey)})),requestStats,limitations:['仅判断分析起点的真实步行1公里生鲜服务，不推断区域盲区。','连锁品牌不代表门店经营能力，水果单项不等同完整生鲜替代。','检索截断、门店证据不足或路径失败保留未知，不改变综合评分。']};
}
