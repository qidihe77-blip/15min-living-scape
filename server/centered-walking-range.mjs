import {rayDestination} from './reference-walking-range.mjs';
import {validRangeCost} from './batch-walking-range.mjs';
import {orderedBatches} from './bounded-batches.mjs';
import {validBd09ll} from './walking-provider.mjs';
import {modelRoute,WALKING80_MODEL} from '../web/walking-model.js';
import {boundaryContainsPoint} from '../web/sample-boundary.js';
import {centeredLinear} from '../web/centered-range-shape.js';
import {radialCostRadius} from '../web/radial-cost-model.js';
import {runRadialRounds} from './radial-round-scheduler.mjs';
export {centeredSpline} from '../web/centered-range-shape.js';
export const PRODUCTION_BOUNDARY_SHAPE_VERSION='walking36-centered-linear-v1';

export const CENTERED_RANGE_VERSION='walking-36-centered-bisection-v2';
const ROUNDS=3,TARGET=1200,UPPER=2340;

// The boundary knots keep their original bearings around the selected origin.
// Road-polyline prefixes are useful path evidence, but cannot form this contour:
// several directions may share one exit and all their prefixes lie on one side.
export async function sampleCenteredWalkingRange({center,originUid=null,matrixProvider=null,
 walkingProvider=null,pathSamplingPromise=null,pathSamplingFactory=null,directionCount=36,maxRouteCalls=directionCount,maxMatrixOutputs=directionCount*ROUNDS,
 signal,onProgress=()=>{}}={}){
 if(![36,48].includes(directionCount)||!validBd09ll(center)||Math.abs(center.lat)>=85||!Number.isInteger(maxRouteCalls)||maxRouteCalls<0||maxRouteCalls>88
  ||!Number.isInteger(maxMatrixOutputs)||maxMatrixOutputs<0||maxMatrixOutputs>directionCount*ROUNDS)throw new TypeError('Invalid centered range sampling.');
 const shapeVersion=directionCount===36?PRODUCTION_BOUNDARY_SHAPE_VERSION:'walking48-centered-linear-experiment-v1';
 const origin={location:center,uid:originUid},states=Array.from({length:directionCount},(_,sector)=>({sector,
  bearingDegrees:sector*360/directionCount,lo:0,hi:UPPER,probe:null,failures:[],probes:[]}));
 const samples=[];let requestedOutputs=0,logicalBatches=0,rounds=0,failure=null,engine='routematrix-batch';
 let matrixMeasured=0,pathResult=null,scheduling=null;
 const sample=(r,sector,radius,stage,round)=>{
  const target=rayDestination(center,sector*360/directionCount,radius),valid=validRangeCost(r,origin,target),cost=valid?modelRoute(r,WALKING80_MODEL):r;
  return{...cost,sector,bearingDegrees:sector*360/directionCount,lat:target.lat,lng:target.lng,radiusMeters:radius,
   sampleStage:stage,round,coverageStatus:valid?cost.modelDurationSeconds<=900?'covered':'over_threshold':'unknown'};
 };
 if(matrixProvider?.routeMany&&maxMatrixOutputs>=directionCount*ROUNDS){
  onProgress({phase:'matrix_walking_sampling',completed:0,total:ROUNDS,directions:directionCount});
  if(Number.isInteger(matrixProvider.samplingBatchSize)&&matrixProvider.samplingBatchSize>0){
   scheduling=await runRadialRounds({states,roundCount:ROUNDS,batchSize:matrixProvider.samplingBatchSize,signal,
    request:(cohort,radii)=>matrixProvider.routeMany({origin,destinations:cohort.map((s,i)=>rayDestination(center,s.bearingDegrees,radii[i])),mode:'walking',signal}),
    accept:(r,s,radius,round)=>{const row=sample(r,s.sector,radius,'matrix_bisection',round);samples.push(row);if(row.coverageStatus==='unknown'){s.failures.push(r?.routeStatus==='ok'?'invalid_route_binding':r?.routeStatus??'invalid_route_binding');return false;}s.probe={radius,cost:row};s.probes.push(s.probe);if(row.modelDurationSeconds<=900)s.lo=radius;else s.hi=radius;return true;},
    onRound:(completed,validDirections)=>onProgress({phase:'matrix_walking_sampling',completed,total:ROUNDS,validDirections,directions:directionCount})});
   ({failure,rounds}=scheduling);requestedOutputs=scheduling.outputs;logicalBatches=scheduling.logicalRounds;samples.sort((a,b)=>a.round-b.round||a.sector-b.sector);
  }else{
  for(let round=1;round<=ROUNDS;round++){
   if(signal?.aborted)throw signal.reason;
   const radii=states.map(s=>(s.lo+s.hi)/2),destinations=states.map((s,i)=>rayDestination(center,s.bearingDegrees,radii[i]));
   let rows;
   try{logicalBatches++;requestedOutputs+=directionCount;rows=await matrixProvider.routeMany({origin,destinations,mode:'walking',signal});}
   catch(e){if(signal?.aborted)throw signal.reason;failure=e.code??'matrix_request_failed';break;}
   if(!Array.isArray(rows)||rows.length!==directionCount){failure='matrix_result_count_mismatch';break;}
   let valid=0;
   rows.forEach((r,i)=>{
    const row=sample(r,i,radii[i],'matrix_bisection',round),s=states[i];samples.push(row);
    if(row.coverageStatus==='unknown'){s.failures.push(r?.routeStatus==='ok'?'invalid_route_binding':r?.routeStatus??'invalid_route_binding');return;}
    valid++;s.probe={radius:radii[i],cost:row};s.probes.push(s.probe);
    if(row.modelDurationSeconds<=900)s.lo=radii[i];else s.hi=radii[i];
   });
   rounds=round;onProgress({phase:'matrix_walking_sampling',completed:round,total:ROUNDS,validDirections:valid,directions:directionCount});
   if(!valid){failure=rows[0]?.routeStatus==='ok'?'invalid_matrix_binding':rows[0]?.routeStatus??'matrix_round_failed';break;}
  }
  }
 }else failure=matrixProvider?'matrix_sampling_budget_insufficient':'matrix_unavailable';
 matrixMeasured=states.filter(s=>s.probe).length;
 // The 1km contour now shares the radial cost model, not legacy path prefixes.
 // Keep the legacy eager promise for rollback; launch single-route fallback only
 // if Matrix cannot provide a usable 36-direction measurement.
 if(!pathSamplingPromise&&(failure||matrixMeasured<directionCount/2)&&pathSamplingFactory)pathSamplingPromise=pathSamplingFactory();
 if(pathSamplingPromise){try{pathResult=await pathSamplingPromise;}catch(e){if(signal?.aborted)throw signal.reason;}}
 if(signal?.aborted)throw signal.reason;
 if(failure||matrixMeasured<directionCount/2){
  engine='walking-radial-fallback';
  const rows=pathResult?.samples??await (async()=>{
   if(!walkingProvider?.route)return[];
   const count=Math.min(directionCount,maxRouteCalls);
   return orderedBatches(Array.from({length:count},(_,i)=>i),async sector=>{
    const radius=1560,target=rayDestination(center,sector*360/directionCount,radius);let r;
    try{r=await walkingProvider.route(center,target,{originUid,captureGeometry:false,signal});}
    catch(e){if(signal?.aborted)throw signal.reason;r={routeStatus:e.code??'upstream_unavailable'};}
    const row=sample(r,sector,radius,'walking_radial_fallback',null);
    onProgress({phase:'radial_boundary_sampling',completed:sector+1,total:directionCount});return row;
   },{concurrency:Math.min(8,walkingProvider.stats?.().queueConcurrency??8),signal});
  })();
  for(const s of states){s.lo=0;s.hi=UPPER;s.probe=null;}
  for(const row of rows){const s=states[row.sector];if(!s)continue;
   const radius=row.radiusMeters??1560,target={lng:row.lng,lat:row.lat};
   if(validRangeCost(row,origin,target))s.probe={radius,cost:modelRoute(row,WALKING80_MODEL)};
  }
  if(!pathResult)samples.push(...rows);
 }
 if(pathResult)samples.push(...pathResult.samples);
 if(engine==='routematrix-batch')for(const row of pathResult?.samples??[]){
  const s=states[row.sector];if(!s||s.probe)continue;
  const target={lng:row.lng,lat:row.lat};if(validRangeCost(row,origin,target))
   s.probe={radius:row.radiusMeters,cost:modelRoute(row,WALKING80_MODEL)};
 }
 const measured=states.filter(s=>s.probe),estimates=states.map(s=>{
  if(!s.probe)return null;
  const radialCostModel={version:'bounded-proportional-walking-v1',sampleRadiusMeters:s.probe.radius,
   sampleDistanceMeters:s.probe.cost.distanceMeters,referenceDistanceMeters:TARGET,
   lowRadiusMeters:s.lo,highRadiusMeters:Math.max(s.hi,s.probe.radius)*1.05};
  const radius=radialCostRadius(radialCostModel,TARGET);
  const p=rayDestination(center,s.bearingDegrees,radius);
  return{sector:s.sector,bearingDegrees:s.bearingDegrees,radiusMeters:radius,
   point:[p.lng,p.lat],
   evidenceId:s.probe.cost.evidenceId,estimated:false,costStatus:'radial_cost_extrapolation',
   radialCostModel};
 });
 const completeBudget=engine==='routematrix-batch'||maxRouteCalls>=directionCount;
 const enough=measured.length>=directionCount/2&&completeBudget;
 const radii=estimates.filter(Boolean).map(e=>e.radiusMeters).sort((a,b)=>a-b),median=radii.length?radii[Math.floor(radii.length/2)]:null;
 if(enough)for(let i=0;i<directionCount;i++)if(!estimates[i]){
  const p=rayDestination(center,i*360/directionCount,median);estimates[i]={sector:i,bearingDegrees:i*360/directionCount,radiusMeters:median,
   point:[p.lng,p.lat],estimated:true,evidenceId:null,costStatus:'estimated_direction_median'};
 }
 const inferred=estimates.filter(e=>e?.estimated).map(e=>e.sector);
 let smooth=enough?centeredLinear(estimates.map(e=>e.point),center):{ring:null,reasonCode:'insufficient_measured_directions',method:'none'};
 let referenceOnly=false;
 if(!smooth.ring){
  // Explicit schematic fallback only; never consumed by facility selection,
  // accessibility, heat evidence or the blind-zone calculation.
  engine='ideal-circle-degraded';referenceOnly=true;
  const knots=Array.from({length:directionCount},(_,i)=>{const p=rayDestination(center,i*360/directionCount,1560);return[p.lng,p.lat];});
  smooth={...centeredLinear(knots,center),reasonCode:smooth.reasonCode};
 }
 const degraded=referenceOnly||engine!=='routematrix-batch'||inferred.length>0;
 const feature=smooth.ring?{type:'Feature',geometry:{type:'Polygon',coordinates:[smooth.ring]},properties:{
  featureType:referenceOnly?'degraded_reference':'sampled_boundary',geometrySource:'walking_sampling_fallback',
  walkingModelId:WALKING80_MODEL,coordinateSystem:'BD-09LL',engine,degraded,referenceOnly,boundaryShapeVersion:shapeVersion,boundaryMethod:smooth.method,splineTension:smooth.tension??null,sourceKnotCount:directionCount,
  geometryConfidence:referenceOnly?'ideal_circle_schematic':'radial_sampling_estimate',interiorStatus:'unknown_between_samples',originContained:true}}:null;
 const prefixRing=pathResult?.geojson?.features?.find(f=>f.properties?.featureType==='sampled_boundary')?.geometry?.coordinates?.[0];
 return{algorithmVersion:directionCount===36?CENTERED_RANGE_VERSION:'walking-48-centered-bisection-experiment-v1',engine,degraded,referenceOnly,walkingModelId:WALKING80_MODEL,
  center,originUid,coordinateSystem:'BD-09LL',mode:'walking',thresholdSeconds:900,distanceLimitMeters:TARGET,
  geometrySource:'walking_sampling_fallback',geometryStatus:feature&&!referenceOnly?'sampled_approximation':'unknown',
  status:'partial',samples,boundaryEstimates:estimates.filter(Boolean),geojson:{type:'FeatureCollection',features:feature?[feature]:[]},
  sampleMetrics:{requestedDirections:directionCount,validSectors:measured.length,validRoutePoints:samples.filter(s=>s.coverageStatus!=='unknown').length,
   matrixMeasuredDirections:matrixMeasured,estimatedDirections:inferred.length,continuousRangeAvailable:false,errorBoundStatus:'not_statistically_estimated'},
  matrixRequestStats:{httpRequests:logicalBatches,outputRoutes:requestedOutputs},
  samplingDiagnostics:{version:directionCount===36?CENTERED_RANGE_VERSION:'walking-48-centered-bisection-experiment-v1',engine,degraded,referenceOnly,sampleCount:directionCount,rounds,
   speedMetersPerMinute:80,walkMinutes:15,targetDistanceMeters:TARGET,upperRadiusMeters:UPPER,
   matrixUsed:matrixMeasured>0,matrixAttempted:logicalBatches>0,matrixFailure:failure,matrixRequests:logicalBatches,
   matrixOutputs:requestedOutputs,boundaryMethod:smooth.method,splineTension:smooth.tension??null,
   executionScheduling:scheduling?{mode:'pipelined_cohorts',cohorts:scheduling.cohortCount,latencies:scheduling.latencies}:{mode:'round_barrier'},
   boundaryShapeVersion:shapeVersion,maxBoundaryOffsetMeters:0,measuredBoundaryOffsetMeters:0,
   boundaryCostStatus:'estimated_not_separate_route_witness',boundaryReasonCode:referenceOnly?smooth.reasonCode:null,
   originContained:feature?boundaryContainsPoint(feature.geometry.coordinates[0],center):false,
   legacyPathPrefixBoundary:{available:Boolean(prefixRing),originContained:prefixRing?boundaryContainsPoint(prefixRing,center):null,
    validDirections:pathResult?.sampleMetrics?.validSectors??null,reasonCode:pathResult?.samplingDiagnostics?.boundaryReasonCode??null},
   estimatedDirections:inferred,failedSamples:states.filter(s=>!s.probe).map(s=>({sector:s.sector,reasonCode:s.failures.at(-1)??'no_valid_cost'})),
   officialApisUsed:false},
  unknownRegions:{continuousRangeAvailable:false,unmeasuredInterior:true,betweenSamplesStatus:'unknown',failedSectors:states.filter(s=>!s.probe).map(s=>s.sector)},
  warnings:[referenceOnly?'步行算路不可用：当前仅展示理论参考圈，不作为可达、评分或盲区证据。'
   :''+directionCount+'方向真实步行成本二分、径向外推和原始折线形成近似范围；设施仍需独立真实步行核验。',
   ...(inferred.length?['部分方向使用中位半径估计，缺测方向没有伪造算路证据。']:[])]};
}
