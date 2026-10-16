import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleCenteredWalkingRange,centeredSpline} from '../server/centered-walking-range.mjs';
import {sampleReferenceWalkingRange,rayDestination} from '../server/reference-walking-range.mjs';
import {straightDistanceMeters} from '../server/facility-coverage.mjs';
import {boundaryContainsPoint,validateBoundaryRing} from '../web/sample-boundary.js';
import {walkingRangePolygons} from '../web/circle-presentation.js';
import {validWalkingSamplingSnapshot} from '../server/reachability-evidence.mjs';
import {createAuthorizedWalkingProvider,walkingTaskAllowance} from '../server/authorized-walking.mjs';
import {progressPresentation} from '../web/report-state-ui.js';
const center={lng:120,lat:30},originUid='community',origin={uid:originUid,location:center};
const cost=(p,i=0)=>({mode:'walking',routeStatus:'ok',source:'explicit_offline_fixture',coordinateSystem:'BD-09LL',
 distanceMeters:straightDistanceMeters(center,p)*1.3,durationSeconds:straightDistanceMeters(center,p)*1.5,
 evidenceId:'fixture-'+i+'-'+p.lng,requestedOrigin:origin,requestedDestination:{uid:null,location:p}});
const ringOf=g=>g.geojson.features[0].geometry.coordinates[0];
function matrix({fail=[]}={}){const calls=[];return{calls,routeMany:async options=>{
 calls.push(options);return options.destinations.map((p,i)=>fail.includes(i)?{routeStatus:'no_route'}:cost(p,i));
}};}
test('three 36-bearing rounds produce 108 observations and a 36-segment unsmoothed closed contour that contains the origin',async()=>{
 const p=matrix(),g=await sampleCenteredWalkingRange({center,originUid,matrixProvider:p});
 assert.equal(p.calls.length,3);assert.ok(p.calls.every(c=>c.destinations.length===36));
 assert.equal(g.samples.length,108);assert.equal(g.boundaryEstimates.length,36);
 assert.equal(g.engine,'routematrix-batch');assert.equal(g.degraded,false);
 assert.equal(ringOf(g).length,37);assert.ok(validateBoundaryRing(ringOf(g)).valid);
 assert.ok(boundaryContainsPoint(ringOf(g),center));assert.equal(g.samplingDiagnostics.originContained,true);
 assert.equal(g.samplingDiagnostics.rounds,3);assert.equal(validWalkingSamplingSnapshot(g,center,originUid),true);
 assert.ok(g.samples.some(s=>s.modelDurationSeconds<=900&&s.durationSeconds>900),'80m/min model remains separate from raw seconds');
 assert.equal(g.samples.some(s=>s.geometry),false,'the estimated contour is never a fabricated Walking path');
});
test('shared-exit road prefixes reproduce the old origin-outside failure; the radial contour and validation fix it',async()=>{
 const exit=rayDestination(center,180,900),provider={stats:()=>({queueConcurrency:10}),route:async(a,b,o)=>{
  const bearing=(Math.atan2((b.lng-center.lng)*Math.cos(center.lat*Math.PI/180),b.lat-center.lat)*180/Math.PI+360)%360,
   branch=rayDestination(exit,200+(Math.round(bearing/10)%36)*1.5,700),points=[a,exit,branch,b],distance=points.slice(1).reduce((n,p,i)=>n+straightDistanceMeters(points[i],p),0);
  return{...cost(b),distanceMeters:distance,durationSeconds:distance,
   requestedOrigin:{location:a,uid:o.originUid},geometry:{type:'LineString',coordinates:points.map(p=>[p.lng,p.lat])}};
 }};
 const old=await sampleReferenceWalkingRange({center,originUid,provider,maxRouteCalls:36,sampleCount:36});
 assert.equal(old.geometryStatus,'sampled_approximation');assert.equal(boundaryContainsPoint(ringOf(old),center),false);
 assert.equal(validWalkingSamplingSnapshot(old,center,originUid),false);
 assert.equal(walkingRangePolygons({...old,analysis:{origin}}).length,0);
 const repaired=await sampleCenteredWalkingRange({center,originUid,matrixProvider:matrix(),pathSamplingPromise:Promise.resolve(old)});
 assert.equal(repaired.geometryStatus,'sampled_approximation');assert.equal(boundaryContainsPoint(ringOf(repaired),center),true);
 assert.equal(repaired.samples.filter(s=>s.geometry).length,36,'1km true path evidence is retained');
 assert.equal(walkingRangePolygons({...repaired,analysis:{origin}}).length,1);
});
test('sharp positive radial changes never publish a self-intersecting or origin-excluding spline',()=>{
 const points=Array.from({length:36},(_,i)=>{const p=rayDestination(center,i*10,i%3===0?8:1100);return[p.lng,p.lat];});
 const smooth=centeredSpline(points,center);assert.ok(smooth.ring);assert.ok(validateBoundaryRing(smooth.ring).valid);
 assert.ok(boundaryContainsPoint(smooth.ring,center));
});
test('partial missing directions have explicit median estimates and never receive fake route evidence',async()=>{
 const g=await sampleCenteredWalkingRange({center,originUid,matrixProvider:matrix({fail:[3]})});
 assert.equal(g.degraded,true);assert.deepEqual(g.samplingDiagnostics.estimatedDirections,[3]);
 assert.equal(g.boundaryEstimates[3].evidenceId,null);assert.equal(g.boundaryEstimates[3].estimated,true);
 assert.ok(g.samples.filter(s=>s.sector===3).every(s=>s.routeStatus==='no_route'&&s.coverageStatus==='unknown'));
 assert.ok(boundaryContainsPoint(ringOf(g),center));
});
test('matrix unavailability reuses saved real path costs without issuing duplicate fallback requests',async()=>{
 const samples=Array.from({length:36},(_,sector)=>{const p=rayDestination(center,sector*10,1800);return{...cost(p,sector),sector,radiusMeters:1800,lng:p.lng,lat:p.lat};});
 const g=await sampleCenteredWalkingRange({center,originUid,maxMatrixOutputs:0,pathSamplingPromise:Promise.resolve({samples}),
  walkingProvider:{route:()=>assert.fail('must reuse existing paths')}});
 assert.equal(g.engine,'walking-radial-fallback');assert.equal(g.geometryStatus,'sampled_approximation');
 assert.ok(boundaryContainsPoint(ringOf(g),center));assert.equal(g.samples.length,36);
});
test('bounded single-point fallback performs at most 36 real calls and preserves the origin',async()=>{
 let calls=0;const provider={route:async(a,b)=>{calls++;return cost(b);}};
 const g=await sampleCenteredWalkingRange({center,originUid,walkingProvider:provider,maxMatrixOutputs:0});
 assert.equal(calls,36);assert.equal(g.engine,'walking-radial-fallback');assert.ok(boundaryContainsPoint(ringOf(g),center));
});
test('no usable routes yield an explicitly theoretical circle excluded from business geometry',async()=>{
 const g=await sampleCenteredWalkingRange({center,originUid,matrixProvider:matrix({fail:Array.from({length:36},(_,i)=>i)})});
 assert.equal(g.engine,'ideal-circle-degraded');assert.equal(g.geometryStatus,'unknown');assert.equal(g.referenceOnly,true);
 assert.equal(g.geojson.features[0].properties.featureType,'degraded_reference');
 assert.equal(walkingRangePolygons({...g,analysis:{origin}}).length,0);
 assert.ok(boundaryContainsPoint(ringOf(g),center));assert.equal(g.sampleMetrics.validSectors,0);
 assert.equal(validWalkingSamplingSnapshot(g,center,originUid),true);
});
test('wrong-origin bindings and incomplete sampling budgets cannot masquerade as a measured contour',async()=>{
 const p={routeMany:async opts=>opts.destinations.map(p=>({...cost(p),requestedOrigin:{...origin,uid:'other'}}))};
 const g=await sampleCenteredWalkingRange({center,originUid,matrixProvider:p});
 assert.equal(g.referenceOnly,true);assert.equal(g.samplingDiagnostics.matrixFailure,'invalid_matrix_binding');
 const h=await sampleCenteredWalkingRange({center,originUid,walkingProvider:{route:async(a,b)=>cost(b)},maxRouteCalls:20,maxMatrixOutputs:0});
 assert.equal(h.referenceOnly,true);assert.equal(h.sampleMetrics.validSectors,20);
});
test('cancelled matrix sampling does not continue to another round or a fallback',async()=>{
 const c=new AbortController();let calls=0;
 const p={routeMany:async opts=>{calls++;c.abort(Error('stop sample'));return opts.destinations.map(p=>cost(p));}};
 await assert.rejects(sampleCenteredWalkingRange({center,originUid,matrixProvider:p,signal:c.signal}),/stop sample/);
 assert.equal(calls,1);
});
test('matrix and Walking sampling share the bounded sampling allowance without consuming extra global requests',async()=>{
 let calls=0;const provider=createAuthorizedWalkingProvider({retryDelayMs:0,sleep:async()=>{},
  client:{requestJson:async()=>{calls++;throw Error('transient');}}});
 const allowance=walkingTaskAllowance(10),sampling={used:107,limit:108},p=rayDestination(center,0,1800);
 const r=await provider.route(center,p,{originUid,walkingAllowance:allowance,requestAllowance:sampling});
 assert.equal(r.routeStatus,'sampling_budget_exhausted');assert.equal(calls,1);assert.equal(allowance.used,1);assert.equal(sampling.used,108);
});
test('matrix bisection progress belongs to the sampling step and counts rounds',()=>{
 const p=progressPresentation({phase:'matrix_walking_sampling',completed:2,total:3});
 assert.equal(p.stage,1);assert.equal(p.percent,67);assert.match(p.counter,/2 \/ 3 轮/);
});
