import{centeredLinear}from'../web/centered-range-shape.js';
import{sampleCenteredWalkingRange,PRODUCTION_BOUNDARY_SHAPE_VERSION}from'./centered-walking-range.mjs';
import{validRangeCost}from'./batch-walking-range.mjs';
import{rayDestination}from'./reference-walking-range.mjs';
import{reachabilityEvidence}from'./reachability-evidence.mjs';
import{buildFacilityDisplay}from'./facility-display.mjs';
import{roadMeters}from'../web/road-time-graph.js';

// Read-time geometry migration. No provider, network, score or source-file writes.
// Old path-prefix outlines must be rebuilt from directional costs, not rounded again.
export async function restoreWalkingBoundary(job){
 const origin=job?.analysis?.origin,feature=job?.geojson?.features?.find(f=>f.properties?.featureType==='sampled_boundary'&&f.geometry?.type==='Polygon');
 if(!origin||job.geometrySource!=='walking_sampling_fallback'||job.analysis.walkingModelId!=='walking80-v1'||!feature)return job;
 const p=feature.properties;
 if(p.boundaryShapeVersion===PRODUCTION_BOUNDARY_SHAPE_VERSION&&p.boundaryMethod==='radial_linear'&&p.geometryConfidence==='radial_sampling_estimate'&&job.boundaryEstimates?.length===36&&job.boundaryEstimates.every(e=>e.estimated||e.radialCostModel))return job;
 const samples=job.rangeSamples?.length?job.rangeSamples:job.heatSamples??[],bySector=new Map();
 for(const s of samples){if(s.sampleStage==='matrix_bisection'||s.round>0||!Number.isInteger(s.sector)||s.sector<0||s.sector>=36||!Number.isFinite(s.radiusMeters)||s.radiusMeters<=0)continue;
  // Reject wrong-origin, failed, unbound and non-radial observations.
  const target=rayDestination(origin.location,s.sector*10,s.radiusMeters);if(validRangeCost(s,origin,target))bySector.set(s.sector,s);
 }
 let shape,estimates,diagnostics,source;
 const known=job.boundaryEstimates,ring=feature.geometry.coordinates[0],fromPchip=p.boundaryShapeVersion==='walking36-constrained-polar-pchip-v1'&&ring.length===289;
 const knots=known?.length===36?known.map(e=>e.point):fromPchip?ring.filter((_p,i)=>i<288&&i%8===0):null;
 // Older matrix jobs already have a valid 36-bearing contour but omitted its
 // control metadata. Replay those same observations before considering long
 // path fallback costs. Substituting far-ray costs changes the production ring.
 const matrixRows=samples.filter(s=>s.sampleStage==='matrix_bisection'||s.round>0);
 if([1,2,3].every(round=>matrixRows.filter(s=>s.round===round).length===36)){
  let round=0;
  const replay=await sampleCenteredWalkingRange({center:origin.location,originUid:origin.uid??null,
   matrixProvider:{async routeMany(){round++;return matrixRows.filter(s=>s.round===round).sort((a,b)=>a.sector-b.sector);}},
   pathSamplingPromise:Promise.resolve({samples:[...bySector.values()]}),maxRouteCalls:0,maxMatrixOutputs:108});
  const boundary=replay.geojson.features.find(f=>f.properties.featureType==='sampled_boundary');
  if(boundary&&replay.engine==='routematrix-batch'){
   const replayRing=boundary.geometry.coordinates[0],recordedKnots=ring.length===289?ring.filter((_q,i)=>i<288&&i%8===0):ring.slice(0,-1),same=recordedKnots.length===36&&recordedKnots.every((q,i)=>roadMeters(q,replay.boundaryEstimates[i].point)<.05);
   // A contradictory existing radial contour is evidence to investigate, not
   // permission to silently expand it. Prefix contours can still be restored.
   const recordedRadial=p.geometryConfidence==='radial_sampling_estimate'&&['closed_catmull_rom','radial_linear'].includes(job.rangeDiagnostics?.samplingDiagnostics?.boundaryMethod);
   if(recordedRadial&&!same)return job;
   shape={ring:replayRing,method:replay.samplingDiagnostics.boundaryMethod,tension:replay.samplingDiagnostics.splineTension};
   estimates=replay.boundaryEstimates;diagnostics=replay.samplingDiagnostics;source='recorded_36_direction_matrix_replay';
  }
 }
 if(!shape&&knots){
  shape=centeredLinear(knots,origin.location);if(!shape.ring)return job;estimates=known;source='recorded_36_radial_boundary_knots';diagnostics={...job.rangeDiagnostics?.samplingDiagnostics,boundaryMethod:shape.method,splineTension:shape.tension,originContained:true};
  if(known?.some(e=>!e.estimated&&!e.radialCostModel)&&bySector.size===36){
   const replay=await sampleCenteredWalkingRange({center:origin.location,originUid:origin.uid??null,maxRouteCalls:36,maxMatrixOutputs:0,pathSamplingPromise:Promise.resolve({samples:[...bySector.values()]})});
   estimates=known.map(e=>{const r=replay.boundaryEstimates.find(r=>r.sector===e.sector);return r&&r.evidenceId===e.evidenceId&&Math.abs(r.radiusMeters-e.radiusMeters)<.05?{...e,radialCostModel:r.radialCostModel}:e;});
  }
 }else if(!shape&&bySector.size===36){
  const replay=await sampleCenteredWalkingRange({center:origin.location,originUid:origin.uid??null,maxRouteCalls:36,maxMatrixOutputs:0,pathSamplingPromise:Promise.resolve({samples:[...bySector.values()]})});
  const boundary=replay.geojson.features.find(f=>f.properties.featureType==='sampled_boundary');if(!boundary)return job;
  shape={ring:boundary.geometry.coordinates[0],method:replay.samplingDiagnostics.boundaryMethod,tension:replay.samplingDiagnostics.splineTension};estimates=replay.boundaryEstimates;diagnostics=replay.samplingDiagnostics;source='36_recorded_directional_walking_costs';
 }
 if(!shape)return job;
 const result={...job,boundaryEstimates:estimates,rangeSamples:job.rangeSamples?.length?job.rangeSamples:samples,geojson:{...job.geojson,features:job.geojson.features.map(f=>f!==feature?f:{...f,geometry:{...f.geometry,coordinates:[shape.ring]},properties:{...p,boundaryShapeVersion:PRODUCTION_BOUNDARY_SHAPE_VERSION,boundaryMethod:shape.method,splineTension:shape.tension,sourceKnotCount:36,geometryConfidence:'radial_sampling_estimate',originContained:true,historicalRingResmoothed:false,restoredFromWalkingSamples:true,maxBoundaryOffsetMeters:null}})},
  boundaryRestoration:{version:'walking36-linear-projection-v1',source,sourceSampleCount:source==='recorded_36_direction_matrix_replay'?108:bySector.size,controlPointCount:36,oldPointCount:feature.geometry.coordinates[0].length,newPointCount:shape.ring.length,previousMethod:p.boundaryMethod??job.rangeDiagnostics?.samplingDiagnostics?.boundaryMethod??null,method:shape.method,tension:shape.tension,newApiCalls:0,originalEvidenceUnchanged:true},
  rangeDiagnostics:{...job.rangeDiagnostics,samplingDiagnostics:{...job.rangeDiagnostics?.samplingDiagnostics,...diagnostics,boundaryShapeVersion:PRODUCTION_BOUNDARY_SHAPE_VERSION,maxBoundaryOffsetMeters:null,measuredBoundaryOffsetMeters:null,replayedExistingObservations:true},note:'36方向已有Walking成本外推径向控制点直接闭合为原始折线；不新增测时或变更评分。'},
  geometryProvenance:{...job.geometryProvenance,boundaryShapeVersion:PRODUCTION_BOUNDARY_SHAPE_VERSION,boundaryRestoredFrom:source,notNewWalkingObservations:true}};
 if(Array.isArray(result.analysis.poiMarkers)&&result.analysis.categories?.every(g=>Array.isArray(g.subtypeResults)))result.display=buildFacilityDisplay(result);
 result.reachability=reachabilityEvidence(result);return result;
}
