import test from 'node:test';
import assert from 'node:assert/strict';
import {createFacilityAnalysis} from './facility-analysis.mjs';
import {createFacilityJobManager,validateFacilityV3Input} from './facility-job.mjs';
import {createBaiduPlaceProvider} from './baidu-place.mjs';
import {createBaiduRouteProvider,facilityRouteCacheKey} from './baidu-route.mjs';
import {classifySubtypeCandidate,facilityCategoryTree,publicFacilityCategoryTree,FACILITY_GROUP_IDS} from './facility-categories.mjs';
import {evaluateSubtypeAccess} from './nearest-facility.mjs';
import {scoreSixGroupPriorities} from './priority-score.mjs';
import {buildFacilityReport,renderFacilityReportHtml} from './report.mjs';
import {representativeRoutes} from './representative-routes.mjs';
import {buildIsochrone} from './isochrone.mjs';
import {validWalkingSamplingSnapshot} from './reachability-evidence.mjs';
import {reportPresentation} from '../web/report-view.js';
import {readFileSync} from 'node:fs';

const mapping='facility-categories-v4';
const location={id:'analysis',source:'baidu_poi',uid:'community-uid',name:'文锦社区',location:{lng:120.150993,lat:30.288902}};
const origin={id:'walking',source:'map_click',uid:null,name:'步行入口',location:{lng:120.152993,lat:30.287902}};
const poi=(uid,name,offset=.001,extra={})=>({uid,name,location:{lng:location.location.lng+offset,lat:location.location.lat},...extra});
const search=(candidates=[],extra={})=>({status:'complete',searchComplete:true,truncated:false,candidates,
 pages:[{pageNum:0,reportedTotal:candidates.length,returned:candidates.length}],errors:[],requestStats:{logicalRequests:1},...extra});
const route=(from,to,options,duration=900,distance=600)=>({routeStatus:'ok',mode:'walking',coordinateSystem:'BD-09LL',
 source:'offline_fixture',durationSeconds:duration,distanceMeters:distance,retrievedAt:'2026-10-08T00:00:00Z',
 requestedOrigin:{location:from,uid:options.originUid ?? null},requestedDestination:{location:to,uid:options.destinationUid ?? null},
 geometry:options.includeGeometry?{type:'LineString',coordinates:[[from.lng,from.lat],[to.lng,from.lat],[to.lng,to.lat]]}:null,
 geometryStatus:options.includeGeometry?'provider_path':'not_requested'});
const body=(extra={})=>({version:4,categoryMappingVersion:mapping,analysisLocation:location,origin,
 categoryIds:FACILITY_GROUP_IDS,mode:'walking',minutes:15,priorities:{},...extra});
async function finished(manager,id){for(let i=0;i<200;i++){const job=manager.get(id);if(!['queued','running'].includes(job.status))return job;await new Promise(r=>setTimeout(r,2));}throw new Error('Offline deadline');}
function fixture({names={secondary_school:'文锦中学',pharmacy:'社区药店'},routeProvider={route:async(a,b,o)=>route(a,b,o)},extra={}}={}){
 return createFacilityJobManager({placeProvider:{searchAround:async({subtypeId})=>search(names[subtypeId]?[poi(subtypeId,names[subtypeId])]:[])},routeProvider,...extra});
}

