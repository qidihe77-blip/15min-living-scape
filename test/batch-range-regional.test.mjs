import test from 'node:test';import assert from 'node:assert/strict';
import {sampleBatchWalkingRange,smoothSupportedRing,pointInRing} from '../server/batch-walking-range.mjs';
import {assessRegionalGaps,reweightRegionalGaps} from '../server/regional-gaps.mjs';
import {analyticRoadProvider} from './fixtures/adaptive-roads.mjs';
import {straightDistanceMeters} from '../server/facility-coverage.mjs';
import {validateBoundaryRing} from '../server/boundary-geometry.mjs';
import {createBaiduRouteProvider} from '../server/baidu-route.mjs';
import {styleCacheKey,validStyleResponse,createMapStyleCache} from '../server/map-style-cache.mjs';
import {mkdtemp,writeFile,mkdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
const center={lat:30,lng:120},origin={uid:'origin',location:center};
function matrix({failSector=null,allFail=false,badUid=false}={}){let calls=0,outputs=0;return{stats:()=>({calls,outputs}),routeMany:async({origin,destinations})=>{calls++;outputs+=destinations.length;return destinations.map((p,i)=>({routeStatus:allFail||i===failSector?'no_route':'ok',mode:'walking',source:'route_matrix',coordinateSystem:'BD-09LL',distanceMeters:straightDistanceMeters(origin.location,p)*(1.2+.1*Math.sin(i)),durationSeconds:straightDistanceMeters(origin.location,p)*1.4,evidenceId:'fixture-'+calls+'-'+i,requestedOrigin:{...origin,uid:badUid?'stale':origin.uid},requestedDestination:{location:p,uid:null}}));}};}
test('36 directions three rounds use108 output costs/3 HTTP batches; fixed80 differs from raw duration; valid near boundary never becomes road geometry',async()=>{
 const p=matrix(),g=await sampleBatchWalkingRange({center,originUid:'origin',matrixProvider:p});assert.deepEqual(p.stats(),{calls:3,outputs:108});assert.equal(g.geometryStatus,'sampled_approximation');assert.equal(g.samples.length,108);assert.equal(g.samplingDiagnostics.matrixOutputs,108);assert.equal(g.samplingDiagnostics.officialApisUsed,false);
 assert.equal(g.boundaryEstimates.length,36);assert.ok(g.samples.every(s=>!s.geometry));assert.ok(g.samples.some(s=>s.coverageStatus==='covered'&&s.durationSeconds>900));assert.ok(validateBoundaryRing(g.geojson.features[0].geometry.coordinates[0]).valid);assert.equal(g.unknownRegions.unmeasuredInterior,true);
});
test('unresolved direction and staleUID do not produce fake midpoint/median circle; no extra36 requests for partial direction gaps',async()=>{
 for(const options of[{failSector:3},{badUid:true}]){const p=matrix(options),g=await sampleBatchWalkingRange({center,originUid:'origin',matrixProvider:p});assert.equal(g.geometryStatus,'unknown');assert.equal(g.geojson.features.length,0);assert.ok(g.unknownRegions.failedSectors.length);assert.equal(p.stats().calls,options.badUid?1:3);}
});
test('whole matrix failure or insufficient matrix budget uses at most36 real Walking paths; fewer path directions stay unknown',async()=>{
 const p=analyticRoadProvider(),g=await sampleBatchWalkingRange({center,walkingProvider:p,maxMatrixOutputs:0});assert.equal(p.stats().calls,36);assert.equal(g.engine,'walking-polyline-fallback');assert.equal(g.geometryStatus,'sampled_approximation');assert.equal(g.samplingDiagnostics.sampleCount,36);
 const q=analyticRoadProvider(),h=await sampleBatchWalkingRange({center,walkingProvider:q,maxMatrixOutputs:0,maxRouteCalls:20});assert.equal(h.geometryStatus,'unknown');assert.equal(q.stats().calls,20);
});
test('a materially nonmonotone route cost leaves that direction unknown and never closes a fake boundary',async()=>{
 let round=0;const p=matrix(),wrapped={routeMany:async options=>{const rows=await p.routeMany(options);round++;rows[0].distanceMeters=round===1?1150:round===2?1050:1250;return rows;}};
 const g=await sampleBatchWalkingRange({center,originUid:'origin',matrixProvider:wrapped});assert.equal(g.geometryStatus,'unknown');assert.equal(g.geojson.features.length,0);assert.ok(g.samplingDiagnostics.failedSamples.some(s=>s.sector===0&&s.reasonCode==='non_monotonic_reachability'));assert.equal(p.stats().calls,3);
});
test('closed spline never silently expands a concave boundary or accepts a self crossing',()=>{
 const ring=[[120,30],[120.02,30],[120.02,30.02],[120.011,30.008],[120,30.02],[120,30]],smooth=smoothSupportedRing(ring);
 assert.ok(validateBoundaryRing(smooth.ring).valid);assert.ok(smooth.ring.every(p=>pointInRing(p,ring)));assert.equal(smooth.method,'validated_linear');
});
const ring=[[119.99,29.99],[120.01,29.99],[120.01,30.01],[119.99,30.01],[119.99,29.99]],geometry={geojson:{features:[{properties:{featureType:'sampled_boundary'},geometry:{type:'Polygon',coordinates:[ring]}}]}},ids=['education','medical','commerce','transport','eldercare','leisure'];
const analysis=(complete=true)=>({origin,categoryMappingVersion:'facility-categories-v7',categories:ids.map(categoryId=>({categoryId,label:categoryId,poiMarkers:[],subtypeResults:[{searchComplete:complete,searchTruncated:!complete,searchStatus:'ok',subtypeId:'none'}]}))});
test('grid verification uses model900/901 boundary, keeps provider seconds distinct and excludes measured outside centres from denominator',async()=>{
 const p={routeMany:async({origin,destinations})=>destinations.map((p,i)=>({routeStatus:'ok',mode:'walking',source:'route_matrix',coordinateSystem:'BD-09LL',distanceMeters:i===0?1201:1200,durationSeconds:901,evidenceId:'cell-'+i,requestedOrigin:origin,requestedDestination:{location:p,uid:null}}))};
 const g=await assessRegionalGaps({analysis:analysis(),geometry,matrixProvider:p});assert.equal(g.cells.length,25);assert.equal(g.requestStats.httpRequests,1);assert.equal(g.requestStats.matrixOutputRoutes,25);assert.equal(g.summary.outsideVerifiedCells,1);assert.equal(g.summary.verifiedCells,25);assert.equal(g.blindZones.length,24);assert.equal(g.summary.blindRatio,100);assert.equal(g.specialty1kmUnchanged,true);assert.equal(g.affectsOverallScore,false);assert.ok(g.blindZones.every(c=>c.originEvidence.modelDurationSeconds===900&&c.originEvidence.providerDurationSeconds===901));
});
test('incomplete POI recall or failed matrix stays unknown and cannot be counted as absent or verified regional blindness',async()=>{
 const g=await assessRegionalGaps({analysis:analysis(false),geometry,matrixProvider:matrix()});assert.equal(g.blindZones.length,0);assert.equal(g.summary.blindRatio,null);assert.ok(g.cells.every(c=>c.scoreInterval.high===100));
 const h=await assessRegionalGaps({analysis:analysis(),geometry});assert.equal(h.blindZones.length,0);assert.equal(h.summary.blindRatio,null);assert.equal(h.reasonCode,'matrix_unavailable');assert.ok(h.cells.every(c=>c.status==='pending_reachability'));
 const empty=await assessRegionalGaps({analysis:analysis(),geometry:null});assert.equal(empty.reasonCode,'walking_range_unavailable');assert.equal(empty.cells.length,0);
});
test('matrix adapter accepts numbers and value objects, preserves ordering and UID binding; zero/no-route is unknown',async()=>{
 const client={requestJson:async()=>({data:{result:[{distance:123,duration:101},{distance:{value:456},duration:{value:300}},{distance:0,duration:0}]},meta:{retrievedAt:'offline',cached:false}})};
 const p=createBaiduRouteProvider({client,matrixEnabled:true,matrixVerified:true,matrixOutputLimit:3,matrixOutputQps:3});const rows=await p.routeMatrix({origins:[origin],destinations:[center,{lat:30.001,lng:120},{lat:30.002,lng:120}]});
 assert.equal(rows[0].distanceMeters,123);assert.equal(rows[1].durationSeconds,300);assert.equal(rows[0].requestedOrigin.uid,'origin');assert.equal(rows[2].routeStatus,'no_route');
});
test('priority reweight uses existing grid costs only; zero total and unverified newly blind centres remain unknown',async()=>{
 const g=await assessRegionalGaps({analysis:analysis(false),geometry}),snapshot=JSON.stringify(g),zero=reweightRegionalGaps(g,Object.fromEntries(ids.map(id=>[id,0])));
 assert.equal(zero.coverageScore,null);assert.ok(zero.cells.every(c=>c.score===null&&!c.blind));assert.equal(zero.newRequestsOnReweight,0);assert.equal(JSON.stringify(g),snapshot);
 const only=reweightRegionalGaps(g,{education:6,medical:0,commerce:0,transport:0,eldercare:0,leisure:0});assert.equal(only.blindZones.length,0);assert.equal(only.summary.blindRatio,null);assert.ok(only.cells.every(c=>c.unknownCategoryIds.join(',')==='education'));
});
test('exact style response cache ignores signatures/timestamps but separates stylesheet/version, shares pending and never proxies arbitrary services',async()=>{
 const root=await mkdtemp(join(tmpdir(),'life-style-test-')),a=new URLSearchParams({ak:'browser-fixture',qt:'custom_v2',version:'4',styles:'published-blue',timeStamp:'1',sign:'x'}),b=new URLSearchParams(a);b.set('timeStamp','2');b.set('sign','y');assert.equal(styleCacheKey(a),styleCacheKey(b));b.set('styles','other');assert.notEqual(styleCacheKey(a),styleCacheKey(b));
 let calls=0;const body=JSON.stringify({status:0,data:{style:[[],[],[]]}}),cache=createMapStyleCache({root,browserMapAk:'browser-fixture',fetcher:async()=>{calls++;await new Promise(r=>setTimeout(r,10));return{ok:true,text:async()=>body};}});
 const [x,y]=await Promise.all([cache.get(a),cache.get(a)]);assert.equal(calls,1);assert.equal(x.body,y.body);assert.equal((await cache.get(a)).source,'exact_response_cache');assert.equal(calls,1);const bad=new URLSearchParams(a);bad.set('ak','not-browser-key');await assert.rejects(()=>cache.get(bad));assert.equal(validStyleResponse('{"status":1}'),false);assert.equal(cache.stats().hits,1);
});
