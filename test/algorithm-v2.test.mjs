import test from 'node:test';import assert from 'node:assert/strict';
import {farthestDirectionOrder,robustDetour,observeSector} from '../server/adaptive-sampling.mjs';
import {cleanSampleBoundary,validateBoundaryRing} from '../server/boundary-geometry.mjs';
import {parseIsochronePath} from '../server/baidu-isochrone.mjs';
import {validOfficialWalkingRange} from '../server/reachability-evidence.mjs';
import {sampleWalking80Range} from '../server/walking80-sampling.mjs';
import {analyticRoadProvider} from './fixtures/adaptive-roads.mjs';
import {createBaiduClient} from '../server/baidu-client.mjs';
import {createBaiduRouteProvider} from '../server/baidu-route.mjs';
import {prepareFacilitySearches,createFacilityAnalysis} from '../server/facility-analysis.mjs';
import {publicFacilityCategoryTree} from '../server/facility-categories.mjs';
import {evaluateSubtypeAccess,prepareSubtypeCandidates} from '../server/nearest-facility.mjs';
import {applyFacilityRouteDetail} from '../server/facility-route-detail.mjs';
import {scoreSixGroupPriorities} from '../server/priority-score.mjs';
import {knownSampleDiagnostics} from '../server/analysis-diagnostics.mjs';
import {makeUi16Job} from '../scripts/ui16-fixtures.mjs';
const point={lng:120,lat:30},origin={id:'offline',uid:'o',location:point},version='facility-categories-v6',wait=ms=>new Promise(r=>setTimeout(r,ms));
const response=(data)=>({ok:true,status:200,json:async()=>data}),request={service:'place',path:'/place/v3/around',params:{query:'fixture'}};
const route=async(a,b,o={})=>({routeStatus:'ok',mode:'walking',coordinateSystem:'BD-09LL',durationSeconds:400,distanceMeters:640,source:'explicit_offline_fixture',
 requestedOrigin:{location:a,uid:o.originUid??null},requestedDestination:{location:b,uid:o.destinationUid??null},retrievedAt:'2026-10-10T00:00:00Z'});
