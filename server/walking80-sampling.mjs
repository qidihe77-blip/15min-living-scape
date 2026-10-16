import{orderedBatches}from'./bounded-batches.mjs';
import{modelRoute,decisionSeconds,WALKING80_MODEL}from'../web/walking-model.js';
import{routeLines}from'../web/walking-network.js';
import{farthestDirectionOrder,robustDetour,observeSector,proposeSectorRadius,rankSamplingSectors,ADAPTIVE_SAMPLING_VERSION}from'./adaptive-sampling.mjs';
import{cleanSampleBoundary}from'./boundary-geometry.mjs';
import{straightDistanceMeters}from'./facility-coverage.mjs';
import{validBd09ll}from'./walking-provider.mjs';
const pointAt=(origin,r,angle)=>({lat:origin.lat+Math.sin(angle)*r/111320,lng:origin.lng+Math.cos(angle)*r/(111320*Math.cos(origin.lat*Math.PI/180))});
// Eight directional brackets. Connecting tested boundary points is labelled an approximation;
// its unmeasured interior never establishes POI reachability or a negative result.
export async function sampleWalking80Range({center,originUid=null,provider,maxRouteCalls=24,signal,onProgress=()=>{}}){
 if(!provider?.route||!Number.isFinite(center?.lat)||!Number.isFinite(center?.lng)||Math.abs(center.lng)>180||Math.abs(center.lat)>=85||!Number.isInteger(maxRouteCalls)||maxRouteCalls<0||maxRouteCalls>88)throw new TypeError('Valid origin, provider and bounded sampling budget required.');
 const sectors=farthestDirectionOrder(8).map(i=>({id:i,angle:i*Math.PI/4,lower:null,upper:null,failed:false,nonMonotonic:false,observations:[],visits:0})),samples=[];
 let calls=0,stopped=false;
 const terminal=new Set(['permission_denied','quota_exhausted','rate_limited','route_service_error','upstream_http_error','upstream_unavailable']);
 async function measure(sector,r){if(stopped||calls>=maxRouteCalls||signal?.aborted)return;
  calls++;const location=pointAt(center,r,sector.angle);let route;
  try{route=modelRoute(await provider.route(center,location,{originUid}),WALKING80_MODEL);}catch{route={routeStatus:'upstream_unavailable'};}
  const bound=(e,p,uid)=>e?.location&&Math.abs(e.location.lng-p.lng)<=1e-6&&Math.abs(e.location.lat-p.lat)<=1e-6&&(e.uid??null)===(uid??null);
  const valid=route.routeStatus==='ok'&&route.mode==='walking'&&route.coordinateSystem==='BD-09LL'&&bound(route.requestedOrigin,center,originUid)&&bound(route.requestedDestination,location,null);
  const seconds=valid?decisionSeconds(route):null,covered=seconds!==null&&seconds<=900;
  const lines=routeLines(route.geometry),asPoint=p=>({lng:p[0],lat:p[1]});
  const geometryBound=lines.length&&straightDistanceMeters(validBd09ll(route.providerOrigin)?route.providerOrigin:center,asPoint(lines[0][0]))<=150
   &&straightDistanceMeters(validBd09ll(route.providerDestination)?route.providerDestination:location,asPoint(lines.at(-1).at(-1)))<=150;
  const failureReasonCode=seconds!==null?null:route.routeStatus!=='ok'?route.routeStatus:!valid?'invalid_route_binding':'invalid_route';
  const sample={...route,routeStatus:failureReasonCode??route.routeStatus,modelDurationSeconds:valid?route.modelDurationSeconds:null,
   geometry:geometryBound?route.geometry:null,geometryStatus:route.geometry&&!geometryBound?lines.length?'endpoint_geometry_mismatch':'invalid_path':route.geometryStatus??'missing_path',
   reasonCode:failureReasonCode,lat:location.lat,lng:location.lng,radiusMeters:r,sector:sector.id,evidenceId:'radial80-'+sector.id+'-'+calls,coverageStatus:seconds===null?'unknown':covered?'covered':'over_threshold',sampleStage:'radial_boundary_sampling'};
  samples.push(sample);sector.visits++;observeSector(sector,sample);
  if(terminal.has(route.routeStatus)||provider.stats?.().stopped)stopped=true;
  onProgress({phase:'radial_boundary_sampling',completed:samples.length,total:maxRouteCalls,routeCalls:calls});
 }
 await orderedBatches(sectors,s=>measure(s,420),{concurrency:2,signal});
 await orderedBatches(sectors.filter(s=>!s.failed),s=>measure(s,proposeSectorRadius(s,robustDetour(samples))),{concurrency:2,signal});
 while(!stopped&&calls<maxRouteCalls){const detour=robustDetour(samples),ranked=rankSamplingSectors(sectors).slice(0,maxRouteCalls-calls);if(!ranked.length)break;
  await orderedBatches(ranked,s=>measure(s,proposeSectorRadius(s,detour)),{concurrency:2,signal});}
 const bracketed=sectors.every(s=>s.lower&&s.upper&&!s.failed&&!s.nonMonotonic&&s.lower.radiusMeters<s.upper.radiusMeters);
 const cleaned=bracketed?cleanSampleBoundary([...sectors].sort((a,b)=>a.angle-b.angle).map(s=>[s.lower.location.lng,s.lower.location.lat]),{center}):{ring:null,reasonCode:sectors.some(s=>s.nonMonotonic)?'non_monotonic_sampling':'insufficient_sampling'};
 const ring=cleaned.ring,detour=robustDetour(samples);
 const features=samples.filter(s=>s.coverageStatus==='covered'&&routeLines(s.geometry).length).map(s=>({type:'Feature',geometry:s.geometry,properties:{...s,geometry:undefined,featureType:'reachable_route',geometrySource:'walking_sampling_fallback',durationScope:'whole_route'}}));
 if(ring)features.push({type:'Feature',geometry:{type:'Polygon',coordinates:[ring]},properties:{featureType:'sampled_boundary',geometrySource:'walking_sampling_fallback',walkingModelId:WALKING80_MODEL,coordinateSystem:'BD-09LL',interiorStatus:'unknown_between_samples',geometryConfidence:'directional_sampling_approximation',label:'80m/min路网采样近似范围'}});
 return{algorithmVersion:ADAPTIVE_SAMPLING_VERSION,walkingModelId:WALKING80_MODEL,geometrySource:'walking_sampling_fallback',geometryStatus:ring?'sampled_approximation':'unknown',coordinateSystem:'BD-09LL',mode:'walking',thresholdSeconds:900,distanceLimitMeters:1200,center,originUid,samples,status:'partial',
  geojson:{type:'FeatureCollection',features},sampleMetrics:{attemptedRouteCalls:calls,maxRouteCalls,validRoutePoints:samples.filter(s=>s.coverageStatus!=='unknown').length,validSectors:sectors.filter(s=>s.lower&&!s.nonMonotonic).length,stoppedReason:stopped?provider.stats?.().lastFailure?.reasonCode??'provider_stopped':null,providerFailure:provider.stats?.().lastFailure??null,continuousRangeAvailable:false,errorBoundStatus:'not_statistically_estimated',radialBrackets:sectors.map(s=>({sector:s.id,lowerMeters:s.lower?.radiusMeters??null,upperMeters:s.upper?.radiusMeters??null,
   bracketWidthMeters:s.lower&&s.upper?s.upper.radiusMeters-s.lower.radiusMeters:null,status:s.nonMonotonic?'non_monotonic':s.failed?'unknown':s.lower&&s.upper?'bracketed':'unbracketed'}))},
  samplingDiagnostics:{version:ADAPTIVE_SAMPLING_VERSION,directionOrder:sectors.map(s=>s.id),selection:'farthest_direction_then_cost_bracket_priority',detour,proposalMethod:'observed_cost_secant_with_inset',boundaryReasonCode:cleaned.reasonCode,geometryValidation:{...cleaned,ring:undefined},
   nonMonotonicSectors:sectors.filter(s=>s.nonMonotonic).map(s=>s.id),failedSamples:samples.filter(s=>s.coverageStatus==='unknown').map(s=>({sector:s.sector,reasonCode:s.reasonCode,apiStatus:s.apiStatus??null,httpStatus:s.httpStatus??null})),
   unavailablePathSamples:samples.filter(s=>s.routeStatus==='ok'&&!s.geometry).map(s=>({sector:s.sector,geometryStatus:s.geometryStatus}))},
  unknownRegions:{continuousRangeAvailable:false,betweenSamplesStatus:'unknown',outsideStudyAreaStatus:'unknown',unmeasuredInterior:true,failedSectors:sectors.filter(s=>s.failed||s.nonMonotonic).map(s=>s.id)},warnings:['范围由有限真实路线距离采样形成，不代表所有道路或内部每点均可达。','80m/min是固定速度模型；百度返回耗时单独保留。']};
}
