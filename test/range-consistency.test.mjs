import test from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';
import{restoreWalkingBoundary}from'../server/restore-walking-boundary.mjs';import{specialtyDistanceRange}from'../web/specialty-distance-range.js';import{walkingRangePolygons,insideWalkingRange,mapPresentationRows}from'../web/circle-presentation.js';import{uiSnapshot}from'../server/ui-snapshot.mjs';import{scoreSixGroupPriorities}from'../server/priority-score.mjs';import{facilityViewRows}from'../web/facility-view.js';import{facilityCategoryTree}from'../server/facility-categories.mjs';import{modelRoute,WALKING80_MODEL}from'../web/walking-model.js';
const fixture=JSON.parse(await readFile(new URL('./fixtures/range-consistency-wuhan.json',import.meta.url),'utf8'));
test('recorded Wuhan: replay original matrix observations, preserve all 36 production knots and remove 1km source mixing',async()=>{
 const original=JSON.stringify(fixture.job),j=await restoreWalkingBoundary(fixture.job),poly=walkingRangePolygons(j),r=specialtyDistanceRange(j);
 const originalKnots=fixture.job.geojson.features[0].geometry.coordinates[0].filter((_p,i)=>i<288&&i%8===0);originalKnots.push([...originalKnots[0]]);assert.deepEqual(j.geojson.features[0].geometry.coordinates[0],originalKnots);
 assert.equal(j.boundaryRestoration.source,'recorded_36_direction_matrix_replay');assert.equal(j.boundaryRestoration.newApiCalls,0);
 assert.ok(fixture.legacy1km.ring.slice(0,-1).some(([lng,lat])=>!insideWalkingRange({lng,lat},poly)));
 assert.equal(r.validDirections,36);assert.equal(r.ring.length,37);assert.ok(r.ring.every(([lng,lat])=>insideWalkingRange({lng,lat},poly)));assert.ok(r.originContained);assert.equal(r.newApiCalls,0);
 assert.deepEqual(r.evidenceIds,j.boundaryEstimates.map(e=>e.evidenceId));assert.equal(JSON.stringify(fixture.job),original);assert.deepEqual(j.score,fixture.job.score);
 assert.equal(j.display.totalReachable,52);assert.ok(j.display.facilities.every(p=>p.accessState&&p.accessStateText));assert.equal(j.display.accessStateCounts.inside_over_threshold,1);
 const recomputed=scoreSixGroupPriorities({analysis:j.analysis,priorities:j.score.priorities});assert.equal(recomputed.S_low,j.score.S_low);
 const ui=uiSnapshot(j);assert.deepEqual(specialtyDistanceRange(ui).ring,r.ring);assert.equal(ui.heatSamples.filter(s=>s.sampleStage==='matrix_bisection').length,108);
});
test('1km range uses only its bound production costs; unrelated nearby probes and route geometry do not change it',async()=>{
 const j=await restoreWalkingBoundary(fixture.job),r=specialtyDistanceRange(j),ids=new Set(r.evidenceIds),unrelated=j.rangeSamples.filter(s=>!ids.has(s.evidenceId)).map(s=>({...s,distanceMeters:1000}));
 assert.deepEqual(specialtyDistanceRange({...j,rangeSamples:[...unrelated,...j.rangeSamples.filter(s=>ids.has(s.evidenceId))]}).ring,r.ring);
 for(const mutate of[k=>k.rangeSamples=k.rangeSamples.filter(s=>s.evidenceId!==r.evidenceIds[0]),k=>k.rangeSamples.find(s=>s.evidenceId===r.evidenceIds[0]).requestedOrigin.uid='other',k=>k.boundaryEstimates[0].radialCostModel.sampleDistanceMeters+=100,k=>k.analysis.origin.location.lng+=.01]){const k=structuredClone(j);mutate(k);assert.equal(specialtyDistanceRange(k).status,'unavailable');}
});
test('display labels distinguish outside reachable, inside over-time and unknown; only bound 1200m costs count',()=>{
 const origin={uid:'origin',location:{lng:120,lat:30}},poly=[[[119.999,29.999],[120.001,29.999],[120.001,30.001],[119.999,30.001],[119.999,29.999]]],group={id:'education',subtypes:[{id:'primary_school'}]};
 const make=(uid,lng,meters)=>{const location={lng,lat:30},r=meters==null?null:modelRoute({routeStatus:'ok',mode:'walking',coordinateSystem:'BD-09LL',durationSeconds:1800,distanceMeters:meters,origin:origin.location,originUid:origin.uid,destination:location,destinationUid:uid,requestedDestination:{location,uid}},WALKING80_MODEL);return{uid,identityKey:'uid:'+uid,name:uid,location,subtypeIds:['primary_school'],routeEvidence:r,accessStateText:'stale'};};
 const rows=[make('outside',120.002,1199),make('overtime',120,1201),make('unknown',120.0005,null)],job={geometrySource:'walking_sampling_fallback',analysis:{origin,categories:[]},geojson:{features:[{properties:{featureType:'sampled_boundary'},geometry:{type:'Polygon',coordinates:poly}}]}};
 const map=mapPresentationRows(rows,job,[group]);assert.deepEqual(map.map(p=>p.accessState),['inside_over_threshold','pending_verification','outside_reachable']);
 const tree={categories:[group]},view=facilityViewRows({...job.analysis,poiMarkers:rows},tree);assert.equal(view.find(p=>p.uid==='outside').status,'reachable');assert.equal(view.find(p=>p.uid==='overtime').status,'over_threshold');assert.equal(view.find(p=>p.uid==='unknown').status,'unknown');
 const stale=structuredClone(rows[0]);stale.routeEvidence.originUid='wrong';assert.equal(facilityViewRows({...job.analysis,poiMarkers:[stale]},tree)[0].status,'unknown');
});
