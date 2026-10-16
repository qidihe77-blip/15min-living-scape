import test from'node:test';import assert from'node:assert/strict';
import{reachableFacilityRows,reachablePoiCount}from'../web/reachable-presentation.js';
import{compactMarkerVisual}from'../web/marker-presentation.js';
import{getServerConfig,publicMapFeatureFlags}from'../server/config.mjs';
import{createBaiduIsochroneProvider}from'../server/baidu-isochrone.mjs';
import{createFacilityJobManager}from'../server/facility-job.mjs';
import{publicFacilityCategoryTree}from'../server/facility-categories.mjs';
import{BaiduApiError}from'../server/baidu-client.mjs';
import{walkingRangeNotice}from'../web/reachable-presentation.js';
const origin={uid:'start',location:{lng:120,lat:30}};
const row=(uid,seconds,types=['hospital'])=>({uid,identityKey:'uid:'+uid,subtypeIds:types,routeEvidence:{routeStatus:'ok',mode:'walking',coordinateSystem:'BD-09LL',origin:origin.location,originUid:'start',destinationUid:uid,durationSeconds:seconds,distanceMeters:600}});
test('UI14 only projects confirmed bound <=900-second POIs, never 901 or missing/other-origin costs',()=>{
 const good=row('inclusive',900),badOrigin=row('old',800);badOrigin.routeEvidence.origin={lng:121,lat:30};
 const differentUid=row('uid',700);differentUid.routeEvidence.destinationUid='other';
 assert.deepEqual(reachableFacilityRows([good,row('late',901),row('negative',-1),row('nan',NaN),{...row('missing',800),routeEvidence:null},badOrigin,differentUid,row('pending',800,[])],origin).map(p=>p.uid),['inclusive']);
});
test('per-group POI count deduplicates UID memberships instead of summing subtypes',()=>{
 const rows=[row('one',900,['hospital','pharmacy']),row('one',900,['hospital']),row('two',800,['pharmacy']),row('school',500,['primary_school'])];
 assert.equal(reachablePoiCount(reachableFacilityRows(rows,origin),['hospital','pharmacy']),2);
});
test('compact markers retain a real icon for every POI at every zoom, with only slight hover/selection growth',()=>{
 for(const zoom of[12,15,16,18]){const normal=compactMarkerVisual({identityKey:'x'},{zoom}),hover=compactMarkerVisual({identityKey:'x'},{zoom,hovered:true});assert.equal(normal.important,true);assert.equal(normal.dotDiameter,0);assert.ok(normal.width>=20&&normal.width<=24);assert.ok(hover.width/normal.width<=1.1);}
});
test('isochrone entitlement ends at Shanghai end-of-day without disabling other approved services',()=>{
 const cfg=getServerConfig({BAIDU_SERVER_AK:'explicit-test',BAIDU_ISOCHRONE_ENABLED:'true',BAIDU_ISOCHRONE_ENTITLEMENT_VERIFIED:'true',BAIDU_ISOCHRONE_REQUEST_LIMIT:'8',BAIDU_ISOCHRONE_VALID_UNTIL:'2026-10-11'});
 assert.equal(Date.parse(cfg.isochroneExpiresAt),Date.parse('2026-10-11T15:59:59.999Z'));assert.equal(publicMapFeatureFlags({...cfg,isochroneExpiresAt:'2000-01-01T00:00:00Z'}).isochroneRequestEnabled,false);assert.equal(cfg.walkingSamplingFallbackEnabled,true);
 for(const value of['2026-02-30','2026-13-01','bad'])assert.throws(()=>getServerConfig({BAIDU_ISOCHRONE_VALID_UNTIL:value}),/valid YYYY-MM-DD/);
});
test('an expired official provider never calls upstream, even if it could otherwise return a cached circle',async()=>{
 let requests=0;const provider=createBaiduIsochroneProvider({enabled:true,client:{requestJson:async()=>{requests++;}},expiresAt:'2026-10-11T23:59:59.999+08:00',now:()=>Date.parse('2026-10-12T00:00:00+08:00')});
 await assert.rejects(provider.getIsochrone({center:origin.location}),e=>e.code==='permission_expired');assert.equal(requests,0);
});
test('IP failure message stays specific, and a real circle never becomes an unavailable warning',()=>{
 assert.match(walkingRangeNotice({display:{rangeAvailable:false},rangeDiagnostics:{failures:[{service:'isochrone',apiStatus:210}]}}),/210.*IP校验失败/);
 assert.equal(walkingRangeNotice({display:{rangeAvailable:true,rangeRouteDisagreements:0}}),'');
});
test('terminal isochrone failure stops only that provider; later tasks still search all 17 subtypes with no repeated official request',async()=>{
 const tree=publicFacilityCategoryTree('facility-categories-v6');let official=0,place=0;
 const manager=createFacilityJobManager({officialEnabled:true,officialEntitlementVerified:true,officialRequestLimit:8,
  officialProvider:{getIsochrone:async()=>{official++;throw new BaiduApiError('permission_denied',{service:'isochrone',apiStatus:210});}},
  placeProvider:{searchAround:async()=>{place++;return{status:'complete',searchComplete:true,candidates:[],requestStats:{logicalRequests:1}};}},routeProvider:{route:async()=>{throw Error('No candidates');}}});
 for(let n=0;n<2;n++){const created=manager.create({version:6,categoryMappingVersion:tree.version,origin:{...origin,source:'map_click',id:'test',name:'test'},categoryIds:tree.categories.map(g=>g.id),mode:'walking',minutes:15,priorities:{}});let job;
  for(let i=0;i<100;i++){job=manager.get(created.analysisId);if(['complete','partial','failed'].includes(job.status))break;await new Promise(r=>setTimeout(r,1));}
  assert.notEqual(job.status,'failed');assert.equal(job.rangeDiagnostics.officialConfiguration.haltedReason,'permission_denied');assert.equal(job.rangeDiagnostics.failures[0].apiStatus,210);
 }
 assert.equal(official,1);assert.equal(place,34);
});
