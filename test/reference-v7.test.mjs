import test from 'node:test';import assert from 'node:assert/strict';
import {publicFacilityCategoryTree,classifySubtypeCandidate} from '../server/facility-categories.mjs';
import {sampleReferenceWalkingRange,routePrefixAtDistance} from '../server/reference-walking-range.mjs';
import {analyticRoadProvider} from './fixtures/adaptive-roads.mjs';
import {makeUi16Job} from '../scripts/reference-v7-fixtures.mjs';
import {createBaiduPlaceProvider} from '../server/baidu-place.mjs';
import {prepareFacilitySearches} from '../server/facility-analysis.mjs';
import {reportPdfHtml} from '../server/report-pdf.mjs';
import {walkingRangeNotice} from '../web/reachable-presentation.js';
import {makeFacilityTask} from '../web/facility-view.js';
const origin={lng:120,lat:30},version='facility-categories-v7';
test('v7 has18 and community eldercare; same centre never becomes a nursing or convalescent home from generic tags',()=>{
 const tree=publicFacilityCategoryTree(version);assert.equal(tree.requestVersion,7);assert.equal(tree.categories.flatMap(g=>g.subtypes).length,18);
 const p={categoryMappingVersion:version,name:'文新街道综合为老服务中心',rawCategory:'生活服务;养老机构'};
 assert.equal(classifySubtypeCandidate({...p,subtypeId:'community_eldercare'}).candidateStatus,'confirmed_by_rule');
 for(const name of['文锦社区居家养老服务照料中心','浙江光大中安仓基新村养老服务驿站'])assert.equal(classifySubtypeCandidate({...p,name,subtypeId:'community_eldercare'}).candidateStatus,'confirmed_by_rule');
 for(const subtypeId of['residential_eldercare','convalescent_home'])assert.equal(classifySubtypeCandidate({...p,subtypeId}).candidateStatus,'excluded_by_rule');
 assert.equal(classifySubtypeCandidate({...p,name:'养老用品设备商店',subtypeId:'community_eldercare'}).candidateStatus,'excluded_by_rule');
 assert.equal(classifySubtypeCandidate({categoryMappingVersion:version,name:'京杭大运河杭州景区-休息亭',rawCategory:'医疗;疗养院',subtypeId:'convalescent_home'}).candidateStatus,'excluded_by_rule');
 assert.equal(publicFacilityCategoryTree('facility-categories-v6').categories.flatMap(g=>g.subtypes).length,17);
});
test('32 uniform 1800m directions use provider paths, estimating points on real segments instead of radial or harmonic geometry',async()=>{
 const p=analyticRoadProvider({latencyMs:1}),g=await sampleReferenceWalkingRange({center:origin,originUid:'o',provider:p});assert.equal(p.stats().calls,32);assert.equal(p.stats().peak,2);
 assert.equal(g.geometryStatus,'sampled_approximation');assert.equal(g.samplingDiagnostics.officialApisUsed,false);assert.equal(g.samplingDiagnostics.sampleCount,32);assert.equal(g.samplingDiagnostics.farDistanceMeters,1800);
 assert.equal(g.samples.length,32);assert.ok(g.samples.every(s=>s.coverageStatus==='over_threshold'));assert.ok(g.geojson.features.every(f=>f.properties.featureType==='sampled_boundary'));
 assert.equal(g.samplingDiagnostics.boundaryCostStatus,'estimated_not_separate_route_witness');assert.equal(g.unknownRegions.unmeasuredInterior,true);
 for(const s of g.samples){const e=s.boundaryEstimate,a=s.geometry.coordinates[e.sourceSegment],b=s.geometry.coordinates[e.sourceSegment+1];assert.ok(e.sourceFraction>=0&&e.sourceFraction<=1);
  assert.ok(Math.abs(e.point[0]-(a[0]+(b[0]-a[0])*e.sourceFraction))<1e-12);assert.ok(Math.abs(e.point[1]-(a[1]+(b[1]-a[1])*e.sourceFraction))<1e-12);}
});
test('missing/disconnected paths and incomplete budgets never become synthetic circles or interpolated failure directions',async()=>{
 const p=analyticRoadProvider({failSector:2}),g=await sampleReferenceWalkingRange({center:origin,provider:p});assert.equal(g.geometryStatus,'unknown');assert.equal(g.geojson.features.length,0);
 assert.ok(g.unknownRegions.failedSectors.length>0);const reduced=await sampleReferenceWalkingRange({center:origin,provider:analyticRoadProvider(),maxRouteCalls:24});assert.equal(reduced.geometryStatus,'unknown');assert.equal(reduced.sampleMetrics.attemptedRouteCalls,24);
 assert.equal(routePrefixAtDistance({distanceMeters:2000,geometry:{type:'MultiLineString',coordinates:[[[120,30],[120.01,30]],[[121,31],[121.01,31]]]}}).reasonCode,'disconnected_provider_steps');
});
test('group recall uses broad养老 and aliases with one six-group first pass; classification happens after UID union',async()=>{
 const requests=[],client={requestJson:async options=>{requests.push(options);return{data:{status:0,total:options.params.query.startsWith('养老')?2:0,results:options.params.query.startsWith('养老')?[{uid:'centre',name:'街道综合为老服务中心',location:origin,detail_info:{tag:'生活服务;养老机构'}},{uid:'centre',name:'街道综合为老服务中心',location:origin,detail_info:{tag:'生活服务;养老机构'}}]:[]},meta:{retrievedAt:'offline'}};}};
 const prepared=await prepareFacilitySearches({placeProvider:createBaiduPlaceProvider({client}),analysisLocation:{location:origin},categoryMappingVersion:version,searchRadiusMeters:1500,concurrency:2});
 assert.ok(requests.length>=6&&requests.length<=30);assert.equal(new Set(requests.slice(0,6).map(r=>r.params.query)).size,6);const q=requests.find(r=>r.params.query.startsWith('养老'));assert.match(q.params.query,/养老/);assert.match(q.params.query,/为老服务中心/);assert.match(q.params.query,/疗养院/);
 assert.equal(prepared.candidatePool.length,1);assert.equal(prepared.searches.get('community_eldercare').recallScope,'whole_group_keywords');assert.equal(prepared.searches.get('community_eldercare').candidates.length,1);
});
test('v7 pipeline never calls configured official APIs, uses32 sampling and6 group Place, keeps25 costs and18 dynamic reports',async()=>{
 const{job,manager,calls}=await makeUi16Job();assert.equal(calls.order[0],'sampling');assert.equal(job.requestStats.officialRequests,0);assert.equal(job.requestStats.samplingRequests,32);
 assert.equal(job.rangeDiagnostics.strategy,'reference_walking');assert.equal(job.analysis.categoryMappingVersion,version);assert.equal(job.analysis.categories.flatMap(g=>g.subtypeResults).length,18);
 const community=job.analysis.categories.find(g=>g.categoryId==='eldercare').subtypeResults.find(s=>s.subtypeId==='community_eldercare');assert.equal(community.accessStatus,'reachable');assert.ok(community.routes.length);
 const report=manager.report(job.analysisId);assert.equal(report.reportVersion,'facility-report-v7');assert.equal(report.counts.subtypeCount,18);assert.match(reportPdfHtml(report),/18小类可达情况/);
 assert.doesNotMatch(walkingRangeNotice(job),/官方|等距圈|等时圈不可用/);assert.match(walkingRangeNotice(job),/32方向/);
 const body=makeFacilityTask({categoryTree:publicFacilityCategoryTree(version),priorities:{},origin:job.origin,analysisLocation:job.origin,walkingModelId:'walking80-v1',samplingConfirmed:true});assert.equal(body.version,7);assert.equal(body.routeScope,'circle_candidates');
 const hospital=job.analysis.categories.find(g=>g.categoryId==='medical').subtypeResults.find(s=>s.subtypeId==='hospital');assert.equal(hospital.routes.find(r=>r.facilityUid==='hospital-0').durationSeconds,901);
});