test('adaptive directions maximize early angular spread; robust detour is only a proposal statistic',()=>{
 assert.deepEqual(farthestDirectionOrder(),[0,4,2,6,1,3,5,7]);assert.throws(()=>farthestDirectionOrder(33));
 const stats=robustDetour([1.2,1.3,9].map(r=>({coverageStatus:'covered',radiusMeters:200,distanceMeters:200*r})));
 assert.equal(stats.median,1.3);assert.equal(stats.scope,'sampling_proposal_only');assert.equal(robustDetour([]).median,null);
});
test('same 24-call budget narrows monotonic brackets without claiming unmeasured interior',async()=>{
 const p=analyticRoadProvider({latencyMs:1}),g=await sampleWalking80Range({center:point,originUid:'o',provider:p});
 assert.equal(p.stats().calls,24);assert.equal(p.stats().peak,2);assert.ok(g.sampleMetrics.radialBrackets.every(b=>Math.abs(b.lowerMeters-990)<.01));
 assert.equal(g.algorithmVersion,'walking80-adaptive-brackets-v2');assert.equal(g.unknownRegions.unmeasuredInterior,true);
 const boundary=g.geojson.features.find(f=>f.geometry.type==='Polygon');assert.equal(boundary.properties.interiorStatus,'unknown_between_samples');
 assert.ok(boundary.geometry.coordinates[0].slice(0,-1).every(p=>g.samples.some(s=>s.lng===p[0]&&s.lat===p[1]&&s.coverageStatus==='covered')));
});
test('strong detours now search inward; failed or non-monotonic sectors publish no artificial circle',async()=>{
 for(const settings of[{ratios:Array(8).fill(3.5)},{failSector:2},{nonMonotonicSector:3}]){
 const p=analyticRoadProvider(settings),g=await sampleWalking80Range({center:point,originUid:'o',provider:p});assert.ok(p.stats().calls<=24);
 if(settings.ratios)assert.equal(g.geometryStatus,'sampled_approximation');else{assert.equal(g.geometryStatus,'unknown');assert.ok(!g.geojson.features.some(f=>f.geometry.type==='Polygon'));}
 if(settings.nonMonotonicSector!=null){assert.equal(g.samplingDiagnostics.boundaryReasonCode,'non_monotonic_sampling');assert.ok(g.unknownRegions.failedSectors.includes(3));}}
});
test('small sampling budgets keep dispersed evidence and never close missing directions',async()=>{
 for(const maxRouteCalls of[0,2,8,16]){const p=analyticRoadProvider(),g=await sampleWalking80Range({center:point,provider:p,maxRouteCalls});assert.equal(p.stats().calls,maxRouteCalls);
 assert.equal(g.geometryStatus,maxRouteCalls<16?'unknown':'sampled_approximation');assert.equal(g.unknownRegions.unmeasuredInterior,true);if(maxRouteCalls===2)assert.deepEqual(p.stats().log.map(s=>s.sector),[0,4]);}
 await assert.rejects(sampleWalking80Range({center:{lng:999,lat:30},provider:analyticRoadProvider()}));
});
test('boundary validation retains coordinates, rejects self-crossing, collapsed and degenerate rings',()=>{
 const ring=[[120,30],[120.001,30],[120.001,30.001],[120,30.001]],clean=cleanSampleBoundary(ring,{center:point});
 assert.deepEqual(clean.ring,[...ring,ring[0]]);assert.equal(clean.coordinateChange,'closure_only');
 assert.equal(cleanSampleBoundary([ring[0],ring[2],ring[1],ring[3]],{center:point}).reasonCode,'self_intersecting_boundary');
 assert.equal(cleanSampleBoundary([ring[0],ring[1],ring[1],ring[3]],{center:point}).reasonCode,'collapsed_boundary_vertices');
 assert.equal(cleanSampleBoundary([[120,30],[120.001,30],[120.002,30]],{center:point}).reasonCode,'degenerate_boundary');
 assert.equal(cleanSampleBoundary([[NaN,30],ring[1],ring[3]],{center:point}).reasonCode,'invalid_boundary_coordinates');
});
test('sampler retains valid cost but does not publish malformed or wrong-endpoint provider paths',async()=>{
 const road=analyticRoadProvider(),p={route:async(...args)=>({...await road.route(...args),geometry:{type:'LineString',coordinates:[[110,20],[111,21]]}})};
 const g=await sampleWalking80Range({center:point,provider:p});assert.equal(g.geometryStatus,'sampled_approximation');
 assert.ok(g.geojson.features.every(f=>f.geometry.type==='Polygon'));assert.equal(g.samplingDiagnostics.unavailablePathSamples.length,24);
 assert.ok(g.samplingDiagnostics.unavailablePathSamples.every(s=>s.geometryStatus==='endpoint_geometry_mismatch'));
});
test('official geometry also rejects self-crossing rings, while a dense valid provider boundary retains every vertex',()=>{
 const ring=[[120,30],[120.003,30.002],[120.001,30.002],[120.003,30],[120,30]];
 assert.equal(validateBoundaryRing(ring).reasonCode,'self_intersecting_boundary');
 assert.throws(()=>parseIsochronePath(ring.map(p=>p.join(',')).join(';')),e=>e.code==='invalid_geometry');
 const geometry={geometrySource:'baidu_isochrone',mode:'walking',thresholdSeconds:900,coordinateSystem:'BD-09LL',center:point,geojson:{type:'FeatureCollection',features:[{geometry:{type:'Polygon',coordinates:[ring]},properties:{mode:'walking',thresholdSeconds:900,coordinateSystem:'BD-09LL'}}]}};
 assert.equal(validOfficialWalkingRange(geometry,point),false);
 const dense=Array.from({length:3000},(_,i)=>[120+.01*Math.cos(i*2*Math.PI/3000),30+.01*Math.sin(i*2*Math.PI/3000)]);dense.push(dense[0]);
 assert.equal(validateBoundaryRing(dense).valid,true);assert.deepEqual(parseIsochronePath(dense.map(p=>p.join(',')).join(';')).coordinates[0],dense);
});
test('incomplete search stays unknown, complete empty search alone may be absent; all-candidates does not stop after first witness',async()=>{
 const tree=publicFacilityCategoryTree(version),provider={route};const facilities=Array.from({length:4},(_,i)=>({uid:'pharmacy-'+i,name:'社区药店'+i,rawCategory:'医疗;药店',location:{lng:120+.001*i,lat:30}}));
 const placeProvider={searchAround:async({subtypeId})=>({searchComplete:subtypeId!=='secondary_school',truncated:subtypeId==='secondary_school',status:'complete',
  candidates:subtypeId==='pharmacy'?facilities:[],pages:[{pageNum:0}]})};
 const a=await createFacilityAnalysis({placeProvider,routeProvider:provider,concurrency:2}).analyze({origin,categoryMappingVersion:version,categoryIds:tree.categories.map(g=>g.id),walkingModelId:'walking80-v1',routeScope:'all_candidates',maxRouteCandidatesPerSubtype:3});
 const rows=a.categories.flatMap(g=>g.subtypeResults);assert.equal(rows.find(s=>s.subtypeId==='pharmacy').routes.length,4);
 assert.equal(rows.find(s=>s.subtypeId==='secondary_school').accessStatus,'unknown');assert.equal(rows.find(s=>s.subtypeId==='hospital').accessStatus,'no_reachable_in_declared_search');
 assert.equal(a.performance.routeRounds,4);assert.equal(a.performance.candidatePlanCount,17);
});
test('a route request slot covers response body parsing, and queued time does not consume network timeout',async()=>{
 let active=0,peak=0,calls=0;const client=createBaiduClient({mode:'mock',timeoutMs:150,maxRetries:0,fetchImpl:async()=>{
 calls++;peak=Math.max(peak,++active);return{ok:true,status:200,json:async()=>{await wait(65);active--;return{status:0};}};}});
 const result=await Promise.all(Array.from({length:6},(_,i)=>client.requestJson({...request,params:{query:'body-'+i}})));
 assert.equal(result.length,6);assert.equal(calls,6);assert.equal(peak,2);
 const bodyTimeout=createBaiduClient({mode:'mock',timeoutMs:20,maxRetries:0,fetchImpl:async()=>({ok:true,status:200,json:async()=>{await wait(40);return{status:0};}})});
 await assert.rejects(bodyTimeout.requestJson(request),{code:'timeout'});
});
test('in-flight request coalescing isolates cancellation scopes A/B/A and returns independent copies',async()=>{
 let calls=0;const a=new AbortController(),b=new AbortController(),client=createBaiduClient({mode:'mock',maxRetries:0,fetchImpl:async()=>{calls++;await wait(10);return response({status:0,result:{value:1}});}});
 const pending=[client.requestJson({...request,signal:a.signal}),client.requestJson({...request,signal:b.signal}),client.requestJson({...request,signal:a.signal})];
 const rows=await Promise.all(pending);assert.equal(calls,2);rows[0].data.result.value=9;assert.equal(rows[2].data.result.value,1);assert.equal(client.stats().pendingScopes,0);
});
test('bounded TTL LRU caches evict oldest and never return mutable shared results',async()=>{
 let calls=0,now=1000;const client=createBaiduClient({mode:'mock',cacheMaxEntries:2,maxRetries:0,now:()=>now,fetchImpl:async()=>{calls++;return response({status:0,value:calls});}});
 const get=q=>client.requestJson({...request,params:{query:q},cacheTtlMs:100});await get('a');await get('b');await get('a');await get('c');
 assert.equal(client.stats().cacheEntries,2);const v=await get('b');assert.equal(v.meta.cached,false);assert.equal(calls,4);now+=101;await get('c');assert.equal(calls,5);assert.equal(client.stats().cacheEntries,1);
});
test('failure gates stop only the affected endpoint and never silently retry authorization errors',async()=>{
 let calls=0;const client=createBaiduClient({mode:'mock',maxRetries:0,failureCooldownMs:5000,fetchImpl:async url=>{calls++;return response({status:new URL(url).pathname.includes('isodistance')?240:0});}});
 const distance={service:'isochrone',path:'/logistics_truck/v1/isodistance',params:{}};
 await assert.rejects(client.requestJson(distance),e=>e.apiStatus===240);await assert.rejects(client.requestJson(distance),e=>e.code==='permission_denied'&&e.retryAfterMs===null);
 await client.requestJson({...distance,path:'/isochrone/v1/isochrone'});await client.requestJson(request);assert.equal(calls,3);
 client.resetFailureGate(distance);await assert.rejects(client.requestJson(distance));assert.equal(calls,4);
});
test('three transient failures cool down without background requests; explicit later request can recover',async()=>{
 let calls=0,now=0;const client=createBaiduClient({mode:'mock',maxRetries:0,failureCooldownMs:5000,now:()=>now,fetchImpl:async()=>{calls++;if(calls<=3)throw Error('offline network fault');return response({status:0});}});
 for(let i=0;i<3;i++)await assert.rejects(client.requestJson(request),{code:'upstream_unavailable'});
 await assert.rejects(client.requestJson(request),e=>e.code==='service_cooldown'&&e.retryAfterMs===5000);assert.equal(calls,3);
 now=5001;await client.requestJson(request);assert.equal(calls,4);
});
test('route provider keeps bounded origin/UID-specific caches and same-scope promises',async()=>{
 let calls=0;const provider=createBaiduRouteProvider({cacheMaxEntries:2,liteRequestLimit:10,client:{requestJson:async()=>{calls++;await wait(5);return{data:{result:{routes:[{duration:100,distance:150}]}},meta:{retrievedAt:'fixed'}};}}});
 const a=new AbortController(),b=new AbortController(),dest={lng:120.001,lat:30};
 await Promise.all([provider.route(point,dest,{signal:a.signal,originUid:'o'}),provider.route(point,dest,{signal:b.signal,originUid:'o'}),provider.route(point,dest,{signal:a.signal,originUid:'o'})]);assert.equal(calls,2);
 await provider.route({...point,lng:120.002},dest,{originUid:'o'});await provider.route(point,dest,{originUid:'different'});
 await provider.route(point,dest,{originUid:'o'});assert.equal(calls,5);
});
test('adaptive recall preserves fair first 17 requests and gives missing subtype a continuation before budget ends',async()=>{
 const tree=publicFacilityCategoryTree(version),subtypes=tree.categories.flatMap(g=>g.subtypes),log=[];let calls=0;
 const placeProvider={canSearch:()=>calls<30,searchAround:async({subtypeId,continuation})=>{calls++;log.push({subtypeId,continued:!!continuation});const s=subtypes.find(s=>s.id===subtypeId);
 return{searchComplete:false,truncated:true,pages:[{pageNum:0}],candidates:subtypeId==='sports'&&!continuation?[]:[{uid:subtypeId,name:s.searchQueries[0],rawCategory:s.rawCategoryHints[0],location:point}],continuation:{queue:[{pageNum:1,shard:{depth:0}}]}};}};
 const p=await prepareFacilitySearches({placeProvider,analysisLocation:origin,categoryMappingVersion:version,searchRadiusMeters:1500,concurrency:2,adaptive:true});
 assert.equal(calls,30);assert.deepEqual(log.slice(0,17).map(r=>r.subtypeId),p.order.map(s=>s.id));assert.equal(log[17].subtypeId,'sports');assert.equal(p.searches.get('sports').candidates.length,1);
 assert.ok([...p.searches.values()].every(s=>s.searchComplete===false));assert.equal(p.recallSchedule.scope,'scheduling_only');
});
test('prepared subtype candidates preserve decisions, UID dedup and 900/901 raw boundaries; reject stale origins and forged tokens',async()=>{
 const facilities=[{uid:'school',name:'社区中学',rawCategory:'教育培训;中学',location:{lng:120.001,lat:30}},{uid:'school',name:'社区中学',rawCategory:'教育培训;中学',location:{lng:120.001,lat:30}}];
 const parameters={demandPoint:origin,subtypeId:'secondary_school',categoryMappingVersion:version,facilities};const token=prepareSubtypeCandidates(parameters),memo=new Map();let calls=0;
 const provider={route:async(...args)=>{calls++;return{...await route(...args),durationSeconds:901,distanceMeters:1200,evidenceId:'edge'};}};
 const common={...parameters,searchComplete:true,provider,walkingModelId:'walking80-v1',routeMemo:memo,observedAt:'fixed'};
 const unprepared=await evaluateSubtypeAccess(common),prepared=await evaluateSubtypeAccess({...common,preparedCandidates:token});
 assert.deepEqual({...prepared,nearestAlgorithmVersion:unprepared.nearestAlgorithmVersion},unprepared);assert.equal(calls,1);assert.equal(prepared.routes[0].durationSeconds,901);assert.equal(prepared.accessStatus,'reachable');
 await assert.rejects(evaluateSubtypeAccess({...common,preparedCandidates:token,demandPoint:{...origin,location:{lng:120.01,lat:30}}}),/scope mismatch/);
 await assert.rejects(evaluateSubtypeAccess({...common,preparedCandidates:{}}),/scope mismatch/);
});
test('all-candidates detail refresh preserves every previously verified route beyond the old three-candidate cap',async()=>{
 const{job}=await makeUi16Job(),analysis=job.analysis,sub=analysis.categories.find(g=>g.categoryId==='medical').subtypeResults.find(s=>s.subtypeId==='pharmacy');
 const extra=Array.from({length:3},(_,i)=>({...analysis.poiMarkers.find(p=>p.uid==='pharmacy-0'),uid:'extra-pharmacy-'+i,location:{lng:120+.00001*i,lat:30}}));
 analysis.poiMarkers.push(...extra);const all=await evaluateSubtypeAccess({demandPoint:analysis.origin,categoryMappingVersion:version,subtypeId:'pharmacy',facilities:analysis.poiMarkers.filter(p=>p.queriedSubtypeIds.includes('pharmacy')),
  searchComplete:true,walkingModelId:'walking80-v1',maxRouteCandidates:5,provider:{route}});Object.assign(sub,all);
 const previous=sub.routes[0],newRoute={...previous,distanceMeters:1000,durationSeconds:850,evidenceId:'new-detail'};
 const changed=await applyFacilityRouteDetail(analysis,previous,newRoute),next=changed.categories.find(g=>g.categoryId==='medical').subtypeResults.find(s=>s.subtypeId==='pharmacy');
 assert.equal(next.routes.length,5);assert.deepEqual(new Set(next.routes.map(r=>r.identityKey)),new Set(sub.routes.map(r=>r.identityKey)));
});
test('auxiliary metrics use verified samples only; score formula and 17 denominator remain unchanged',async()=>{
 const{job}=await makeUi16Job();assert.equal(job.analysis.analysisVersion,'six-group-subtype-adaptive-v2');assert.equal(job.analysis.performance.candidatePlanCount,17);
 const before=scoreSixGroupPriorities({analysis:job.analysis,priorities:job.score.priorities});
 const metrics=knownSampleDiagnostics(job.analysis.categories);assert.equal(metrics.scope,'verified_sample_only');assert.equal(metrics.affectsScore,false);assert.equal(metrics.groups.length,6);
 assert.ok(metrics.diversity.normalized>=0&&metrics.diversity.normalized<=1);assert.ok(metrics.groups.reduce((n,g)=>n+g.totalSubtypes,0)===17);
 job.analysis.auxiliaryMetrics={...metrics,diversity:{normalized:0}};assert.deepEqual(scoreSixGroupPriorities({analysis:job.analysis,priorities:job.score.priorities}),before);
 const repeated=knownSampleDiagnostics([{categoryId:'a',totalSubtypeCount:1,reachableSubtypeCount:1,unknownSubtypeCount:0,subtypeResults:[{routes:[{...await route(point,point),identityKey:'uid:x',classification:{candidateStatus:'confirmed_by_rule'}}]}]},
 {categoryId:'b',totalSubtypeCount:1,reachableSubtypeCount:1,unknownSubtypeCount:0,subtypeResults:[{routes:[{...await route(point,point),identityKey:'uid:x',classification:{candidateStatus:'confirmed_by_rule'}}]}]}]);
 assert.equal(repeated.uniqueReachableIdentityCountLowerBound,1);assert.equal(repeated.diversity.normalized,1);
});
test('detail refresh preserves the known routed set and official range exclusions instead of reordering away old costs',async()=>{
 const{job}=await makeUi16Job(),analysis=job.analysis,sub=analysis.categories.find(g=>g.categoryId==='medical').subtypeResults.find(s=>s.subtypeId==='pharmacy');
 const template=analysis.poiMarkers.find(p=>p.uid==='pharmacy-0');
 const outside={...template,uid:'pharmacy-outside',location:analysis.origin.location},unrouted={...template,uid:'pharmacy-unrouted',location:{...analysis.origin.location,lng:120.000001}};
 analysis.poiMarkers.push(outside,unrouted);sub.rangeExcludedCandidates=[{identityKey:'uid:pharmacy-outside',uid:'pharmacy-outside'}];
 analysis.maxRouteCandidatesPerSubtype=1;
 const previous=sub.routes[0],changed=await applyFacilityRouteDetail(analysis,previous,{...previous,evidenceId:'refresh-order',geometry:null});
 const next=changed.categories.find(g=>g.categoryId==='medical').subtypeResults.find(s=>s.subtypeId==='pharmacy');
 assert.deepEqual(new Set(next.routes.map(r=>r.identityKey)),new Set(sub.routes.map(r=>r.identityKey)));
 assert.ok(!next.candidateDiagnostics.some(p=>p.uid==='pharmacy-outside'));
 assert.equal(next.candidateDiagnostics.find(p=>p.uid==='pharmacy-unrouted').routeStatus,'not_requested');
});
