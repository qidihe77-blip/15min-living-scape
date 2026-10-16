import test from 'node:test';
import assert from 'node:assert/strict';
import {createFacilityJobManager} from './facility-job.mjs';
import {FACILITY_GROUP_IDS} from './facility-categories.mjs';
import {assessServiceGaps, assessServiceGapPoints} from './service-gaps.mjs';
import {validOfficialWalkingRange} from './reachability-evidence.mjs';
import {buildFacilityReport,renderFacilityReportHtml} from './report.mjs';
import {buildIsochrone} from './isochrone.mjs';
import {decideReachabilitySource} from './reachability-policy.mjs';
import {reportPresentation,reportSummary} from '../web/report-view.js';
import {publicFacilityCategoryTree} from './facility-categories.mjs';

const origin={id:'origin',source:'map_click',name:'<script>origin</script>',location:{lat:30,lng:120}};
const body={version:3,categoryMappingVersion:'facility-categories-v3',origin,mode:'walking',minutes:15,categoryIds:FACILITY_GROUP_IDS};
const names={market:'测试菜市场',pharmacy:'测试药店',primary_school:'测试小学'};
const task=async(manager)=>{const id=manager.create(body).analysisId;for(let i=0;i<150;i++){
  const job=manager.get(id);if(['complete','partial','failed','cancelled'].includes(job.status))return job;
  await new Promise(r=>setTimeout(r,2));}throw new Error('Job deadline');};
