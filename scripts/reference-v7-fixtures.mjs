import assert from 'node:assert/strict';
import {createFacilityJobManager} from '../server/facility-job.mjs';
import {createBaiduPlaceProvider} from '../server/baidu-place.mjs';
import {publicFacilityCategoryTree} from '../server/facility-categories.mjs';
import {sampleReferenceWalkingRange} from '../server/reference-walking-range.mjs';
import {sampleBatchWalkingRange} from '../server/batch-walking-range.mjs';
import {assessRegionalGaps} from '../server/regional-gaps.mjs';
import {analyticRoadProvider} from '../test/fixtures/adaptive-roads.mjs';
export async function makeUi16Job({batch=false}={}){
 const tree=publicFacilityCategoryTree('facility-categories-v7'),origin={id:'v7-offline',source:'map_click',uid:'start-80',name:'18小类离线验收（非真实分析）',location:{lng:120,lat:30}},calls={place:0,cost:0,detail:0,range:0,sampling:0,order:[]},positions=new Map();let range,index=0;
 const place=createBaiduPlaceProvider({client:{requestJson:async({params})=>{calls.place++;calls.order.push('place');const group=tree.categories.find(g=>g.id===['学校','医院','商超','公交站','养老','公园'].map((q,i)=>params.query.startsWith(q)?tree.categories[i].id:null).find(Boolean))??tree.categories.find(g=>params.query.split('$').some(q=>g.subtypes.some(s=>s.searchQueries.includes(q))));assert.ok(group,params.query);
  const results=group.subtypes.flatMap(sub=>[0,1].map(i=>{const uid=sub.id+'-'+i;if(!positions.has(uid))positions.set(uid,{lng:120+.00018*(++index),lat:30+.0003+i*.0005});return{uid,name:sub.id==='community_eldercare'?'街道综合为老服务中心（离线样本）'+i:sub.searchQueries.find(q=>q!=='养老')+i,location:positions.get(uid),detail_info:{tag:sub.id==='community_eldercare'?'生活服务;养老机构':sub.rawCategoryHints[0]}};}));
  return{data:{status:0,total:results.length,results},meta:{retrievedAt:'2026-10-10T00:00:00Z'}};}}});
 const matrix={routeMany:async({origin,destinations})=>Promise.all(destinations.map(p=>analyticRoadProvider().route(origin.location,p,{originUid:origin.uid})))};
 const manager=createFacilityJobManager({placeProvider:place,newModelMinIntervalMs:0,distanceEnabled:true,distanceEntitlementVerified:true,officialRequestLimit:1,
  rangeStrategy:batch?'walking_batch':'official_first',regionalRunner:batch?args=>assessRegionalGaps({...args,matrixProvider:matrix}):null,
  distanceProvider:{getIsodistance:async()=>assert.fail('official distance must never be called')},officialProvider:{getIsochrone:async()=>assert.fail('official time must never be called')},officialEnabled:true,officialEntitlementVerified:true,
  walkingSamplingEnabled:true,samplingRequestLimit:batch?176:32,samplingRunner:async({center,origin,maxRouteCalls,budget,signal,onProgress})=>{calls.order.push('sampling');const provider=analyticRoadProvider({latencyMs:1});range=batch?await sampleBatchWalkingRange({center,originUid:origin.uid,matrixProvider:matrix,maxMatrixOutputs:108,signal,onProgress}):await sampleReferenceWalkingRange({center,originUid:origin.uid,provider,maxRouteCalls,signal,onProgress});const used=batch?range.matrixRequestStats.outputRoutes:provider.stats().calls;calls.sampling+=used;budget.networkRequests+=used;return range;},
  routeProvider:{route:async(a,b,o)=>{o.includeGeometry?calls.detail++:calls.cost++;return{routeStatus:'ok',source:'explicit_offline_v7_fixture',mode:'walking',coordinateSystem:'BD-09LL',durationSeconds:o.destinationUid==='hospital-0'?901:400,
   distanceMeters:o.destinationUid==='hospital-0'?1200:o.destinationUid==='hospital-1'?1201:640,requestedOrigin:{location:a,uid:o.originUid},requestedDestination:{location:b,uid:o.destinationUid},
   geometry:{type:'LineString',coordinates:[[a.lng,a.lat],[b.lng,a.lat],[b.lng,b.lat]]},geometryStatus:'provider_path',retrievedAt:'2026-10-10T00:00:00Z'};}}});
 const created=manager.create({version:7,categoryMappingVersion:tree.version,origin,analysisLocation:origin,categoryIds:tree.categories.map(g=>g.id),mode:'walking',minutes:15,priorities:{},routeScope:'all_candidates',includeReachableNetwork:true,confirmRealWalkingSampling:true,samplingBudget:'low'});
 let job;for(let n=0;n<500;n++){job=manager.get(created.analysisId);if(['complete','partial','failed'].includes(job.status))break;await new Promise(r=>setTimeout(r,2));}assert.ok(['complete','partial'].includes(job.status),JSON.stringify(job.error));
 assert.ok(calls.place>=6&&calls.place<=30);assert.equal(calls.sampling,batch?108:32);assert.equal(calls.cost,25);assert.equal(calls.range,0);assert.equal(job.geometryStatus,'sampled_approximation');
 return{job,manager,calls,range};
}