test('v4 is six groups/23 children, old v3 tree is immutable and keeps 25 historical children',()=>{
 const v4=publicFacilityCategoryTree(mapping),v3=publicFacilityCategoryTree('facility-categories-v3');
 assert.equal(v4.requestVersion,4);assert.equal(v4.categories.flatMap(g=>g.subtypes).length,23);
 assert.deepEqual(v4.categories[0].subtypes.map(s=>s.id),['kindergarten','primary_school','secondary_school']);
 assert.equal(v3.categories.flatMap(g=>g.subtypes).length,25);
 assert.ok(v3.categories[0].subtypes.some(s=>s.id==='childcare_early_education'));
 assert.ok(Object.isFrozen(facilityCategoryTree('facility-categories-v3')));
});
test('secondary school aliases cover ordinary middle/high schools without inferring university or composite grades',()=>{
 for(const name of ['文锦中学','文锦初级中学','文锦高级中学','文锦普通高中','文锦完全中学']){
  assert.equal(classifySubtypeCandidate({categoryMappingVersion:mapping,subtypeId:'secondary_school',name}).candidateStatus,'confirmed_by_rule');
 }
 for(const [name,rawCategory] of [['杭州市实验学校','教育培训;学校'],['九年一贯制学校','学校'],['实验学校初中部','学校']]){
  assert.equal(classifySubtypeCandidate({categoryMappingVersion:mapping,subtypeId:'secondary_school',name,rawCategory}).candidateStatus,'pending_review');
 }
 assert.equal(classifySubtypeCandidate({categoryMappingVersion:mapping,subtypeId:'secondary_school',name:'实验学校',rawCategory:'教育培训;中学'}).candidateStatus,'confirmed_by_rule');
 assert.equal(classifySubtypeCandidate({categoryMappingVersion:mapping,subtypeId:'secondary_school',name:'大学附属中学',rawCategory:'教育培训;中学'}).candidateStatus,'confirmed_by_rule');
 for(const [name,rawCategory] of [['某大学','教育培训;高等院校'],['中学培训中心','培训机构'],['学校招生咨询','大学']]){
  assert.notEqual(classifySubtypeCandidate({categoryMappingVersion:mapping,subtypeId:'secondary_school',name,rawCategory}).candidateStatus,'confirmed_by_rule');
 }
});
test('v4 accepts independent analysis location and origin, defaults to same point and rejects mixed versions',()=>{
 assert.deepEqual(validateFacilityV3Input(body()).origin.location,origin.location);
 assert.deepEqual(validateFacilityV3Input(body({origin:undefined})).origin.location,location.location);
 assert.deepEqual(validateFacilityV3Input(body({analysisLocation:undefined})).analysisLocation.location,origin.location);
 for(const invalid of [{categoryMappingVersion:'facility-categories-v3'},{version:3},{analysisLocation:{...location,source:'bad'}},{origin:{...origin,uid:' '}}])assert.throws(()=>validateFacilityV3Input(body(invalid)));
});
test('missed generic 中学 case: Place OR query, page continuation, UID union, raw class, real route and diagnostics',async()=>{
 const calls=[];const provider=createBaiduPlaceProvider({client:{requestJson:async({params})=>{
  calls.push(params);const page=Number(params.page_num);
  const results=page===0?Array.from({length:20},(_,i)=>({uid:'middle-'+i,name:i===0?'文锦中学':'候选中学'+i,
   location:poi('x','x',.001+i*.00001).location,detail_info:{classified_poi_tag:'教育培训;中学'}}))
   :[{uid:'middle-0',name:'文锦中学',location:poi('x','x').location,detail_info:{classified_poi_tag:'教育培训;中学'}},
     {uid:'compound',name:'复合实验学校',location:poi('x','x').location,detail_info:{tag:'学校'}}];
  return {data:{status:0,result_type:'poi_type',total:22,results},meta:{retrievedAt:'2026-10-08T00:00:00Z'}};
 }}});
 const first=await provider.searchAround({categoryId:'education',subtypeId:'secondary_school',categoryMappingVersion:mapping,
  center:location.location,incremental:true,maxRequests:1});
 assert.ok(calls[0].query.includes('中学'));assert.ok(calls[0].query.includes('学校'));assert.equal(first.searchComplete,false);
 const second=await provider.searchAround({categoryId:'education',subtypeId:'secondary_school',categoryMappingVersion:mapping,
  center:location.location,incremental:true,maxRequests:1,continuation:first.continuation});
 // 22 response rows contain one repeated UID: only 21 unique results, so the reported total is not satisfied.
 assert.equal(second.searchComplete,false);assert.equal(second.candidates.length,21);assert.ok(second.continuation);assert.equal(second.candidates.filter(p=>p.uid==='middle-0').length,1);
 assert.equal(second.candidates.find(p=>p.uid==='middle-0').retrievalEvidence.length,2);
 const result=await evaluateSubtypeAccess({demandPoint:location,categoryMappingVersion:mapping,subtypeId:'secondary_school',
  facilities:second.candidates,searchComplete:true,provider:{route:async(a,b,o)=>route(a,b,o)},maxRouteCandidates:1});
 assert.equal(result.accessStatus,'reachable');assert.equal(result.nearestComplete,false);
 assert.ok(result.reasonCodes.includes('candidate_limit_reached'));assert.ok(result.reasonCodes.includes('classification_pending'));
 assert.ok(result.candidateDiagnostics.some(r=>r.uid==='middle-0'&&r.decision==='included'));
 assert.ok(result.candidateDiagnostics.some(r=>r.uid==='compound'&&r.reasonCode==='classification_pending'));
 assert.ok(result.duplicateUids.length===0); // Provider already deduped before route evaluation.
});
test('basemap labels cannot enter statistics; empty complete Place means absence, incomplete search means unknown',async()=>{
 const analyze=async complete=>createFacilityAnalysis({placeProvider:{searchAround:async()=>search([],{searchComplete:complete})},routeProvider:{route:async()=>{throw new Error('no candidate');}}}).analyze({origin,analysisLocation:location,categoryMappingVersion:mapping});
 const complete=await analyze(true),partial=await analyze(false);
 assert.equal(complete.diagnostics.baseMapLabelsCounted,false);assert.equal(complete.uniqueUidCount,0);
 assert.ok(complete.categories.flatMap(g=>g.subtypeResults).every(r=>r.accessStatus==='no_reachable_in_declared_search'));
 assert.ok(partial.categories.flatMap(g=>g.subtypeResults).every(r=>r.accessStatus==='unknown'&&r.reasonDetails.length));
});
test('900 seconds inclusive, 901 excluded, route failures and absent endpoint binding remain unknown',async()=>{
 for(const [cost,status] of [[900,'reachable'],[901,'no_reachable_in_declared_search']]){
  const result=await evaluateSubtypeAccess({demandPoint:origin,categoryMappingVersion:mapping,subtypeId:'secondary_school',
   facilities:[poi('middle','文锦中学')],searchComplete:true,provider:{route:async(a,b,o)=>route(a,b,o,cost)}});
  assert.equal(result.accessStatus,status);
 }
 for(const code of ['timeout','permission_denied','quota_exhausted','route_request_limit_reached']){
  const result=await evaluateSubtypeAccess({demandPoint:origin,categoryMappingVersion:mapping,subtypeId:'secondary_school',
   facilities:[poi('middle','文锦中学')],searchComplete:true,provider:{route:async()=>({routeStatus:code})}});
  assert.equal(result.accessStatus,'unknown');assert.ok(result.reasonCodes.includes(code));
 }
 const invalid=await evaluateSubtypeAccess({demandPoint:origin,categoryMappingVersion:mapping,subtypeId:'secondary_school',
  facilities:[poi('middle','文锦中学')],searchComplete:true,provider:{route:async()=>({routeStatus:'ok',durationSeconds:300,distanceMeters:300})}});
 assert.equal(invalid.accessStatus,'unknown');
});
test('analysis point centers Place, actual origin centers all routes and sampling, and 23 score/report stay consistent',async()=>{
 const searches=[],from=[],samples=[];
 const manager=createFacilityJobManager({placeProvider:{searchAround:async o=>{searches.push(o.center);return search(o.subtypeId==='secondary_school'?[poi('middle','文锦中学')]:[]);}},
 routeProvider:{route:async(a,b,o)=>{from.push(a);return route(a,b,o);}},walkingSamplingEnabled:true,samplingRequestLimit:4,
 samplingRunner:async({center,budget})=>{samples.push(center);budget.networkRequests+=4;return buildIsochrone({center,radiusMeters:300,spacingMeters:300,maxRouteCalls:4,maxRefinementPoints:0,provider:{route:async(a,b)=>route(a,b,{},900,300)}});}});
 const job=await finished(manager,manager.create(body({confirmRealWalkingSampling:true})).analysisId);
 assert.equal(job.status,'complete');assert.equal(searches.length,23);assert.ok(searches.every(p=>p.lng===location.location.lng));
 assert.ok(from.every(p=>p.lng===origin.location.lng));assert.deepEqual(samples,[origin.location]);
 assert.equal(job.analysis.categories[0].totalSubtypeCount,3);assert.ok(Math.abs(job.score.categories[0].G_low-100/3)<.000001);
 const report=buildFacilityReport(job);assert.equal(report.counts.subtypeCount,23);assert.equal(report.reportVersion,'facility-report-v4');
 assert.equal((renderFacilityReportHtml(report).match(/data-subtype=/g)??[]).length,23);
 assert.equal(reportPresentation(job,publicFacilityCategoryTree(mapping)).counts.total,23);
 assert.equal(job.reachability.diagnostics.status,'sampled_approximation');assert.ok(job.rangeDiagnostics.unknownRegions);
});
test('old v3 evidence keeps five education slots and its original report/score denominator',async()=>{
 const manager=fixture();const job=await finished(manager,manager.create({...body(),version:3,categoryMappingVersion:'facility-categories-v3'}).analysisId);
 assert.equal(job.analysis.categories[0].totalSubtypeCount,5);assert.equal(manager.report(job.analysisId).counts.subtypeCount,25);
 assert.equal(manager.rescore(job.analysisId,{evidenceFingerprint:job.score.evidenceFingerprint,priorities:{}}).categoryMappingVersion,'facility-categories-v3');
 assert.throws(()=>scoreSixGroupPriorities({analysis:{...job.analysis,version:4,categoryMappingVersion:mapping}}));
});
test('origin changes never reuse a different-origin cost, UID, geometry or evidence fingerprint',async()=>{
 let calls=0;
 const provider=createBaiduRouteProvider({client:{requestJson:async({params})=>{calls++;const [lat,lng]=params.origin.split(',').map(Number);const [tlat,tlng]=params.destination.split(',').map(Number);
  return {data:{result:{routes:[{duration:500,distance:600,steps:[{path:`${lng},${lat};${tlng},${tlat}`}]}]}},meta:{retrievedAt:'2026-10-08T00:00:00Z'}};
 }},liteRequestLimit:10});
 const manager=fixture({names:{secondary_school:'文锦中学'},routeProvider:provider});
 const first=await finished(manager,manager.create(body({includeReachableNetwork:true})).analysisId);
 const nextOrigin={...origin,location:{...origin.location,lng:origin.location.lng+.005}};
 const second=await finished(manager,manager.create(body({origin:nextOrigin,includeReachableNetwork:true})).analysisId);
 assert.equal(calls,4);assert.notEqual(first.score.evidenceFingerprint,second.score.evidenceFingerprint);
 assert.notDeepEqual(first.representativeRoutes[0].polyline,second.representativeRoutes[0].polyline);
 assert.deepEqual(second.analysis.categories[0].nearestReachableAnySubtype.origin,nextOrigin.location);
 assert.notEqual(facilityRouteCacheKey(origin.location,location.location),facilityRouteCacheKey(nextOrigin.location,location.location));
});
test('representative routes select verified nearest distance, reuse duplicate endpoint geometry and obey total/detail caps',async()=>{
 const names={secondary_school:'文锦中学',pharmacy:'药店',market:'菜市场',bus_stop:'公交站',residential_eldercare:'养老院',park_green:'公园'};
 let details=0;
 const manager=fixture({names,routeProvider:{route:async(a,b,o)=>{if(o.includeGeometry)details++;return route(a,b,o);}},extra:{taskDetailLimit:2}});
 const job=await finished(manager,manager.create(body()).analysisId);
 assert.equal(representativeRoutes(job.analysis).length,6);assert.ok(job.representativeRoutes.every(r=>r.evidenceStatus==='verified_cost'&&!r.drawable));
 const response=await manager.representativeRoutes(job.analysisId,{includeGeometry:true,evidenceFingerprint:job.score.evidenceFingerprint});
 assert.equal(details,2);assert.equal(response.routes.filter(r=>r.drawable).length,2);assert.ok(response.limitations.some(r=>r.reasonCode==='route_detail_limit_reached'));
 await manager.representativeRoutes(job.analysisId,{includeGeometry:true,evidenceFingerprint:response.evidenceFingerprint});assert.equal(details,2);
 const visible=response.routes.find(r=>r.drawable);assert.equal(visible.uid,visible.destinationUid);assert.equal(visible.polyline[0][0][0],origin.location.lng);
 const analysis=structuredClone(job.analysis),group=analysis.categories[0],previous=group.subtypeResults[2].routes[0];
 group.subtypeResults[2].routes.push({...previous,facilityUid:'closer',identityKey:'uid:closer',distanceMeters:100,name:'已核验更近中学'});
 assert.equal(representativeRoutes(analysis)[0].uid,'closer');
});
test('mismatched route endpoint/geometry is never drawn; missing real paths cannot be synthesized',async()=>{
 const manager=fixture({names:{secondary_school:'文锦中学'},routeProvider:{route:async(a,b,o)=>({...route(a,b,o),geometry:o.includeGeometry?{type:'LineString',coordinates:[[100,20],[101,21]]}:null})}});
 const job=await finished(manager,manager.create(body({includeReachableNetwork:true})).analysisId);
 assert.equal(job.analysis.categories[0].reachableSubtypeCount,1);
 assert.equal(job.representativeRoutes[0].drawable,false);assert.equal(job.representativeRoutes[0].reasonCode,'endpoint_geometry_mismatch');
});
test('official permission failure is isolated; authorized real sampling uses its own remaining budget',async()=>{
 let sampling=0;
 const manager=fixture({names:{},extra:{officialEnabled:true,officialEntitlementVerified:true,officialRequestLimit:1,
  officialProvider:{getIsochrone:async()=>{throw Object.assign(new Error('denied'),{code:'permission_denied',apiStatus:210});}},
  walkingSamplingEnabled:true,samplingRequestLimit:4,samplingRunner:async({center,budget,maxRouteCalls})=>{sampling++;assert.equal(maxRouteCalls,4);budget.networkRequests+=4;
   return buildIsochrone({center,radiusMeters:300,spacingMeters:300,maxRouteCalls:4,maxRefinementPoints:0,provider:{route:async(a,b)=>route(a,b,{},900,300)}});}}});
 const job=await finished(manager,manager.create(body({confirmRealWalkingSampling:true})).analysisId);
 assert.equal(sampling,1);assert.equal(job.geometrySource,'walking_sampling_fallback');assert.equal(job.rangeFailures[0].apiStatus,210);
 assert.equal(job.requestStats.samplingRequests,4);assert.equal(job.rangeDiagnostics.unknownRegions.betweenSamplesStatus,'unknown');
 const malformed=structuredClone(job);malformed.geojson.features.push({type:'Feature',geometry:{type:'Polygon',coordinates:[[[120,30],[NaN,30],[120,30]]]}});
 assert.equal(validWalkingSamplingSnapshot({geometrySource:malformed.geometrySource,geometryStatus:malformed.geometryStatus,coordinateSystem:'BD-09LL',thresholdSeconds:900,center:origin.location,geojson:malformed.geojson},origin.location),false);
});
test('official available wins, no consent/no budget failure publishes explicit unknown without fake range',async()=>{
 const g={geometrySource:'baidu_isochrone',geometryStatus:'available',mode:'walking',thresholdSeconds:900,coordinateSystem:'BD-09LL',center:origin.location,
  geojson:{type:'FeatureCollection',features:[{type:'Feature',properties:{mode:'walking',thresholdSeconds:900,coordinateSystem:'BD-09LL'},geometry:{type:'Polygon',coordinates:[[[120.15,30.28],[120.16,30.28],[120.16,30.29],[120.15,30.28]]]}}]}};
 let samples=0;
 const manager=fixture({names:{},extra:{officialEnabled:true,officialEntitlementVerified:true,officialRequestLimit:1,officialProvider:{getIsochrone:async()=>g},walkingSamplingEnabled:true,samplingRunner:async()=>{samples++;}}});
 const job=await finished(manager,manager.create(body({confirmRealWalkingSampling:true})).analysisId);
 assert.equal(samples,0);assert.equal(job.geometrySource,'baidu_isochrone');assert.equal(job.rangeDiagnostics.status,'available');
 for(const extra of [{confirmRealWalkingSampling:false},{confirmRealWalkingSampling:true}]){
  const no=fixture({names:{},extra:{walkingSamplingEnabled:true,samplingRequestLimit:0,samplingRunner:async()=>{throw new Error('zero budget');}}});
  const j=await finished(no,no.create(body(extra)).analysisId);assert.equal(j.geometryStatus,'unknown');assert.equal(j.geojson,null);assert.ok(j.rangeDiagnostics.reasonCode);
 }
});
test('Place service denied does not disable authorized official geometry; unsearched subtypes remain unknown',async()=>{
 let official=0,routes=0;
 const manager=createFacilityJobManager({placeProvider:{searchAround:async()=>search([],{status:'failed',searchComplete:false,errors:[{code:'permission_denied'}]})},
 routeProvider:{route:async()=>{routes++;return {routeStatus:'timeout'};}},officialEnabled:true,officialEntitlementVerified:true,officialRequestLimit:1,
 officialProvider:{getIsochrone:async()=>{official++;throw Object.assign(new Error('invalid'),{code:'empty_geometry'});}}});
 const job=await finished(manager,manager.create(body()).analysisId);
 assert.equal(official,1);assert.equal(routes,0);assert.equal(job.requestStats.placeRequests,1);
 assert.ok(job.analysis.categories.flatMap(g=>g.subtypeResults).every(s=>s.accessStatus==='unknown'));
});
test('recorded real Place schools/gates replay offline: gate UIDs never become school counts and grade evidence is retained',async()=>{
 const recorded=JSON.parse(readFileSync(new URL('../data/fixtures/backend-v4-secondary-school.json',import.meta.url),'utf8'));
 const schools=recorded.candidates;
 const analysis=await createFacilityAnalysis({placeProvider:{searchAround:async({subtypeId})=>search(subtypeId==='secondary_school'?schools:[])},
  routeProvider:{route:async(a,b,o)=>route(a,b,o)}}).analyze({origin:location,categoryMappingVersion:mapping});
 const edu=analysis.categories[0],middle=edu.subtypeResults.find(s=>s.subtypeId==='secondary_school');
 const campus=schools.find(p=>p.name==='杭州学军中学(西溪校区)');
 assert.ok(analysis.poiMarkers.some(p=>p.uid===campus.uid && p.subtypeIds.includes('secondary_school')));
 assert.ok(analysis.poiMarkers.find(p=>p.uid===campus.uid).entranceCandidates.length>=2);
 assert.ok(middle.candidateDiagnostics.filter(p=>/东[12]门|南门|北门/.test(p.name)).every(p=>p.decision==='excluded'));
 assert.ok(!analysis.poiMarkers.some(p=>p.rawCategory==='出入口;门'));
 const primary=analysis.poiMarkers.find(p=>p.name==='杭州市行知小学(学院校区)');assert.ok(primary.subtypeIds.includes('primary_school'));
 assert.equal(edu.subtypeResults.some(s=>s.subtypeId==='childcare_early_education'),false);
});
test('v4 Place continuation from another search center is rejected before any upstream request',async()=>{
 let calls=0;const provider=createBaiduPlaceProvider({client:{requestJson:async()=>{calls++;return {data:{total:21,results:Array.from({length:20},(_,i)=>({uid:String(i),name:'中学',location:location.location}))},meta:{retrievedAt:'fixture'}};}}});
 const options={categoryId:'education',subtypeId:'secondary_school',categoryMappingVersion:mapping,center:location.location,maxRequests:1,incremental:true};
 const first=await provider.searchAround(options);
 await assert.rejects(()=>provider.searchAround({...options,center:origin.location,continuation:first.continuation}),/scope mismatch/);
 assert.equal(calls,1);
});
test('production strict walking samples reject wrong-origin or unbound costs, accepting UID-bound real walking only',async()=>{
 const opts={center:origin.location,radiusMeters:300,spacingMeters:300,maxRouteCalls:4,maxRefinementPoints:0,strictEvidence:true,originUid:'start-uid'};
 const good=await buildIsochrone({...opts,provider:{route:async(a,b,o)=>route(a,b,o,900,300)}});
 assert.equal(good.sampleMetrics.validRoutePoints,4);assert.equal(good.geometryStatus,'sampled_approximation');
 assert.equal(validWalkingSamplingSnapshot(good,origin.location,'different-start-uid'),false);
 const wrong=await buildIsochrone({...opts,provider:{route:async(a,b,o)=>({...route(a,b,o,900,300),requestedOrigin:{location:location.location,uid:'start-uid'}})}});
 assert.equal(wrong.sampleMetrics.validRoutePoints,0);assert.equal(wrong.geometryStatus,'unknown');
 assert.ok(!wrong.geojson.features.some(f=>f.properties?.featureType==='sample_cell'));
});
test('a new 901-second detail replaces old 900-second decisions in route, score, report and candidate trace together',async()=>{
 const manager=fixture({names:{secondary_school:'文锦中学'},routeProvider:{route:async(a,b,o)=>route(a,b,o,o.includeGeometry?901:900)}});
 const job=await finished(manager,manager.create(body()).analysisId);const row=job.representativeRoutes[0];
 assert.equal(job.analysis.diagnostics.candidates.find(r=>r.uid==='secondary_school').decision,'included');
 await manager.routeDetail(job.analysisId,{identityKey:row.identityKey,subtypeId:row.subtypeId,evidenceFingerprint:job.score.evidenceFingerprint});
 const updated=manager.get(job.analysisId),trace=updated.analysis.diagnostics.candidates.find(r=>r.uid==='secondary_school');
 assert.equal(trace.decision,'excluded');assert.equal(trace.reasonCode,'beyond_900_seconds');
 assert.equal(updated.score.categories[0].G_low,0);assert.equal(manager.report(job.analysisId).categories[0].reachableSubtypeCount,0);
});