function fixture({facilities=names,distance=1000,duration=900,status='ok',complete=true,two=false,extra={}}={}) {
 let places=0,routes=0;
 const manager=createFacilityJobManager({placeProvider:{searchAround:async({subtypeId})=>{
   places++;return {status:complete?'complete':'partial',searchComplete:complete,truncated:!complete,
     candidates:facilities[subtypeId]?[{uid:subtypeId,name:facilities[subtypeId],location:{lat:30.001,lng:120.001}},
       ...(two?[{uid:subtypeId+'-2',name:facilities[subtypeId],location:{lat:30.002,lng:120.001}}]:[])]:[],
     requestStats:{logicalRequests:1}};}},routeProvider:{route:async(_a,_b,options)=>{
   routes++;return {routeStatus:status,distanceMeters:distance,durationSeconds:duration,mode:'walking',coordinateSystem:'BD-09LL',
     source:'offline',retrievedAt:'2026-10-06T00:00:00Z',geometry:options.includeGeometry
      ?{type:'LineString',coordinates:[[120,30],[120.001,30],[120.001,30.001]]}:null};}},...extra});
 return {manager,counts:()=>({places,routes})};
}
test('R11 1000 metres inclusive, 1001 absent; 900 and 901 seconds independent',async()=>{
 for(const [distance,duration,status] of [[1000,901,'present'],[1001,900,'absent_in_declared_search'],[1000,900,'present']]){
   const f=fixture({distance,duration});const job=await task(f.manager);
   assert.ok(job.serviceGaps.specialties.every(row=>row.walking_1km_gap.status===status));
   assert.equal(job.serviceGaps.walking.allThreeMissing,distance===1001);
   assert.equal(job.serviceGaps.walking.anyMissing,distance===1001);
   assert.ok(job.serviceGaps.specialties.every(row=>row.geometric_1km_gap.status==='present'));
   assert.equal(job.serviceGaps.geojson.features.length,distance===1001?1:0);
   assert.deepEqual(f.counts(),{places:25,routes:3});
 }
});
test('R11 failed routes, paging, candidate truncation and undersized windows never prove absence',async()=>{
 for(const config of [{status:'upstream_unavailable'},{distance:1001,complete:false},{distance:1001,two:true}]){
  const f=fixture(config),job=await task(f.manager);
  assert.ok(job.serviceGaps.specialties.every(row=>row.walking_1km_gap.status==='unknown'));
  assert.equal(job.serviceGaps.walking.anyMissing,null);assert.equal(job.serviceGaps.walking.allThreeMissing,null);
  assert.equal(job.serviceGaps.geojson.features.length,0);
 }
 const f=fixture({facilities:{}}),job=await task(f.manager);
 const small=assessServiceGaps({...job.analysis,searchRadiusMeters:999});
 assert.ok(small.specialties.every(row=>row.walking_1km_gap.status==='unknown'));
});
test('R11 hospital, supermarket and junior school never replace three specialties',async()=>{
 const f=fixture({facilities:{hospital:'测试医院',supermarket:'测试超市',junior_school:'测试初中'}});
 const job=await task(f.manager);assert.equal(job.serviceGaps.walking.absentCount,3);
 assert.ok(job.analysis.categories.some(group=>group.reachableSubtypeCount>0));
 assert.deepEqual(job.serviceGaps.specialties.map(row=>row.subtypeId),['market','pharmacy','primary_school']);
 const analysis=structuredClone(job.analysis);const sub=analysis.categories[1].subtypeResults.find(s=>s.subtypeId==='pharmacy');
 sub.routes=[{...analysis.categories[1].subtypeResults.find(s=>s.subtypeId==='hospital').routes[0],subtypeId:'pharmacy'}];
 assert.equal(assessServiceGaps(analysis).specialties[1].walking_1km_gap.status,'absent_in_declared_search');
});
test('R11 any missing, all missing, unresolved classification and destination mismatches stay distinct',async()=>{
 const f=fixture({facilities:{pharmacy:'测试药店'}}),job=await task(f.manager);
 assert.equal(job.serviceGaps.walking.anyMissing,true);assert.equal(job.serviceGaps.walking.allThreeMissing,false);
 const analysis=structuredClone(job.analysis),sub=analysis.categories[1].subtypeResults.find(s=>s.subtypeId==='pharmacy');
 sub.routes[0].destination={lat:31,lng:121};
 assert.equal(assessServiceGaps(analysis).specialties[1].walking_1km_gap.status,'unknown');
 const pending=fixture({facilities:{pharmacy:'测试服务机构'}}),pjob=await task(pending.manager);
 assert.equal(pjob.serviceGaps.specialties[1].walking_1km_gap.status,'unknown');
});
test('R11 sourced finite point assessment needs explicit cap and never claims population or community coverage',async()=>{
 const f=fixture(),job=await task(f.manager);
 assert.throws(()=>assessServiceGapPoints([job.analysis],{source:'technical window'}),RangeError);
 assert.throws(()=>assessServiceGapPoints([job.analysis],{maxPoints:1}),RangeError);
 assert.throws(()=>assessServiceGapPoints([job.analysis,job.analysis],{maxPoints:2,source:'survey'}),/unique/);
 const result=assessServiceGapPoints([job.analysis],{maxPoints:1,source:'survey entry'});
 assert.equal(result.newRequests,0);assert.equal(result.populationCoverage,null);assert.equal(result.communityAreaCoverage,null);
 assert.deepEqual(f.counts(),{places:25,routes:3});
});
test('R12 full JSON/HTML and presentation use same task, all 25 rows, scope and score intervals',async()=>{
 const f=fixture({complete:false}),job=await task(f.manager),report=f.manager.report(job.analysisId);
 assert.equal(report.reportVersion,'facility-report-v3');assert.equal(report.reportStatus,'available');
 assert.equal(report.categories.flatMap(g=>g.subtypeResults).length,25);
 assert.equal(report.evidenceSnapshotId,job.score.evidenceFingerprint);
 assert.deepEqual(report.serviceGaps,job.serviceGaps);assert.deepEqual(report.score,job.score);
 const html=renderFacilityReportHtml(report);assert.equal((html.match(/data-subtype=/g)||[]).length,25);
 assert.match(html,/&lt;script&gt;origin/);assert.doesNotMatch(html,/<script>origin/);
 assert.match(html,/总体评分/);assert.match(html,/UID并集/);assert.match(html,/药店/);assert.match(html,/证据指纹/);
 const shown=reportPresentation(job,publicFacilityCategoryTree());
 assert.equal(shown.specialties[0].status,'present');assert.match(reportSummary(job,publicFacilityCategoryTree()),/1公里专项/);
 const before=f.counts();f.manager.rescore(job.analysisId,{evidenceFingerprint:job.score.evidenceFingerprint,priorities:Object.fromEntries(FACILITY_GROUP_IDS.map(id=>[id,0]))});
 assert.match(renderFacilityReportHtml(f.manager.report(job.analysisId)),/未计分/);assert.deepEqual(f.counts(),before);
 assert.throws(()=>buildFacilityReport({...job,analysis:{...job.analysis,categories:job.analysis.categories.slice(1)}}),/25-subtype/);
});
test('R10 facility-first snapshot survives optional sampling failure with explicit reason and zero fabricated range',async()=>{
 let sawFacilities=false;let manager;
 const f=fixture({extra:{walkingSamplingEnabled:true,samplingRequestLimit:4,
  samplingRunner:async({maxRouteCalls})=>{sawFacilities=Boolean(manager.get(id).analysis);assert.equal(maxRouteCalls,4);throw new Error('offline failure');}}});
 manager=f.manager;const id=manager.create({...body,confirmRealWalkingSampling:true}).analysisId;
 let job;for(let i=0;i<100;i++){job=manager.get(id);if(['complete','partial','failed'].includes(job.status))break;await new Promise(r=>setTimeout(r,2));}
 assert.equal(sawFacilities,true);assert.equal(job.analysis.categories.flatMap(g=>g.subtypeResults).length,25);
 assert.equal(job.geometryStatus,'unknown');assert.equal(job.reachability.continuousRangeAvailable,false);
 assert.ok(job.warnings.includes('walking_sampling_unavailable'));assert.equal(job.reachability.samplingDecision.maxRouteCalls,4);
 assert.deepEqual(manager.geojson(id).features,[]);
});
test('R10 official walking range must match origin, mode, 900 seconds and valid rings; invalid response falls back once',async()=>{
 const geo={geometrySource:'baidu_isochrone',mode:'walking',thresholdSeconds:900,coordinateSystem:'BD-09LL',center:origin.location,
  geojson:{type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Polygon',coordinates:[[[120,30],[120.01,30],[120.01,30.01],[120,30]]]},
   properties:{mode:'walking',thresholdSeconds:900,coordinateSystem:'BD-09LL'}}]}};
 assert.equal(validOfficialWalkingRange(geo,origin.location),true);
 for(const changes of [{mode:'driving'},{thresholdSeconds:1200},{center:{lat:31,lng:121}},{coordinateSystem:'WGS84'}])assert.equal(validOfficialWalkingRange({...geo,...changes},origin.location),false);
 let official=0,sampling=0;
 const f=fixture({extra:{officialEnabled:true,officialEntitlementVerified:true,officialRequestLimit:1,walkingSamplingEnabled:true,
   officialProvider:{getIsochrone:async()=>{official++;return {...geo,mode:'driving'};}},
   samplingRunner:async()=>{sampling++;throw new Error('failed');}}});
 const id=f.manager.create({...body,confirmRealWalkingSampling:true}).analysisId;
 for(let i=0;i<100;i++){const job=f.manager.get(id);if(['complete','partial'].includes(job.status))break;await new Promise(r=>setTimeout(r,2));}
 assert.equal(official,1);assert.equal(sampling,1);assert.equal(f.manager.get(id).geometrySource,'none');
 assert.equal(decideReachabilitySource({serviceHalted:true,officialEnabled:true,officialEntitlementVerified:true,officialRemainingRequests:1,
   allowWalkingSamplingFallback:true,walkingRouteAvailable:true,walkingRemainingRequests:24}).reason,'service_halted');
});
test('R10 sampling cancellation stops queue and publishes no invented fallback polygon',async()=>{
 const controller=new AbortController();let calls=0;
 await assert.rejects(buildIsochrone({center:origin.location,signal:controller.signal,maxRouteCalls:24,
  provider:{route:async()=>{calls++;controller.abort(new Error('test-cancel'));return {routeStatus:'ok',durationSeconds:500,distanceMeters:300};}}}),/test-cancel/);
 assert.ok(calls<=2);
});
test('R10/R12 finite facility paths export with whole-route color semantics even without continuous range',async()=>{
 const f=fixture({extra:{}});const id=f.manager.create({...body,includeReachableNetwork:true}).analysisId;
 let job;for(let i=0;i<100;i++){job=f.manager.get(id);if(['complete','partial'].includes(job.status))break;await new Promise(r=>setTimeout(r,2));}
 const roads=f.manager.geojson(id).features.filter(f=>f.properties.featureType==='reachable_route');
 assert.ok(roads.length);assert.ok(roads.every(r=>r.properties.durationSeconds<=900&&r.properties.durationScope==='whole_route'));
 assert.equal(job.geometryStatus,'unknown');assert.equal(f.manager.report(id).geometry.continuousRangeAvailable,false);
});
test('R11 route-detail new distance refreshes specialty, metrics and export without new search',async()=>{
 let places=0,routes=0;
 const manager=createFacilityJobManager({placeProvider:{searchAround:async({subtypeId})=>{places++;return {status:'complete',searchComplete:true,
  candidates:subtypeId==='pharmacy'?[{uid:'pharmacy',name:'测试药店',location:{lat:30.001,lng:120.001}}]:[],requestStats:{logicalRequests:1}};}},
  routeProvider:{route:async(_from,_to,options)=>{routes++;return {routeStatus:'ok',durationSeconds:850,distanceMeters:options.includeGeometry?1001:1000,
    mode:'walking',coordinateSystem:'BD-09LL',source:'offline',geometry:options.includeGeometry?{type:'LineString',coordinates:[[120,30],[120.001,30.001]]}:null};}}});
 const job=await task(manager);assert.equal(job.serviceGaps.specialties[1].walking_1km_gap.status,'present');
 const row=job.analysis.categories[1].subtypeResults.find(s=>s.subtypeId==='pharmacy').routes[0];
 await manager.routeDetail(job.analysisId,{evidenceFingerprint:job.score.evidenceFingerprint,identityKey:row.identityKey,subtypeId:'pharmacy'});
 const updated=manager.get(job.analysisId);assert.equal(updated.serviceGaps.specialties[1].walking_1km_gap.status,'absent_in_declared_search');
 assert.equal(updated.analysis.categories[1].subtypeResults.find(s=>s.subtypeId==='pharmacy').accessStatus,'reachable');
 assert.deepEqual(manager.metrics(job.analysisId).serviceGaps,updated.serviceGaps);assert.deepEqual(manager.report(job.analysisId).serviceGaps,updated.serviceGaps);
 assert.equal(places,25);assert.equal(routes,2);
});
test('R10 verified official range is exported independently; Isochrone denial permits authorized Walking sampling',async()=>{
 const geo={geometrySource:'baidu_isochrone',mode:'walking',thresholdSeconds:900,coordinateSystem:'BD-09LL',center:origin.location,
  geojson:{type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Polygon',coordinates:[[[120,30],[120.01,30],[120.01,30.01],[120,30]]]},
   properties:{mode:'walking',thresholdSeconds:900,coordinateSystem:'BD-09LL'}}]}};
 for(const denied of [false,true]){
   let official=0,sampling=0;
   const f=fixture({extra:{officialEnabled:true,officialEntitlementVerified:true,officialRequestLimit:1,walkingSamplingEnabled:true,
    officialProvider:{getIsochrone:async()=>{official++;if(denied)throw Object.assign(new Error('denied'),{code:'permission_denied'});return geo;}},
    samplingRunner:async()=>{sampling++;throw new Error('must not start');}}});
   const id=f.manager.create({...body,confirmRealWalkingSampling:true}).analysisId;
   for(let i=0;i<100;i++){const job=f.manager.get(id);if(['complete','partial'].includes(job.status))break;await new Promise(r=>setTimeout(r,2));}
   assert.equal(official,1);assert.equal(sampling,denied?1:0);const job=f.manager.get(id);
   assert.equal(job.reachability.continuousRangeAvailable,!denied);
   assert.equal(job.requestStats.officialRequests,1);assert.equal(job.requestStats.samplingRequests,0);
   if(denied)assert.equal(job.reachability.samplingDecision.reason,'confirmed_sampling_fallback');
   else assert.equal(f.manager.geojson(id).features[0].geometry.type,'Polygon');
 }
});
test('R10 sampling snapshot retains proxy provenance and unknowns without changing all25 facility scores',async()=>{
 const geometry=await buildIsochrone({center:origin.location,radiusMeters:300,spacingMeters:300,maxRouteCalls:4,maxRefinementPoints:0,
  provider:{route:async()=>({routeStatus:'ok',durationSeconds:900,distanceMeters:300,mode:'walking',coordinateSystem:'BD-09LL'})}});
 const f=fixture({extra:{walkingSamplingEnabled:true,samplingRequestLimit:4,samplingRunner:async({budget})=>{
   budget.networkRequests+=4;return geometry;}}});
 const id=f.manager.create({...body,confirmRealWalkingSampling:true}).analysisId;
 let job;for(let i=0;i<100;i++){job=f.manager.get(id);if(['complete','partial'].includes(job.status))break;await new Promise(r=>setTimeout(r,2));}
 assert.equal(job.geometryStatus,'sampled_approximation');assert.equal(job.requestStats.samplingRequests,4);
 assert.equal(job.reachability.continuousRangeAvailable,false);assert.equal(job.sampleMetrics.errorBoundStatus,'not_statistically_estimated');
 assert.ok(job.geometryWarnings.length);assert.equal(job.analysis.categories.flatMap(g=>g.subtypeResults).length,25);
 const wrong=fixture({extra:{walkingSamplingEnabled:true,samplingRunner:async()=>({...geometry,center:{lat:31,lng:121}})}});
 const wid=wrong.manager.create({...body,confirmRealWalkingSampling:true}).analysisId;
 for(let i=0;i<100;i++){const j=wrong.manager.get(wid);if(['complete','partial'].includes(j.status))break;await new Promise(r=>setTimeout(r,2));}
 assert.equal(wrong.manager.get(wid).geometrySource,'none');
});
