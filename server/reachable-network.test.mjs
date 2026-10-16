import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalkingProvider } from './walking-provider.mjs';
import { buildIsochrone } from './isochrone.mjs';
import { createFacilityJobManager } from './facility-job.mjs';
import { FACILITY_GROUP_IDS } from './facility-categories.mjs';
const center={lat:30,lng:120};
const fixtures={kindergarten:'测试幼儿园',hospital:'测试医院',market:'测试菜市场',bus_stop:'测试公交站',
  residential_eldercare:'测试养老院',park_green:'测试公园'};
const task={version:3,categoryMappingVersion:'facility-categories-v3',origin:{id:'test',source:'map_click',location:center},
  mode:'walking',minutes:15,categoryIds:FACILITY_GROUP_IDS,subtypeScope:'all',includeReachableNetwork:true};
async function finish(manager,id){for(let i=0;i<200;i++){const job=manager.get(id);if(['complete','partial','failed'].includes(job.status))return job;
  await new Promise((resolve)=>setTimeout(resolve,5));}throw new Error('Fixture deadline');}
function createFixture(detailStatus='ok',duration=850,taskDetailLimit=6){let details=0,costs=0;
  const manager=createFacilityJobManager({taskDetailLimit,placeProvider:{searchAround:async({subtypeId})=>({status:'complete',searchComplete:true,
    candidates:fixtures[subtypeId]?[{uid:subtypeId,name:fixtures[subtypeId],location:{lat:30.001,lng:120.001}}]:[],requestStats:{logicalRequests:1}})},
    routeProvider:{route:async(from,to,options)=>{options.includeGeometry?details++:costs++;
      return {routeStatus:options.includeGeometry?detailStatus:'ok',durationSeconds:options.includeGeometry?duration:850,distanceMeters:150,
        mode:'walking',coordinateSystem:'BD-09LL',source:'offline',geometry:options.includeGeometry&&detailStatus==='ok'
          ?{type:'LineString',coordinates:[[from.lng,from.lat],[to.lng,from.lat],[to.lng,to.lat]]}:null};}}});
  return {manager,counts:()=>({details,costs})};}
test('sampling provider keeps same-response step paths and buildIsochrone exports only reachable roads',async()=>{
  const provider=createWalkingProvider({serverAk:'offline',fetchImpl:async(url)=>{const destination=new URL(url).searchParams.get('destination').split(',').map(Number);
    return {ok:true,json:async()=>({status:0,result:{routes:[{duration:destination[0]>30?901:900,distance:300,
      steps:[{path:'120,30;'+destination[1]+',30;'+destination[1]+','+destination[0]}]}]}})};}});
  const result=await buildIsochrone({center,provider,radiusMeters:300,spacingMeters:300,maxGridPoints:5,maxRouteCalls:4,maxRefinementPoints:0});
  const roads=result.geojson.features.filter((f)=>f.properties.featureType==='reachable_route');
  assert.ok(roads.length>0);assert.ok(roads.every((f)=>f.properties.durationSeconds<=900));
  assert.ok(roads.every((f)=>f.geometry.coordinates.length>=2));
  assert.equal(result.sampleMetrics.attemptedRouteCalls,4);
});
test('explicit network supplement shares six-detail budget; weights and cached route opening add no upstream',async()=>{
  const {manager,counts}=createFixture();const job=await finish(manager,manager.create(task).analysisId);
  assert.equal(job.requestStats.detailRequests,6);assert.equal(job.requestStats.routeDecisions,12);
  assert.equal(job.networkEvidence.completeness,'partial');
  const before=counts();const row=job.analysis.categories[0].subtypeResults.flatMap((s)=>s.routes)[0];
  manager.rescore(job.analysisId,{evidenceFingerprint:job.score.evidenceFingerprint,priorities:{education:6},selectedCategoryIds:FACILITY_GROUP_IDS});
  await manager.routeDetail(job.analysisId,{evidenceFingerprint:job.score.evidenceFingerprint,identityKey:row.identityKey,subtypeId:row.subtypeId});
  assert.deepEqual(counts(),before);
});
test('network limit zero adds no requests, 429 stops supplementation and 901 refreshes score evidence',async()=>{
  const zero=createFixture('ok',850,0);const zeroJob=await finish(zero.manager,zero.manager.create(task).analysisId);
  assert.equal(zero.counts().details,0);assert.equal(zeroJob.networkEvidence.unknownReason,'detail_budget_exhausted');
  const blocked=createFixture('rate_limited');await finish(blocked.manager,blocked.manager.create(task).analysisId);
  assert.equal(blocked.counts().details,1);
  const changed=createFixture('ok',901);const job=await finish(changed.manager,changed.manager.create(task).analysisId);
  assert.ok(job.analysis.categories.every((g)=>g.reachableSubtypeCount===0));assert.equal(job.score.S_low,0);
  const bad={...task,includeReachableNetwork:'yes'};assert.throws(()=>changed.manager.create(bad),/boolean/);
});
