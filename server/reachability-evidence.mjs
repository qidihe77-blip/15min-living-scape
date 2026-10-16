import{decisionSeconds,withinWalkingLimit,WALKING80_MODEL}from'../web/walking-model.js';
import { validBd09ll } from './walking-provider.mjs';
import {validateBoundaryRing} from './boundary-geometry.mjs';
import {boundaryContainsPoint} from '../web/sample-boundary.js';

function routeLines(geometry) {
  const lines=geometry?.type==='LineString'?[geometry.coordinates]:geometry?.type==='MultiLineString'?geometry.coordinates:[];
  return Array.isArray(lines) && lines.length && lines.every(line=>Array.isArray(line) && line.length>=2
    && line.every(p=>Array.isArray(p) && p.length===2 && p.every(Number.isFinite)
      && Math.abs(p[0])<=180 && Math.abs(p[1])<=90))?lines:[];
}

const validRing = (ring) => Array.isArray(ring) && ring.length >= 4
  && ring.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)
    && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90)
  && new Set(ring.slice(0,-1).map((p) => p.join(','))).size >= 3
  && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]
  && Math.abs(ring.slice(0,-1).reduce((area,p,i)=>area+p[0]*ring[i+1][1]-ring[i+1][0]*p[1],0))>1e-12
  && validateBoundaryRing(ring).valid;
export function validWalkingSamplingSnapshot(geometry, origin, expectedOriginUid = undefined) {
  return Boolean(geometry?.geometrySource==='walking_sampling_fallback' && geometry.coordinateSystem==='BD-09LL'
    && geometry.thresholdSeconds===900 && validBd09ll(geometry.center) && validBd09ll(origin)
    && Math.abs(geometry.center.lat-origin.lat)<=.000001 && Math.abs(geometry.center.lng-origin.lng)<=.000001
    && (expectedOriginUid===undefined || (geometry.originUid ?? null)===(expectedOriginUid ?? null))
    && ['sampled_approximation','unknown'].includes(geometry.geometryStatus)
    && geometry.geojson?.type==='FeatureCollection' && Array.isArray(geometry.geojson.features)
    && geometry.geojson.features.every(f=>{
      const g=f.geometry;
      if(g?.type==='LineString'||g?.type==='MultiLineString')return routeLines(g).length>0;
      if(g?.type==='Polygon'){
        const proxy=geometry.algorithmVersion==='walking-sample-cells-v2'&&['sample_cell','refined_sample_cell'].includes(f.properties?.featureType)&&f.properties?.geometryConfidence==='visual_proxy_at_sample_only';
        return Array.isArray(g.coordinates)&&g.coordinates.length>0&&g.coordinates.every(validRing)
         &&(proxy||boundaryContainsPoint(g.coordinates[0],origin)&&!g.coordinates.slice(1).some(r=>boundaryContainsPoint(r,origin)));
      }
      return false;
    }));
}
export function validOfficialWalkingRange(geometry, origin) {
  const sameOrigin = validBd09ll(geometry?.center) && validBd09ll(origin)
    && Math.abs(geometry.center.lng-origin.lng) <= .000001 && Math.abs(geometry.center.lat-origin.lat) <= .000001;
  return Boolean(geometry?.geometrySource === 'baidu_isochrone' && geometry.mode === 'walking'
    && geometry.thresholdSeconds === 900 && geometry.coordinateSystem === 'BD-09LL' && sameOrigin
    && geometry.geojson?.type === 'FeatureCollection' && geometry.geojson.features?.length
    && geometry.geojson.features.every((feature) => {
      const g=feature.geometry, p=feature.properties;
      const polygons=g?.type==='Polygon'?[g.coordinates]:g?.type==='MultiPolygon'?g.coordinates:[];
      return p?.mode==='walking' && p.thresholdSeconds===900 && p.coordinateSystem==='BD-09LL'
        && polygons.length && polygons.every((rings)=>Array.isArray(rings) && rings.length && rings.every(validRing));
    }));
}
export function validOfficialDistanceRange(g,origin){return g?.geometrySource==='baidu_isodistance'&&g.walkingModelId===WALKING80_MODEL&&g.distanceLimitMeters===1200&&g.geojson?.features?.every(f=>f.properties?.walkingModelId===WALKING80_MODEL&&f.properties?.distanceLimitMeters===1200)&&validOfficialWalkingRange({...g,geometrySource:'baidu_isochrone'},origin);}
export function reachabilityEvidence(job) {
  const features=job.geojson?.features ?? [], routes=[], seen=new Set();
  const add=(row, source)=> {
    if(row.routeStatus!=='ok' || row.mode!=='walking' || row.coordinateSystem!=='BD-09LL'
      || !Number.isFinite(row.durationSeconds) || row.durationSeconds<0 || !withinWalkingLimit(row)
      || !Number.isFinite(row.distanceMeters) || row.distanceMeters<0 || !routeLines(row.geometry).length)return;
    const key=JSON.stringify([row.geometry,row.durationSeconds]);if(seen.has(key))return;seen.add(key);
    routes.push({type:'Feature',geometry:structuredClone(row.geometry),properties:{featureType:'reachable_route',
      routeStatus:'ok',mode:'walking',coordinateSystem:'BD-09LL',durationSeconds:row.durationSeconds,
      walkingModelId:row.walkingModelId,modelDurationSeconds:row.modelDurationSeconds,distanceMeters:row.distanceMeters,evidenceId:row.evidenceId,geometrySource:source,
      retrievedAt:row.retrievedAt ?? null, durationScope:'whole_route',networkCompleteness:'partial'}});
  };
  for(const feature of features)if(feature.properties?.featureType==='reachable_route')add({...feature.properties,geometry:feature.geometry},'walking_sampling_fallback');
  for(const group of job.analysis?.categories ?? [])for(const sub of group.subtypeResults ?? [])
    for(const route of sub.routes ?? [])if(route.classification?.candidateStatus==='confirmed_by_rule')add(route,'facility_route');
  return {version:'walking-range-evidence-v1',mode:'walking',thresholdSeconds:900,coordinateSystem:'BD-09LL',
    rangeSource:job.geometrySource ?? 'none',rangeStatus:job.geometryStatus ?? 'unknown',
    continuousRangeAvailable:['baidu_isochrone','baidu_isodistance'].includes(job.geometrySource) && job.geometryStatus==='available',
    samplingDecision:job.reachabilityDecision ?? null,sampleMetrics:job.sampleMetrics ?? null,
    diagnostics:job.rangeDiagnostics ?? null,unknownRegions:job.rangeDiagnostics?.unknownRegions ?? {scope:'all_unverified'},
    provenance:job.geometryProvenance ?? null,
    errorBoundStatus:job.sampleMetrics?.errorBoundStatus ?? 'not_statistically_estimated',
    facilityEvidenceIndependent:true,networkCompleteness:'partial',networkRouteCount:routes.length,
    durationScope:'whole_route',requestStats:job.requestStats ?? null,
    warnings:[...(job.geometryWarnings ?? []),'有限路线不代表全部道路；整条路线颜色不代表分段到达时间。'],
    geojson:{type:'FeatureCollection',features:[...features.filter((f)=>f.properties?.featureType!=='reachable_route'),...routes],
      properties:{analysisId:job.analysisId,geometrySource:job.geometrySource ?? 'none',geometryStatus:job.geometryStatus ?? 'unknown',
        coordinateSystem:'BD-09LL',mode:'walking',thresholdSeconds:900,networkCompleteness:'partial'}}};
}
