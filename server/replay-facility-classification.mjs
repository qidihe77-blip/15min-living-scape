import{createHash}from'node:crypto';
import{facilityCategoryTree,classifyV3FacilityCandidate}from'./facility-categories.mjs';
import{createFacilityAnalysis}from'./facility-analysis.mjs';
import{facilityRouteCacheKey}from'./baidu-route.mjs';
import{scoreSixGroupPriorities}from'./priority-score.mjs';
import{buildFacilityDisplay,fivePointScore}from'./facility-display.mjs';
import{assessServiceGaps}from'./service-gaps.mjs';
import{serviceGapEvidence}from'./service-gap-evidence.mjs';
import{representativeRoutes}from'./representative-routes.mjs';
import{reachabilityEvidence}from'./reachability-evidence.mjs';

// Explicit offline replay; never changes an archive, calls a provider or guesses
// a cost for a newly classified candidate. The original geometry stays byte exact.
export async function replayFacilityClassification(source,{sourceSHA256=null}={}){
 const a=source?.analysis;if(source?.presentationOnly||a?.categoryMappingVersion!=='facility-categories-v8'||!Array.isArray(a.poiMarkers)||!a.categories?.every(g=>Array.isArray(g.subtypeResults))||!source.score)throw TypeError('A full v8 saved analysis is required');
 const at=performance.now(),tree=facilityCategoryTree(a.categoryMappingVersion),defs=tree.categories.flatMap(g=>g.subtypes.map(s=>({...s,categoryId:g.id}))),pool=structuredClone(a.poiMarkers),subtypes=new Map(a.categories.flatMap(g=>g.subtypeResults).map(s=>[s.subtypeId,s])),costs=new Map();
 for(const r of[...a.categories.flatMap(g=>[...g.subtypeResults.flatMap(s=>s.routes??[]),...g.categoryOnlyRoutes??[]]),...a.poiMarkers.map(p=>p.circleRouteEvidence),...source.display?.facilities?.map(p=>p.routeEvidence)??[]]){
  if(r?.routeStatus!=='ok'||r.mode!=='walking'||r.coordinateSystem!=='BD-09LL')continue;
  try{const key=facilityRouteCacheKey(r.requestedOrigin?.location??r.origin,r.requestedDestination?.location??r.destination,{originUid:r.requestedOrigin?.uid??r.originUid,destinationUid:r.requestedDestination?.uid??r.destinationUid}),old=costs.get(key);if(!old||!old.geometry&&r.geometry)costs.set(key,r);}catch{/* Invalid bindings never become cached costs. */}
 }
 const searches=new Map(defs.map(s=>{const old=subtypes.get(s.id);if(!old)throw TypeError('All18 saved subtype results are required');return[s.id,{status:old.searchStatus??'partial',searchComplete:old.searchComplete===true,truncated:old.searchTruncated===true,invalidCandidateCount:old.invalidCandidateCount??0,errors:old.searchErrors??[],pages:old.searchPages??[],queryPlan:[...new Set((old.searchPages??[]).map(p=>p.keyword))],candidates:pool}];}));
 let cacheHits=0,unrecordedTargets=0;
 const provider={route:async(origin,destination,options)=>{const r=costs.get(facilityRouteCacheKey(origin,destination,options));if(r){cacheHits++;return structuredClone(r);}unrecordedTargets++;return{routeStatus:'not_in_recorded_evidence',distanceMeters:null,durationSeconds:null};},stats:()=>({queueConcurrency:4})};
 const geometry={geometrySource:source.geometrySource,geojson:source.geojson},analysis=await createFacilityAnalysis({placeProvider:{searchAround:()=>{throw Error('Offline replay forbids Place requests');}},routeProvider:provider}).analyze({origin:a.origin,analysisLocation:a.analysisLocation??a.origin,categoryMappingVersion:tree.version,walkingModelId:a.walkingModelId,routeScope:a.routeScope??'circle_candidates',maxRouteCandidatesPerSubtype:a.maxRouteCandidatesPerSubtype??3,searchRadiusMeters:a.searchRadiusMeters,geometry,region:a.region??'',preparedSearches:{searches,order:defs,subtypeCount:defs.length,candidatePool:pool,searchMs:0}});
 analysis.observedAt=a.observedAt;analysis.classificationVersion=tree.classificationVersion;
 const hash=sourceSHA256??createHash('sha256').update(JSON.stringify(source)).digest('hex'),digest=createHash('sha256').update(JSON.stringify([hash,tree.classificationVersion,'classification-replay-v1'])).digest('hex').slice(0,32),id='fa-'+[digest.slice(0,8),digest.slice(8,12),digest.slice(12,16),digest.slice(16,20),digest.slice(20)].join('-');
 const score=scoreSixGroupPriorities({analysis,priorities:source.score.priorities}),job={...structuredClone(source),analysisId:id,status:analysis.status,analysis:{...analysis,analysisId:id},score,scoreDisplay:fivePointScore(score),finishedAt:new Date().toISOString(),classificationReplay:{version:'classification-replay-v1',classificationVersion:tree.classificationVersion,sourceAnalysisId:source.analysisId,sourceSHA256:hash,newPlaceRequests:0,newWalkingRequests:0,cacheHits,unrecordedTargets,computeMs:performance.now()-at,performanceScope:'source timing and request counters retained; no new API performance measurement'}};
 job.display=buildFacilityDisplay(job);job.serviceGaps=assessServiceGaps(job.analysis);job.serviceGapEvidence=serviceGapEvidence(job);job.representativeRoutes=representativeRoutes(job.analysis);job.reachability=reachabilityEvidence(job);
 const changes=a.poiMarkers.map(p=>{const next=classifyV3FacilityCandidate(p,tree.version);return{uid:p.uid,identityKey:p.identityKey,name:p.name,rawCategory:p.rawCategory,rawCategoryTags:p.rawCategoryTags,before:p.subtypeIds??[],after:next.subtypeIds,reasons:next.memberships.filter(m=>(p.subtypeIds??[]).includes(m.subtypeId)&&!next.subtypeIds.includes(m.subtypeId)).map(m=>({subtypeId:m.subtypeId,reason:m.reason,evidence:m.ruleEvidence})),walkingDistanceMeters:p.circleRouteEvidence?.distanceMeters??null};}).filter(p=>JSON.stringify(p.before)!==JSON.stringify(p.after));
 return{job,changes};
}
