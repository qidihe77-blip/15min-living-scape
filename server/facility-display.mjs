import{confirmedCategoryIds}from'../web/facility-membership.js';
import{facilityCategoryTree}from'./facility-categories.mjs';
import{withinWalkingLimit}from'../web/walking-model.js';
import {classifyOfficialPoint} from './geometry.mjs';
import {routeGeometryDrawable} from './representative-routes.mjs';
import {facilityRouteCacheKey} from './baidu-route.mjs';
import {validOfficialWalkingRange,validOfficialDistanceRange} from './reachability-evidence.mjs';
import {walkingRangePolygons,insideWalkingRange} from '../web/circle-presentation.js';
import{boundWalkingEvidence}from'../web/reachable-presentation.js';
import{facilityAccessState}from'../web/facility-access-state.js';
export function fivePointScore(score) {
 const good=score?.scoreStatus==='scored'&&Number.isFinite(score.S_low)&&Number.isFinite(score.S_high);
 const convert=n=>Math.round(n/20*100)/100;
 return {scale:5,method:'original_weighted_score_divided_by_20',status:good?'scored':'not_scored',
  low:good?convert(score.S_low):null,high:good?convert(score.S_high):null,isExact:good&&score.isExact,
  categories:(score?.categories??[]).map(g=>({categoryId:g.categoryId,low:Number.isFinite(g.G_low)?convert(g.G_low):null,high:Number.isFinite(g.G_high)?convert(g.G_high):null})),
  evidenceFingerprint:score?.evidenceFingerprint??null};
}
function validCost(row,origin) {
 if(row?.routeStatus!=='ok'||row.mode!=='walking'||row.coordinateSystem!=='BD-09LL'||!Number.isFinite(row.durationSeconds)||row.durationSeconds<0||!Number.isFinite(row.distanceMeters)||row.distanceMeters<0)return false;
 try{return facilityRouteCacheKey(row.origin,row.destination,{originUid:row.originUid,destinationUid:row.destinationUid})===facilityRouteCacheKey(origin.location,row.destination,{originUid:origin.uid,destinationUid:row.destinationUid});}catch{return false;}
}
// Lists/geometry from the saved job only. Reading this projection makes zero provider calls.
export function buildFacilityDisplay(job) {
 const a=job?.analysis;if(!a)return null;
 const origin=a.origin,routes=new Map(),groupForSubtype=new Map(),markers=new Map((a.poiMarkers??[]).map(p=>[p.identityKey,p]));
 for(const group of a.categories)for(const sub of[...group.subtypeResults,{routes:group.categoryOnlyRoutes??[]}]){groupForSubtype.set(sub.subtypeId,group.categoryId);
  for(const row of sub.routes??[]){if(!validCost(row,origin)||!boundWalkingEvidence({...markers.get(row.identityKey),routeEvidence:row},origin))continue;const old=routes.get(row.identityKey);
   if(!old||row.distanceMeters<old.distanceMeters||(row.distanceMeters===old.distanceMeters&&(row.durationSeconds<old.durationSeconds||row.durationSeconds===old.durationSeconds&&!old.geometry&&row.geometry)))routes.set(row.identityKey,row);}}
 const range={geometrySource:job.geometrySource,geojson:job.geojson,center:origin.location,mode:'walking',thresholdSeconds:900,coordinateSystem:'BD-09LL',walkingModelId:a.walkingModelId,distanceLimitMeters:a.walkingModel?.distanceLimitMeters};
 const official=a.walkingModelId==='walking80-v1'?validOfficialDistanceRange(range,origin.location):validOfficialWalkingRange(range,origin.location);
 const polygons=walkingRangePolygons(job),hasRange=polygons.length>0,facilities=[];let outside=0,rangeDisagreements=0;
 for(const poi of a.poiMarkers??[]){
  const circleEvidence=poi.circleRouteEvidence;
  const saved=routes.get(poi.identityKey),circle=validCost(circleEvidence,origin)&&boundWalkingEvidence({...poi,routeEvidence:circleEvidence},origin)?circleEvidence:null;
  const route=saved&&circle&&saved.distanceMeters===circle.distanceMeters&&saved.durationSeconds===circle.durationSeconds&&!saved.geometry&&circle.geometry?circle:saved??circle,memberships=confirmedCategoryIds(poi,facilityCategoryTree(a.categoryMappingVersion??job.categoryMappingVersion));
  const location=poi.stationName&&route?.location?route.location:poi.location;
  const assessment=official?classifyOfficialPoint(range,location):hasRange?{status:insideWalkingRange(location,polygons)?'inside':'outside'}:{status:'unknown'};
  const circleInside=assessment.status==='inside'||assessment.status==='boundary';
  const reachable=Boolean(route&&withinWalkingLimit(route));
  // A provider boundary must not erase a bound real <=900s endpoint already used by scoring.
  const disagreement=hasRange&&!circleInside&&reachable;
  if(hasRange&&!circleInside&&!reachable)outside++;
  if(disagreement)rangeDisagreements++;
  let drawable=false;try{drawable=memberships.length>0&&routeGeometryDrawable(route,origin);}catch{}
  const pending=(poi.pendingSubtypeIds??[]).filter(id=>groupForSubtype.has(id));
  const status=!memberships.length?'classification_uncertain':reachable?'reachable':route?'over_threshold':'missing_walking_data';
  const access=facilityAccessState({hasRange,inside:circleInside,classified:memberships.length>0,validRoute:Boolean(route),reachable});
  facilities.push({...poi,location,categoryIds:memberships,displayCategoryIds:[...new Set([...memberships,...pending.map(id=>groupForSubtype.get(id))])],
   rangeMembership:hasRange?(circleInside?'inside':'outside'):reachable?'verified_reachable_endpoint':'unknown',...access,retrievalStatus:'returned',
   onMap:memberships.length>0&&(hasRange?circleInside||reachable:reachable),rangeRouteDisagreement:disagreement,displayStatus:status,
   statusText:{reachable:'可达',over_threshold:'超过15分钟',missing_walking_data:'暂无步行数据',classification_uncertain:'类别待确认'}[status],
   routeEvidence:route??null,walkingDataReasonCode:route?null:circleEvidence?.routeStatus==='ok'?'route_binding_mismatch':circleEvidence?.routeStatus??'not_requested',drawable,geometry:drawable?structuredClone(route.geometry):null,
   walkingModelId:route?.walkingModelId,modelDurationSeconds:route?.modelDurationSeconds,durationSeconds:route?.durationSeconds??null,distanceMeters:route?.distanceMeters??null});
 }
 facilities.sort((x,y)=>(x.displayStatus==='reachable'?0:1)-(y.displayStatus==='reachable'?0:1)||(x.distanceMeters??Infinity)-(y.distanceMeters??Infinity)||x.identityKey.localeCompare(y.identityKey));
 const drawableRoutes=facilities.filter(p=>p.drawable).map(p=>({identityKey:p.identityKey,uid:p.uid,name:p.name,
  categoryIds:p.categoryIds,subtypeIds:p.subtypeIds,geometry:p.geometry,origin, destination:p.routeEvidence.destination,
  originUid:origin.uid??null,destinationUid:p.routeEvidence.destinationUid,coordinateSystem:'BD-09LL',mode:'walking',
  facilityUid:p.routeEvidence.facilityUid,reachabilityState:p.displayStatus,walkingModelId:p.walkingModelId,modelDurationSeconds:p.modelDurationSeconds,durationSeconds:p.durationSeconds,distanceMeters:p.distanceMeters,evidenceId:p.routeEvidence.evidenceId}));
 const complete=a.categories.every(g=>g.subtypeResults.every(s=>s.nearestComplete)&&(g.categoryOnlyRoutes??[]).every(r=>r.routeStatus==='ok'));
 return {version:'facility-display-v2',scope:official?'official_walking_range':hasRange?'sampled_walking_range':'declared_search_window',rangeAvailable:hasRange,
  rangeSource:hasRange?job.geometrySource:'none',continuousRangeAvailable:official,searchWindow:a.searchWindow,
  facilities,routes:drawableRoutes,totalListed:facilities.length,totalMapFacilities:facilities.filter(p=>p.onMap).length,
  totalReachable:facilities.filter(p=>p.displayStatus==='reachable').length,missingWalkingData:facilities.filter(p=>!p.routeEvidence).length,
  pathAudit:{classified:facilities.filter(p=>p.categoryIds.length).length,withPath:facilities.filter(p=>p.drawable).length,missing:facilities.filter(p=>p.categoryIds.length&&!p.drawable).map(p=>({identityKey:p.identityKey,name:p.name,onMap:p.onMap,reasonCode:p.routeEvidence?.geometryStatus??p.walkingDataReasonCode})),mapWithPath:facilities.filter(p=>p.onMap&&p.drawable).length,mapWithoutPath:facilities.filter(p=>p.onMap&&!p.drawable).length},
  routesWithoutGeometry:facilities.filter(p=>p.displayStatus==='reachable'&&!p.drawable).length,outsideOmitted:outside,rangeRouteDisagreements:rangeDisagreements,complete,
  countScope:'verified_15min_reachable_in_declared_search_window',accessStateCounts:Object.fromEntries(['inside_reachable','inside_over_threshold','outside_reachable','outside_over_threshold','pending_verification','pending_range_membership'].map(s=>[s,facilities.filter(p=>p.accessState===s).length])),
  note:rangeDisagreements?'边界与真实Walking存在差异；已保留并计入圈外真实可达设施。':hasRange?'范围仅作空间参考；数量统计仅计Walking核实15分钟可达设施，灰色待核验或超时点不计入。':official?complete?'已显示本次检索范围内的设施与真实可达路线。':'部分设施暂无步行数据，本次结果尚未完整。'
   :'15分钟步行范围暂不可用；列表为本次周边检索结果，地图仅显示已知可达设施与真实路线。'};
}
