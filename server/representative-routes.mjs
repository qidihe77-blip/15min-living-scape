import{withinWalkingLimit,decisionSeconds}from'../web/walking-model.js';
import {compareNearestFacilities} from './nearest-facility.mjs';
import {facilityRouteCacheKey} from './baidu-route.mjs';
import {validRoutePoint} from './route-geometry.mjs';
import {reasonDetail} from './evidence-diagnostics.mjs';
export function routeGeometryDrawable(row, origin) {
 if(!row || row.routeStatus!=='ok' || row.mode!=='walking' || row.coordinateSystem!=='BD-09LL'
  || !Number.isFinite(row.durationSeconds) || row.durationSeconds<0
  || !Number.isFinite(row.distanceMeters) || row.distanceMeters<0
  || facilityRouteCacheKey(row.origin,row.destination,{originUid:row.originUid,destinationUid:row.destinationUid})
   !== facilityRouteCacheKey(origin.location,row.destination,{originUid:origin.uid,destinationUid:row.destinationUid}))return false;
 const g=row.geometry, lines=g?.type==='LineString'?[g.coordinates]:g?.type==='MultiLineString'?g.coordinates:[];
 return Boolean(lines.length && lines.every(l=>Array.isArray(l)&&l.length>=2&&l.every(validRoutePoint)));
}
// Representative scoring routes retain their original <=15min contract.
export function routeDrawable(row,origin){return withinWalkingLimit(row)&&routeGeometryDrawable(row,origin);}
export function representativeRoutes(analysis) {
 return analysis.categories.map(group=>{
  const eligible=[...group.subtypeResults.flatMap(s=>s.routes),...(group.categoryOnlyRoutes??[])].filter(r=>r.routeStatus==='ok'
   && r.classification?.candidateStatus==='confirmed_by_rule' && Number.isFinite(r.durationSeconds)
   && r.durationSeconds>=0 && withinWalkingLimit(r) && Number.isFinite(r.distanceMeters)&&r.distanceMeters>=0);
  const row=eligible.sort(compareNearestFacilities)[0];
  const drawable=routeDrawable(row,analysis.origin);
  const reasonCode=!row?'no_verified_reachable_facility':drawable?null:row.geometryStatus==='not_requested'||!row.geometryStatus?'missing_path':row.geometryStatus;
  return {categoryId:group.categoryId,label:group.label,name:row?.name ?? null,uid:row?.facilityUid ?? null,
   identityKey:row?.identityKey ?? null,subtypeId:row?.subtypeId ?? null,origin:analysis.origin,
   destination:row?.destination ?? null,destinationUid:row?.destinationUid ?? null,evidenceId:row?.evidenceId ?? null,
   walkingModelId:row?.walkingModelId,modelDurationSeconds:row?.modelDurationSeconds,distanceMeters:row?.distanceMeters ?? null,durationSeconds:row?.durationSeconds ?? null,
   coordinateSystem:'BD-09LL',geometry:drawable?structuredClone(row.geometry):null,
   polyline:drawable?(row.geometry.type==='LineString'?[row.geometry.coordinates]:row.geometry.coordinates):[],
   drawable,evidenceStatus:row?'verified_cost':'unknown',nearestStatus:group.nearestStatus,
   geometryStatus:drawable?'provider_path':row?.geometryStatus ?? 'unavailable',geometryCompleteness:row?.geometryCompleteness ?? null,reasonCode,
   reason:reasonCode?reasonDetail(reasonCode):null};
 });
}
