import{hasConfirmedFacilityMembership}from'../web/facility-membership.js';
import{walkingRangePolygons,insideWalkingRange}from'../web/circle-presentation.js';
import{facilityIdentity,bindFacilityRouteEvidence}from'./nearest-facility.mjs';
import{facilityRouteCacheKey}from'./baidu-route.mjs';
import{validBd09ll}from'./walking-provider.mjs';
import{orderedBatches}from'./bounded-batches.mjs';
import{routeFacilityCandidate,facilityWalkingTargets}from'./facility-endpoints.mjs';
import{straightDistanceMeters}from'./facility-coverage.mjs';

// Polygon membership allocates work; only bound real costs decide walking reachability.
export async function computeCircleCosts({candidates,geometry,origin,provider,routeMemo=new Map(),walkingModelId,signal,onProgress=()=>{},observedAt,searchRadiusMeters=1500}){
 const polygons=walkingRangePolygons(geometry),unique=new Map(),unclassified=[],outsideWindow=[];
 // A missing sampled polygon is missing geometry, not evidence of zero reachable facilities.
 // The declared Place window is already bounded; only real Walking costs confirm reachability.
 for(const p of candidates){
  if(straightDistanceMeters(origin.location,p.location)>searchRadiusMeters+2){outsideWindow.push({uid:p.uid,reasonCode:'outside_declared_search_window'});continue;}
  if(!hasConfirmedFacilityMembership(p)||p.candidateStatus!=='confirmed_by_rule'){unclassified.push({identityKey:facilityIdentity(p),uid:p.uid,reasonCode:'classification_not_confirmed'});continue;}
  unique.set(facilityIdentity(p),p);
 }
 const selected=[...unique.values()].sort((a,b)=>Number(insideWalkingRange(b.location,polygons))-Number(insideWalkingRange(a.location,polygons))),facilities=[];let completed=0;
 const repairTarget=p=>!p.stationName&&validBd09ll(p.location)&&Boolean(p.uid);
 provider.allocateCircleCosts?.(selected.reduce((n,p)=>n+facilityWalkingTargets(p,origin).length+(repairTarget(p)?1:0),0));
 onProgress({phase:'circle_poi_routes',completed,total:selected.length});
 await orderedBatches(selected,async p=>{
  if(signal?.aborted)throw signal.reason;
  const options={mode:'walking',captureGeometry:true,originUid:origin.uid,destinationUid:p.uid,walkingModelId,signal};
  const raw=await routeFacilityCandidate({facility:p,origin,provider,routeMemo,options});
  const bind=route=>bindFacilityRouteEvidence({route,demandPoint:origin,facility:p,classification:{candidateStatus:p.candidateStatus,subtypeIds:p.subtypeIds},walkingModelId,observedAt});
  let routeEvidence=bind(raw);
  if(routeEvidence.routeStatus==='ok'&&!routeEvidence.geometry&&(raw.geometry||raw.geometryStatus)&&repairTarget(p)&&['endpoint_geometry_mismatch','missing_path','invalid_path','not_provided','not_requested'].includes(routeEvidence.geometryStatus)){
   const target={uid:p.uid,location:p.location,source:'poi_geometry_repair'},repairOptions={...options,destinationUid:p.uid,destinationNavigation:'coordinates'},key=facilityRouteCacheKey(origin.location,target.location,repairOptions)+':coordinate_geometry';
   let work=routeMemo.get(key);if(!work){work=Promise.resolve().then(()=>provider.route(origin.location,target.location,repairOptions)).catch(e=>({routeStatus:e?.code??'upstream_unavailable'}));routeMemo.set(key,work);}
   const repairedRaw={...await work,facilityEndpoint:target},repaired=bind(repairedRaw);if(repaired.routeStatus==='ok'&&repaired.geometry){routeEvidence=repaired;const saved=Promise.resolve(repairedRaw),original=facilityRouteCacheKey(origin.location,raw.requestedDestination?.location??p.naviLocation,options);routeMemo.set(facilityRouteCacheKey(origin.location,target.location,repairOptions),saved);routeMemo.set(original,saved);routeMemo.set(original+':geometry',saved);}
  }
  facilities.push({identityKey:facilityIdentity(p),uid:p.uid,name:p.name,routeEvidence});
  onProgress({phase:'circle_poi_routes',completed:++completed,total:selected.length});
 },{concurrency:provider.stats?.().queueConcurrency??2,signal});
 const valid=facilities.filter(p=>p.routeEvidence.routeStatus==='ok').length,paths=facilities.filter(p=>p.routeEvidence.geometry).length;
 return{version:'candidate-walking-costs-v2',status:!polygons.length?'partial':valid===selected.length?'complete':'partial',reasonCode:!polygons.length?'walking_range_unavailable':valid<selected.length?'route_incomplete':null,
  source:'real_walking_routes',origin,coordinateSystem:'BD-09LL',selectedCount:selected.length,validCostCount:valid,failedCostCount:selected.length-valid,validPathCount:paths,missingPathCount:selected.length-paths,pathFailures:facilities.filter(p=>!p.routeEvidence.geometry).map(p=>({identityKey:p.identityKey,name:p.name,reasonCode:p.routeEvidence.routeStatus==='ok'?p.routeEvidence.geometryStatus:p.routeEvidence.routeStatus})),skippedUnclassified:[...new Map(unclassified.map(p=>[p.identityKey,p])).values()],
  scope:'classified_candidates_in_declared_search_window',polygonIsWalkingProof:false,skippedOutsideSearchWindow:outsideWindow,facilities};
}
