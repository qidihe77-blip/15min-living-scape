import {rayDestination,sampleReferenceWalkingRange} from './reference-walking-range.mjs';
import {cleanSampleBoundary,validateBoundaryRing} from './boundary-geometry.mjs';
import {validBd09ll} from './walking-provider.mjs';
import {modelRoute,WALKING80_MODEL} from '../web/walking-model.js';
export const BATCH_RANGE_VERSION='walking-36-batch-bisection-v1';
export const RANGE_DIRECTIONS=36;
export const RANGE_ROUNDS=3;
const same=(a,b)=>validBd09ll(a)&&validBd09ll(b)&&Math.abs(a.lng-b.lng)<=1e-6&&Math.abs(a.lat-b.lat)<=1e-6;
export function validRangeCost(r,origin,destination){return r?.routeStatus==='ok'&&r.mode==='walking'&&r.coordinateSystem==='BD-09LL'
 &&Number.isFinite(r.durationSeconds)&&r.durationSeconds>0&&Number.isFinite(r.distanceMeters)&&r.distanceMeters>0
 &&same(r.requestedOrigin?.location,origin.location??origin)&&same(r.requestedDestination?.location,destination.location??destination)
 &&(r.requestedOrigin?.uid??null)===(origin.uid??null)&&(r.requestedDestination?.uid??null)===(destination.uid??null);}
export function pointInRing(p,ring){let inside=false;
 for(let i=0,j=ring.length-2;i<ring.length-1;j=i++){
  const a=ring[i],b=ring[j],dx=b[0]-a[0],dy=b[1]-a[1],cross=(p[0]-a[0])*dy-(p[1]-a[1])*dx;
  if(Math.abs(cross)<1e-14&&p[0]>=Math.min(a[0],b[0])-1e-12&&p[0]<=Math.max(a[0],b[0])+1e-12&&p[1]>=Math.min(a[1],b[1])-1e-12&&p[1]<=Math.max(a[1],b[1])+1e-12)return true;
  if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 }return inside;}
// Closed Catmull-Rom, eight samples/edge. An overshoot falls back to the validated
// piecewise boundary, rather than expanding into additional unmeasured space.
export function smoothSupportedRing(ring){const p=ring.slice(0,-1),out=[];
 for(let i=0;i<p.length;i++){const a=p[(i+p.length-1)%p.length],b=p[i],c=p[(i+1)%p.length],d=p[(i+2)%p.length];
  for(let j=0;j<8;j++){const t=j/8;out.push([0,1].map(k=>.5*(2*b[k]+(-a[k]+c[k])*t+(2*a[k]-5*b[k]+4*c[k]-d[k])*t*t+(-a[k]+3*b[k]-3*c[k]+d[k])*t*t*t)));}}
 out.push([...out[0]]);const valid=validateBoundaryRing(out);
 if(!valid.valid||out.some(x=>!pointInRing(x,ring)))return{ring,method:'validated_linear',reasonCode:!valid.valid?valid.reasonCode:'spline_overshoot'};
 return{ring:out,method:'bounded_catmull_rom',reasonCode:null};}
