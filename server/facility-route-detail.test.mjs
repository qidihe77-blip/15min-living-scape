import test from 'node:test';
import assert from 'node:assert/strict';
import { createFacilityJobManager } from './facility-job.mjs';
import { FACILITY_GROUP_IDS } from './facility-categories.mjs';
const point={lat:30.288902,lng:120.150993};
const body={version:3,categoryMappingVersion:'facility-categories-v3',mode:'walking',minutes:15,
  origin:{id:'origin',source:'map_click',location:point},categoryIds:[...FACILITY_GROUP_IDS]};
async function setup(options={}){
  let calls=0;
  const manager=createFacilityJobManager({placeProvider:{searchAround:async({subtypeId})=>({searchComplete:true,status:'complete',
    candidates:subtypeId==='pharmacy'?[{uid:'pharmacy',name:'社区药店',location:{...point,lng:point.lng+.001}}]:[],
    requestStats:{logicalRequests:1}})},routeProvider:{route:async(_from,_to,params)=>{
      calls++;return {routeStatus:'ok',durationSeconds:params.includeGeometry?901:900,distanceMeters:params.includeGeometry?650:600,
        mode:'walking',coordinateSystem:'BD-09LL',retrievedAt:params.includeGeometry?'2026-10-05T00:01:00Z':'2026-10-05T00:00:00Z',
        geometry:params.includeGeometry?{type:'LineString',coordinates:[[point.lng,point.lat],[point.lng+.001,point.lat]]}:null,
        geometryStatus:params.includeGeometry?'provider_path':'not_requested',source:'fixture'};
    }},...options});
  const id=manager.create(body).analysisId;
  for(let i=0;i<100 && ['queued','running'].includes(manager.get(id).status);i++)await new Promise((r)=>setTimeout(r,2));
  return {manager,id,calls:()=>calls};
}
test('route detail 900→901 replaces cost, path, nearest and score together; same evidence geometry is reused',async()=>{
  const {manager,id,calls}=await setup();
  const original=manager.get(id), fingerprint=original.score.evidenceFingerprint;
  const result=await manager.routeDetail(id,{evidenceFingerprint:fingerprint,identityKey:'uid:pharmacy',subtypeId:'pharmacy'});
  assert.equal(result.routeStatus,'ok');assert.equal(result.costChanged,true);assert.equal(result.route.durationSeconds,901);
  assert.ok(result.route.geometry);assert.equal(result.job.score.S_low,0);
  const pharmacy=result.job.analysis.categories[1].subtypeResults.find((s)=>s.subtypeId==='pharmacy');
  assert.equal(pharmacy.accessStatus,'no_reachable_in_declared_search');assert.equal(pharmacy.nearestReachable,null);
  assert.notEqual(result.job.score.evidenceFingerprint,fingerprint);assert.equal(calls(),2);
  const again=await manager.routeDetail(id,{evidenceFingerprint:result.job.score.evidenceFingerprint,identityKey:'uid:pharmacy',subtypeId:'pharmacy'});
  assert.equal(again.cached,true);assert.equal(calls(),2);
  await assert.rejects(()=>manager.routeDetail(id,{evidenceFingerprint:fingerprint,identityKey:'uid:pharmacy',subtypeId:'pharmacy'}),/snapshot/);
  assert.equal(calls(),2);
});
test('no detail allowance returns unknown path without another provider call or fabricated line',async()=>{
  const {manager,id,calls}=await setup({taskDetailLimit:0});
  const result=await manager.routeDetail(id,{evidenceFingerprint:manager.get(id).score.evidenceFingerprint,
    identityKey:'uid:pharmacy',subtypeId:'pharmacy'});
  assert.equal(result.routeStatus,'route_detail_limit_reached');assert.equal(result.geometry,null);assert.equal(calls(),1);
  assert.equal(result.job.score.S_low,4.166667);
});
test('route detail rejects arbitrary coordinates and unrelated subtype without upstream calls',async()=>{
  const {manager,id,calls}=await setup();
  await assert.rejects(()=>manager.routeDetail(id,{evidenceFingerprint:manager.get(id).score.evidenceFingerprint,
    identityKey:'uid:pharmacy',subtypeId:'market',destination:{lat:0,lng:0}}),/existing verified/);
  assert.equal(calls(),1);
});
