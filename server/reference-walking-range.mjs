import{routePrefixAtDistance}from'../web/route-distance-prefix.js';
import {orderedBatches} from './bounded-batches.mjs';
import {routeLines} from '../web/walking-network.js';
import {modelRoute,WALKING80_MODEL} from '../web/walking-model.js';
import {straightDistanceMeters} from './facility-coverage.mjs';
import {validBd09ll} from './walking-provider.mjs';
import {cleanSampleBoundary} from './boundary-geometry.mjs';
export const REFERENCE_RANGE_VERSION='reference-walking-32-rays-v1';
export const REFERENCE_SAMPLE_COUNT=32;
export function rayDestination(center,bearing,distance=1800){const r=distance/6371000,a=bearing*Math.PI/180,lat=center.lat*Math.PI/180,lng=center.lng*Math.PI/180;
 const y=Math.asin(Math.sin(lat)*Math.cos(r)+Math.cos(lat)*Math.sin(r)*Math.cos(a));
 const x=lng+Math.atan2(Math.sin(a)*Math.sin(r)*Math.cos(lat),Math.cos(r)-Math.sin(lat)*Math.sin(y));return{lat:y*180/Math.PI,lng:(x*180/Math.PI+540)%360-180};}
// Interpolate ON a provider segment, never between absent routes. The point is an estimate,
// not a separately requested ≤900-second witness. POIs still require their own real cost.
export{routePrefixAtDistance}from'../web/route-distance-prefix.js';
export async function sampleReferenceWalkingRange({center,originUid=null,provider,maxRouteCalls=32,sampleCount=32,maxRepairCalls=0,signal,onProgress=()=>{}}){
 if(!validBd09ll(center)||Math.abs(center.lat)>=85||!provider?.route||!Number.isInteger(maxRouteCalls)||maxRouteCalls<0||maxRouteCalls>88)throw new TypeError('Bounded real-route sampling required.');
 if(![32,36].includes(sampleCount))throw new RangeError('32 or36 directions required.');
 if(!Number.isInteger(maxRepairCalls)||maxRepairCalls<0||maxRepairCalls>8)throw new RangeError('At most8 bounded real repair probes.');
 const count=Math.min(sampleCount,maxRouteCalls),samples=[],boundaries=[];let calls=0,repairCalls=0,stopped=false;
 await orderedBatches(Array.from({length:count},(_,i)=>i),async i=>{if(stopped||signal?.aborted)return;calls++;let radius=1800,target=rayDestination(center,i*360/sampleCount),route;
  try{route=modelRoute(await provider.route(center,target,{originUid}),WALKING80_MODEL);}catch{route={routeStatus:'upstream_unavailable'};}
  const bound=(e,p,uid)=>validBd09ll(e?.location)&&Math.abs(e.location.lng-p.lng)<=1e-6&&Math.abs(e.location.lat-p.lat)<=1e-6&&(e.uid??null)===(uid??null);
  const p=a=>({lng:a[0],lat:a[1]});
  const inspect=()=>{const lines=routeLines(route.geometry),cost=route.routeStatus==='ok'&&route.mode==='walking'&&route.coordinateSystem==='BD-09LL'&&Number.isFinite(route.modelDurationSeconds)
   &&bound(route.requestedOrigin,center,originUid)&&bound(route.requestedDestination,target,null);
  const pathBound=cost&&lines.length&&straightDistanceMeters(route.providerOrigin??center,p(lines[0][0]))<=150
   &&straightDistanceMeters(route.providerDestination??route.destination??target,p(lines.at(-1).at(-1)))<=150;
  return{cost,prefix:pathBound?routePrefixAtDistance(route):{point:null,reasonCode:cost?'endpoint_geometry_mismatch':route.routeStatus==='ok'?'invalid_route_binding':route.routeStatus}};};
  let{cost,prefix}=inspect();const repairAttempts=[];
  for(const closer of[1600,1400]){if(prefix.point||prefix.reasonCode!=='endpoint_geometry_mismatch'||count!==sampleCount||repairCalls>=maxRepairCalls||stopped||signal?.aborted)break;
   repairAttempts.push({radiusMeters:radius,reasonCode:prefix.reasonCode,evidenceId:route.evidenceId??null});repairCalls++;calls++;radius=closer;target=rayDestination(center,i*360/sampleCount,radius);
   try{route=modelRoute(await provider.route(center,target,{originUid}),WALKING80_MODEL);}catch{route={routeStatus:'upstream_unavailable'};}({cost,prefix}=inspect());
  }
  const sample={...route,sector:i,bearingDegrees:i*360/sampleCount,lat:target.lat,lng:target.lng,radiusMeters:radius,repairAttempts,
   coverageStatus:cost?route.modelDurationSeconds<=900?'covered':'over_threshold':'unknown',sampleStage:'reference_far_ray',boundaryEstimate:prefix};samples.push(sample);
  if(prefix.point)boundaries.push({sector:i,point:prefix.point,prefix:prefix.prefix,costStatus:prefix.costStatus});
  if(provider.stats?.().stopped||['permission_denied','quota_exhausted','rate_limited','route_service_error'].includes(route.routeStatus))stopped=true;
  onProgress({phase:'reference_walking_sampling',completed:samples.length,total:sampleCount,routeCalls:calls});
 },{concurrency:provider.stats?.().queueConcurrency??2,signal});
 // Choose the same representative for nearby ray endpoints regardless of
 // response completion order. Distances, 8m threshold and boundary method stay intact.
 samples.sort((a,b)=>a.sector-b.sector);boundaries.sort((a,b)=>a.sector-b.sector);
 const unique=[];for(const b of boundaries)if(!unique.some(a=>straightDistanceMeters({lng:a.point[0],lat:a.point[1]},{lng:b.point[0],lat:b.point[1]})<8))unique.push(b);
 unique.sort((a,b)=>Math.atan2(a.point[1]-center.lat,(a.point[0]-center.lng)*Math.cos(center.lat*Math.PI/180))-Math.atan2(b.point[1]-center.lat,(b.point[0]-center.lng)*Math.cos(center.lat*Math.PI/180)));
 const complete=boundaries.length===sampleCount,cleaned=complete?cleanSampleBoundary(unique.map(b=>b.point),{center}):{ring:null,reasonCode:'incomplete_reference_directions'};
 const features=cleaned.ring?[{type:'Feature',geometry:{type:'Polygon',coordinates:[cleaned.ring]},properties:{featureType:'sampled_boundary',geometrySource:'walking_sampling_fallback',walkingModelId:WALKING80_MODEL,coordinateSystem:'BD-09LL',
  geometryConfidence:'provider_polyline_prefix_estimate',interiorStatus:'unknown_between_samples',label:sampleCount+'方向真实步行路径采样近似范围'}}]:[];
 return{algorithmVersion:REFERENCE_RANGE_VERSION,walkingModelId:WALKING80_MODEL,coordinateSystem:'BD-09LL',mode:'walking',thresholdSeconds:900,distanceLimitMeters:1200,center,originUid,
  geometrySource:'walking_sampling_fallback',geometryStatus:cleaned.ring?'sampled_approximation':'unknown',status:'partial',samples,geojson:{type:'FeatureCollection',features},
  sampleMetrics:{attemptedRouteCalls:calls,maxRouteCalls:count+maxRepairCalls,repairRouteCalls:repairCalls,requestedDirections:sampleCount,validRoutePoints:samples.filter(s=>s.coverageStatus!=='unknown').length,validSectors:boundaries.length,uniqueBoundaryVertices:unique.length,
   continuousRangeAvailable:false,errorBoundStatus:'not_statistically_estimated',providerFailure:provider.stats?.().lastFailure??null},
  samplingDiagnostics:{version:REFERENCE_RANGE_VERSION,sampleCount,farDistanceMeters:1800,speedMetersPerMinute:80,walkMinutes:15,targetDistanceMeters:1200,
   boundaryMethod:'interpolate_on_true_provider_polyline_by_distance_share',boundaryCostStatus:'estimated_not_separate_route_witness',boundaryReasonCode:cleaned.reasonCode,
   failedSamples:samples.filter(s=>!s.boundaryEstimate.point).map(s=>({sector:s.sector,reasonCode:s.boundaryEstimate.reasonCode})),deduplicatedVertices:boundaries.length-unique.length,repairRouteCalls:repairCalls,repairMethod:repairCalls?'shorter_same_bearing_real_walking_probe':null,
   matrixUsed:false,matrixReason:'not_verified_and_path_geometry_required',officialApisUsed:false},
  unknownRegions:{continuousRangeAvailable:false,unmeasuredInterior:true,betweenSamplesStatus:'unknown',failedSectors:Array.from({length:sampleCount},(_,i)=>i).filter(i=>!boundaries.some(b=>b.sector===i))},
  warnings:[sampleCount+'方向按参考项目参数采样真实步行路径；边界为路径累计距离份额估计，不是完整路网或独立核验端点。','缺路径/断裂/失败方向不造圈、不补点；POI可达仍由单独真实路线成本判断。']};
}
