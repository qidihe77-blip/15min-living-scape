import test from 'node:test';import assert from 'node:assert/strict';
import{circleFacilityRows,mapFacilityRows,mapPresentationRows,walkingRangePolygons,insideWalkingRange,accessibilityTrend}from'../web/circle-presentation.js';
import{accessibilityHeatModel,createAccessibilityHeatLayer}from'../web/accessibility-heat.js';
import{uiSnapshot}from'../server/ui-snapshot.mjs';
const origin={location:{lng:120,lat:30},uid:'origin'},ring=[[119.99,29.99],[120.01,29.99],[120.01,30.01],[119.99,30.01],[119.99,29.99]];
const job=()=>({analysisId:'fa-test',geometrySource:'walking_sampling_fallback',analysis:{origin,categories:[]},geojson:{features:[{properties:{featureType:'sampled_boundary',coordinateSystem:'BD-09LL'},geometry:{type:'Polygon',coordinates:[ring]}}]}});
const row=(uid,seconds,location=origin.location)=>({uid,identityKey:'uid:'+uid,location,subtypeIds:['hospital'],routeEvidence:seconds==null?null:{routeStatus:'ok',mode:'walking',coordinateSystem:'BD-09LL',origin,originUid:'origin',destination:location,destinationUid:uid,durationSeconds:seconds,distanceMeters:seconds*80/60}});
test('circle POIs preserve unknown and >900s members, exclude outside/holes, include boundary and deduplicate UID without promoting evidence',()=>{
 const j=job(),rows=[row('reachable',120),row('unknown',null),row('late',901),row('outside',120,{lng:120.02,lat:30}),row('boundary',null,{lng:120.01,lat:30}),row('unknown',null)],before=JSON.stringify(rows);
 assert.deepEqual(circleFacilityRows(rows,j).map(p=>p.uid),['reachable','unknown','late','boundary']);assert.equal(JSON.stringify(rows),before);
 j.geojson.features[0].geometry.coordinates.push([[119.999,29.999],[120.001,29.999],[120.001,30.001],[119.999,30.001],[119.999,29.999]]);
 assert.equal(circleFacilityRows(rows,j).some(p=>p.uid==='unknown'),false);
 j.geojson.features=[];assert.equal(circleFacilityRows(rows,j).length,0);assert.deepEqual(mapFacilityRows(rows,j).map(p=>p.uid),['reachable','outside']);
});
test('invalid or schematic geometry never becomes a circle for POI counts or heat',()=>{
 const j=job();j.geojson.features[0].properties.featureType='known_reachable_envelope';assert.equal(walkingRangePolygons(j).length,0);
 j.geojson.features[0].properties.featureType='sampled_boundary';j.geojson.features[0].geometry.coordinates[0]=[[120,30],[121,31],[120,31],[121,30],[120,30]];assert.equal(walkingRangePolygons(j).length,0);
});
test('unclassified circle candidates remain neutral and clickable; confirmed category filters never infer from pending subtypes',()=>{
 const p={...row('pending',null),subtypeIds:[],pendingSubtypeIds:['hospital']},confirmed=row('hospital',null),categories=[{id:'medical',subtypes:[{id:'hospital'}]}],before=JSON.stringify([p,confirmed]);
 const mapped=mapPresentationRows([p,confirmed],job(),categories);assert.equal(mapped.length,2);assert.equal(mapped[0].onMap,true);assert.equal(mapped[0].classificationUncertain,true);assert.deepEqual(mapped[0].memberships,[]);assert.deepEqual(mapped[1].memberships,['medical']);assert.equal(JSON.stringify([p,confirmed]),before);
});
test('UI projection adds inside unknown POIs but retains outside verified evidence, score and complete audit untouched',()=>{
 const j={...job(),score:{S_low:60,S_high:100,evidenceFingerprint:'same'},display:{facilities:[row('inside',null),row('outside',120,{lng:120.02,lat:30}),row('far',null,{lng:120.03,lat:30})],routes:[]}},before=JSON.stringify(j),ui=uiSnapshot(j);
 assert.deepEqual(ui.display.facilities.map(p=>p.uid),['inside','outside']);assert.equal(ui.display.circlePoiCount,1);assert.equal(ui.display.circleCountIsWalkingProof,false);assert.deepEqual(ui.score,j.score);assert.equal(JSON.stringify(j),before);
});
test('growth uses bound existing costs, UID union and 900/901 boundary; model time differs from provider time',()=>{
 const a=row('a',180),b=row('b',360),c=row('c',900),d=row('d',901),stale=row('stale',100);stale.routeEvidence={...stale.routeEvidence,originUid:'other'};
 const model=row('model',1000);model.routeEvidence={...model.routeEvidence,walkingModelId:'walking80-v1',distanceMeters:1200,modelDurationSeconds:900};
 assert.deepEqual(accessibilityTrend([a,a,b,c,d,stale,row('unknown',null),model],origin).map(p=>p.count),[0,1,2,2,2,4]);
});
function gridJob(){const j=job();j.regionalGaps={origin,gridSize:3,status:'partial',cells:[{id:4,x:1,y:1,center:origin.location,score:60,coverageByCategory:{education:{low:.9,high:1,estimated:true}},originReachability:'unknown',insideCircle:true}]};return j;}
test('heat reads stored overall/category score, stays within concave range and excludes missing, outside or stale data',()=>{
 const j=gridJob(),before=JSON.stringify(j),all=accessibilityHeatModel(j),education=accessibilityHeatModel(j,'education');assert.equal(all.cellCount,1);assert.equal(all.polygons[0].score,60);assert.equal(education.polygons[0].score,90);assert.equal(accessibilityHeatModel(j,'medical').status,'unavailable');assert.equal(JSON.stringify(j),before);
 for(const piece of all.polygons)for(const p of piece.path)assert.equal(insideWalkingRange({lng:p[0],lat:p[1]},walkingRangePolygons(j)),true);
 j.regionalGaps.cells[0].outsideVerified=true;assert.equal(accessibilityHeatModel(j).status,'unavailable');j.regionalGaps.cells[0].outsideVerified=false;j.regionalGaps.origin={...origin,uid:'stale'};assert.equal(accessibilityHeatModel(j).reasonCode,'coverage_origin_mismatch');
 const concave=gridJob();concave.geojson.features[0].geometry.coordinates[0]=[[119.99,29.99],[120.01,29.99],[120.01,30.01],[120.003,30.01],[120.003,30],[119.997,30],[119.997,30.01],[119.99,30.01],[119.99,29.99]];concave.regionalGaps.cells=[{...concave.regionalGaps.cells[0],id:1,x:1,y:0,center:{lng:120,lat:29.993},score:0}];
 const clipped=accessibilityHeatModel(concave);assert.equal(clipped.status,'available');for(const piece of clipped.polygons)for(const p of piece.path)assert.equal(insideWalkingRange({lng:p[0],lat:p[1]},walkingRangePolygons(concave)),true);
});
test('heat layer is non-clickable, uses existing polygon data and disposes all overlays without provider calls',()=>{
 const overlays=[],B={Point:class{constructor(lng,lat){Object.assign(this,{lng,lat});}},Polygon:class{constructor(path,options){Object.assign(this,{path,options});}}},map={addOverlay:o=>overlays.push(o),removeOverlay:o=>overlays.splice(overlays.indexOf(o),1)};
 const layer=createAccessibilityHeatLayer(B,map,accessibilityHeatModel(gridJob()));assert.ok(overlays.length);assert.ok(overlays.every(o=>o.options.enableClicking===false&&o.options.strokeOpacity===0&&o.lifeCircleLayer==='accessibility-heat'));layer.dispose();assert.equal(overlays.length,0);
});