export async function sampleBatchWalkingRange({center,originUid=null,matrixProvider,walkingProvider,maxRouteCalls=36,maxMatrixOutputs=108,signal,onProgress=()=>{}}){
 if(!validBd09ll(center)||!Number.isInteger(maxMatrixOutputs)||maxMatrixOutputs<0||maxMatrixOutputs>108)throw new TypeError('Bounded matrix sampling required.');
 const origin={location:center,uid:originUid},states=Array.from({length:36},(_,sector)=>({sector,bearingDegrees:sector*10,lo:0,hi:2340,probe:null,probes:[],failed:[]})),samples=[];
 let matrixOutputs=0,matrixRequests=0,failure=null;
 if(matrixProvider?.routeMany&&maxMatrixOutputs>=108){
  for(let round=0;round<3&&!signal?.aborted;round++){
   const targets=states.map(s=>rayDestination(center,s.bearingDegrees,(s.lo+s.hi)/2));
   let rows;try{matrixRequests++;matrixOutputs+=36;rows=await matrixProvider.routeMany({origin,destinations:targets,mode:'walking',signal});}catch(e){failure=e.code??'matrix_request_failed';break;}
   if(!Array.isArray(rows)||rows.length!==36){failure='matrix_result_count_mismatch';break;}
   let valid=0;
   rows.forEach((r,i)=>{const s=states[i],target=targets[i],radius=(s.lo+s.hi)/2,okay=validRangeCost(r,origin,target),cost=okay?modelRoute(r,WALKING80_MODEL):r;
    samples.push({...cost,sector:i,bearingDegrees:i*10,lat:target.lat,lng:target.lng,radiusMeters:radius,sampleStage:'matrix_bisection',round:round+1,coverageStatus:okay?cost.modelDurationSeconds<=900?'covered':'over_threshold':'unknown'});
    if(!okay){s.failed.push(r?.routeStatus==='ok'?'invalid_route_binding':r?.routeStatus??'invalid_route_binding');return;}valid++;
    if(s.probes.some(p=>(p.radius<radius&&cost.distanceMeters+60<p.cost.distanceMeters)||(p.radius>radius&&p.cost.distanceMeters+60<cost.distanceMeters)))s.nonMonotonic=true;
    s.probe={radius,cost};s.probes.push(s.probe);if(cost.modelDurationSeconds<=900)s.lo=radius;else s.hi=radius;
   });
   onProgress({phase:'matrix_walking_sampling',completed:round+1,total:3,matrixRequests,matrixOutputs,validDirections:valid});
   if(!valid){failure=rows[0]?.routeStatus==='ok'?'invalid_matrix_binding':rows[0]?.routeStatus??'matrix_round_failed';break;}
  }
 }else failure=!matrixProvider?.routeMany?'matrix_unverified':'matrix_sampling_budget_insufficient';
 const failed=states.filter(s=>!s.probe||s.lo<=0||s.nonMonotonic);
 // Whole-service failure can use the independently bounded Walking path budget.
 // Partial unresolved directions stay unknown; do not invent neighbour/median points.
 if(failure&&walkingProvider?.route&&!signal?.aborted){
  const g=await sampleReferenceWalkingRange({center,originUid,provider:walkingProvider,maxRouteCalls,sampleCount:36,maxRepairCalls:8,signal,onProgress});
  return{...g,algorithmVersion:BATCH_RANGE_VERSION,engine:'walking-polyline-fallback',samplingDiagnostics:{...g.samplingDiagnostics,version:BATCH_RANGE_VERSION,matrixUsed:matrixRequests>0,matrixFailure:failure,matrixRequests,matrixOutputs,fallbackReason:failure,sampleCount:36},matrixRequestStats:{httpRequests:matrixRequests,outputRoutes:matrixOutputs},warnings:[...g.warnings,'批量矩阵不可用，使用36方向真实Walking路径份额估计；没有理想圆降级。']};
 }
 const estimates=states.filter(s=>s.probe&&s.lo>0).map(s=>{const estimate=s.probe.radius*1200/s.probe.cost.distanceMeters,radius=Math.max(s.lo,Math.min(estimate,Math.max(s.hi,s.probe.radius)*1.05)),p=rayDestination(center,s.bearingDegrees,radius);
  return{sector:s.sector,bearingDegrees:s.bearingDegrees,radiusMeters:radius,point:[p.lng,p.lat],lowMeasuredRadiusMeters:s.lo,highRadiusMeters:s.hi,evidenceId:s.probe.cost.evidenceId,costStatus:'estimated_from_matrix_cost'};});
 const cleaned=!failed.length&&!failure?cleanSampleBoundary(estimates.map(s=>s.point),{center}):{ring:null,reasonCode:failure??'unresolved_matrix_directions'};
 const smooth=cleaned.ring?smoothSupportedRing(cleaned.ring):null;
 const reason=cleaned.reasonCode;
 return{algorithmVersion:BATCH_RANGE_VERSION,engine:'routematrix-batch',walkingModelId:WALKING80_MODEL,coordinateSystem:'BD-09LL',mode:'walking',thresholdSeconds:900,distanceLimitMeters:1200,center,originUid,status:'partial',samples,boundaryEstimates:estimates,
  geometrySource:'walking_sampling_fallback',geometryStatus:smooth?'sampled_approximation':'unknown',geojson:{type:'FeatureCollection',features:smooth?[{type:'Feature',geometry:{type:'Polygon',coordinates:[smooth.ring]},properties:{featureType:'sampled_boundary',geometrySource:'walking_sampling_fallback',walkingModelId:WALKING80_MODEL,coordinateSystem:'BD-09LL',geometryConfidence:'matrix_bisection_estimate',interiorStatus:'unknown_between_samples'}}]:[]},
  matrixRequestStats:{httpRequests:matrixRequests,outputRoutes:matrixOutputs},sampleMetrics:{attemptedRouteCalls:matrixOutputs,maxMatrixOutputs,requestedDirections:36,validSectors:estimates.length,validRoutePoints:samples.filter(s=>s.coverageStatus!=='unknown').length,continuousRangeAvailable:false,errorBoundStatus:'not_statistically_estimated'},
  samplingDiagnostics:{version:BATCH_RANGE_VERSION,engine:'routematrix-batch',sampleCount:36,rounds:3,upperRadiusMeters:2340,speedMetersPerMinute:80,walkMinutes:15,targetDistanceMeters:1200,boundaryMethod:smooth?.method??'none',smoothingReasonCode:smooth?.reasonCode??null,boundaryCostStatus:'estimated_not_separate_route_witness',boundaryReasonCode:reason,matrixUsed:matrixRequests>0,matrixRequests,matrixOutputs,officialApisUsed:false,failedSamples:failed.map(s=>({sector:s.sector,reasonCode:s.nonMonotonic?'non_monotonic_reachability':s.failed.at(-1)??'no_reachable_probe'}))},
  unknownRegions:{continuousRangeAvailable:false,unmeasuredInterior:true,betweenSamplesStatus:'unknown',failedSectors:failed.map(s=>s.sector)},
  warnings:['36方向三轮真实矩阵成本二分；外推和平滑为采样近似，不代表完整路网或独立核验边界点。','缺方向不补中位数，不画理想圆；POI仍按实际起点单独核验真实成本与Polyline。']};
}
