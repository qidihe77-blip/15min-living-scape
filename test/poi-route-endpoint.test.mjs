import test from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';
import{bindFacilityRouteEvidence}from'../server/nearest-facility.mjs';
import{straightDistanceMeters}from'../server/facility-coverage.mjs';
import{withinWalkingLimit}from'../web/walking-model.js';
const f=JSON.parse(await readFile(new URL('./fixtures/poi-navigation-offset.json',import.meta.url),'utf8'));
const bind=(facility=f.facility,route=f.raw)=>bindFacilityRouteEvidence({route,facility,demandPoint:f.origin,classification:f.previous.classification,walkingModelId:'walking80-v1'});
test('real park path near exact UID POI survives a distant navigation hint without changing cost',()=>{
 const line=f.raw.geometry.coordinates,end={lng:line.at(-1)[0],lat:line.at(-1)[1]};assert.ok(straightDistanceMeters(f.raw.providerDestination,end)>150);assert.ok(straightDistanceMeters(f.facility.location,end)<40);
 const r=bind();assert.deepEqual(r.geometry,f.raw.geometry);assert.equal(r.geometryEndpointReference,'bound_facility_poi');assert.equal(r.distanceMeters,f.previous.distanceMeters);assert.equal(r.modelDurationSeconds,716.25);assert.ok(withinWalkingLimit(r));
});
test('POI fallback cannot accept a different UID, unbound request, wrong origin, station centroid or remote path',()=>{
 for(const r of [{...f.raw,requestedDestination:{...f.raw.requestedDestination,uid:'other'}},{...f.raw,requestedOrigin:{...f.raw.requestedOrigin,uid:'other'}},{...f.raw,requestedDestination:null},{...f.raw,geometry:{type:'LineString',coordinates:[[115,28],[115.001,28.001]]}}])assert.equal(bind(f.facility,r).geometry,null);
 assert.equal(bind({...f.facility,stationName:'Station'}).geometry,null);
});
