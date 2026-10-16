import{computeCircleCosts}from'./circle-costs.mjs';
import{facilityIdentity,evaluateSubtypeAccess,prepareSubtypeCandidates}from'./nearest-facility.mjs';
import{facilityRouteCacheKey}from'./baidu-route.mjs';
import{summarizeFacilityGroups}from'./facility-analysis.mjs';
import{attachSearchDiagnostics}from'./evidence-diagnostics.mjs';
import{scoreSixGroupPriorities}from'./priority-score.mjs';
import{buildFacilityDisplay,fivePointScore}from'./facility-display.mjs';
import{representativeRoutes}from'./representative-routes.mjs';
import{assessServiceGaps}from'./service-gaps.mjs';
import{routeGeometryDrawable}from'./representative-routes.mjs';
import{knownSampleDiagnostics}from'./analysis-diagnostics.mjs';
// Explicit repair of a saved real analysis. Geometry and costs always update
// together; original snapshots remain immutable and no Place request is made.
export async function completeSavedFacilityPaths({job,provider,signal,onProgress=()=>{}}){
 const next=structuredClone(job),a=next.analysis,memo=new Map(),markers=new Map(a.poiMarkers.map(p=>[facilityIdentity(p),p]));
 const existing=[...a.categories.flatMap(g=>g.subtypeResults.flatMap(s=>s.routes??[])),...a.poiMarkers.map(p=>p.circleRouteEvidence).filter(Boolean)];
 for(const r of existing){if(!routeGeometryDrawable(r,a.origin))continue;const key=facilityRouteCacheKey(r.origin,r.destination,{originUid:r.originUid,destinationUid:r.destinationUid}),p=markers.get(r.identityKey);
  if(p){memo.set(key,Promise.resolve(r));memo.set(key+':geometry',Promise.resolve(r));}
 }
 const circle=await computeCircleCosts({candidates:a.poiMarkers,geometry:next,origin:a.origin,provider,routeMemo:memo,walkingModelId:a.walkingModelId,signal,onProgress,observedAt:new Date().toISOString(),searchRadiusMeters:a.searchRadiusMeters??1500});
 const costs=new Map(circle.facilities.map(p=>[p.identityKey,p.routeEvidence]));
 const pois=a.poiMarkers.map(p=>({...p,circleRouteEvidence:costs.get(facilityIdentity(p))??p.circleRouteEvidence})),refreshed=[];
 for(const sub of a.categories.flatMap(g=>g.subtypeResults)){
  const facilities=pois.filter(p=>p.subtypeIds?.includes(sub.subtypeId)||p.queriedSubtypeIds?.includes(sub.subtypeId));
  const prepared=prepareSubtypeCandidates({demandPoint:a.origin,categoryMappingVersion:a.categoryMappingVersion,subtypeId:sub.subtypeId,facilities});
  const access=await evaluateSubtypeAccess({demandPoint:a.origin,categoryMappingVersion:a.categoryMappingVersion,subtypeId:sub.subtypeId,facilities,preparedCandidates:prepared,walkingModelId:a.walkingModelId,searchRadiusMeters:a.searchRadiusMeters??1500,searchComplete:sub.searchComplete,maxRouteCandidates:1000,captureGeometry:true,routeMemo:memo,provider:{route:async()=>({routeStatus:'not_verified'})},signal,observedAt:new Date().toISOString()});
  refreshed.push({...sub,...attachSearchDiagnostics(access,{searchComplete:sub.searchComplete,pages:sub.searchPages??[],errors:sub.searchErrors??[]})});
 }
 const categories=summarizeFacilityGroups(refreshed,pois,a.categoryMappingVersion);
 next.analysis={...a,poiMarkers:pois,circleCosts:circle,categories,status:refreshed.every(s=>s.nearestComplete)?'complete':'partial',...(a.auxiliaryMetrics?{auxiliaryMetrics:knownSampleDiagnostics(categories)}:{}),...(a.diagnostics?{diagnostics:{...a.diagnostics,candidates:refreshed.flatMap(sub=>(sub.candidateDiagnostics??[]).map(candidate=>({...candidate,subtypeId:sub.subtypeId})))}}:{})};
 next.status=next.analysis.status;next.score=scoreSixGroupPriorities({analysis:next.analysis,priorities:Object.fromEntries(job.score.categories.map(g=>[g.categoryId,g.priority]))});
 next.display=buildFacilityDisplay(next);next.scoreDisplay=fivePointScore(next.score);next.representativeRoutes=representativeRoutes(next.analysis);next.serviceGaps=assessServiceGaps(next.analysis);
 next.pathCompletion={version:'real-walking-path-completion-v1',completedAt:new Date().toISOString(),sourceEvidenceFingerprint:job.score.evidenceFingerprint,source:'existing_paths_then_real_walking',pathAudit:next.display.pathAudit};return next;
}
