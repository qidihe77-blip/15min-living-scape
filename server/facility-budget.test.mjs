import test from 'node:test';
import assert from 'node:assert/strict';
import { createFacilityJobManager } from './facility-job.mjs';
import { createBaiduPlaceProvider } from './baidu-place.mjs';
import { createBaiduRouteProvider } from './baidu-route.mjs';
import { BaiduApiError } from './baidu-client.mjs';
import { createFacilityBudget } from './facility-budget.mjs';
import { fairSubtypeOrder } from './facility-schedule.mjs';
import { FACILITY_GROUP_IDS, FACILITY_SUBTYPES } from './facility-categories.mjs';
import { createFacilityAnalysis } from './facility-analysis.mjs';

const point = { lat: 30.288902, lng: 120.150993 };
const body = (extra = {}) => ({ version: 3, categoryMappingVersion: 'facility-categories-v3',
  origin: { id: 'origin', source: 'map_click', location: point }, categoryIds: [...FACILITY_GROUP_IDS],
  mode: 'walking', minutes: 15, ...extra });
export async function waitForJob(manager, id) {
  for (let i = 0; i < 300; i++) {
    const job = manager.get(id); if (!['queued','running'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('Fixture job did not terminate.');
}
const empty = () => ({ searchComplete: true, status: 'complete', candidates: [], errors: [], requestStats: { logicalRequests: 1 } });

test('fair order covers every subtype once with three specialty subtypes first then group rotation', () => {
  const order = fairSubtypeOrder();
  assert.deepEqual(order.slice(0,3).map((s)=>s.id), ['market','pharmacy','primary_school']);
  assert.equal(new Set(order.map((s)=>s.id)).size,25);
  assert.deepEqual(order.slice(3,9).map((s)=>s.categoryId),FACILITY_GROUP_IDS);
});
test('24 Place balance leaves the last subtype unknown, after cross-group first-page opportunities', async () => {
  const order=[];
  const manager=createFacilityJobManager({placeRequestLimit:24,
    placeProvider:{searchAround:async({subtypeId,maxRequests})=>{order.push(subtypeId);assert.equal(maxRequests,1);return empty();}},
    routeProvider:{route:async()=>{throw new Error('empty searches need no route');}}});
  const job=await waitForJob(manager,manager.create(body()).analysisId);
  assert.deepEqual(order,fairSubtypeOrder().slice(0,24).map((s)=>s.id));
  assert.equal(job.requestStats.placeRequests,24);
  const missing=job.analysis.categories.flatMap((g)=>g.subtypeResults).filter((s)=>s.accessStatus==='unknown');
  assert.equal(missing.length,1);assert.equal(missing[0].subtypeId,fairSubtypeOrder()[24].id);
});
test('incremental Place resumes page 1 after all 25 initial pages, bounded at 30 calls', async () => {
  const calls=[];
  const placeProvider=createBaiduPlaceProvider({client:{requestJson:async({params})=>{
    calls.push({query:params.query,page:Number(params.page_num)});
    const results=Array.from({length:Number(params.page_num)===0?20:1},(_,i)=>({uid:params.query+'-'+params.page_num+'-'+i,
      name:'名称待核验',location:point}));
    return {data:{results,total:21},meta:{retrievedAt:'2026-10-05T00:00:00Z'}};
  }}});
  const manager=createFacilityJobManager({placeProvider,routeProvider:{route:async()=>{throw new Error('unknown classification');}}});
  const job=await waitForJob(manager,manager.create(body()).analysisId);
  assert.equal(calls.length,30);assert.ok(calls.slice(0,25).every((c)=>c.page===0));
  assert.ok(calls.slice(25).every((c)=>c.page===1));
  assert.equal(job.requestStats.placeRequests,30);
  const slots=job.analysis.categories.flatMap((g)=>g.subtypeResults);
  assert.equal(slots.filter((s)=>s.searchComplete).length,5);
  assert.equal(slots.filter((s)=>!s.searchComplete).length,20);
  assert.equal(job.requestStats.routeDecisions,0);
});
test('facilities are published before optional geometry and a terminal Place error stops all later services', async () => {
  const order=[];let release;
  const manager=createFacilityJobManager({placeProvider:{searchAround:async()=>{order.push('place');return empty();}},
    routeProvider:{route:async()=>({routeStatus:'ok',durationSeconds:500,distanceMeters:100})},
    officialEnabled:true,officialEntitlementVerified:true,officialRequestLimit:1,
    officialProvider:{getIsochrone:async()=>{order.push('geometry');return new Promise((resolve)=>{release=resolve;});}}});
  const id=manager.create(body()).analysisId;
  while(!release)await new Promise((r)=>setTimeout(r,2));
  assert.equal(order.indexOf('geometry'),25);assert.ok(manager.get(id).analysis);assert.ok(manager.get(id).score);
  release({geometrySource:'baidu_isochrone',geojson:{features:[{}]}});await waitForJob(manager,id);
  let places=0,routes=0,geometry=0;
  const halted=createFacilityJobManager({placeProvider:{searchAround:async()=>{places++;return {...empty(),searchComplete:false,
    errors:[{code:'permission_denied'}]};}},routeProvider:{route:async()=>{routes++;}},
    officialEnabled:true,officialEntitlementVerified:true,officialRequestLimit:1,officialProvider:{getIsochrone:async()=>{geometry++;}}});
  const result=await waitForJob(halted,halted.create(body()).analysisId);
  assert.equal(places,1);assert.equal(routes,0);assert.equal(geometry,0);assert.equal(result.score.S_high,100);
});
test('cost cap, 6 detail cap and common totals apply; 24 costs never silently become 25', async () => {
  let calls=0;const controller=new AbortController();
  const budget=createFacilityBudget({placeProvider:{},routeProvider:{route:async()=>{calls++;return {routeStatus:'ok'};}},
    processBudget:{placeRequests:0,routeDecisions:0},signal:controller.signal,input:{maxRouteCandidatesPerSubtype:1},
    limits:{place:30,route:100,taskPlace:30,taskCost:25,taskDetail:6,taskRoute:31}});
  for(let i=0;i<26;i++)await budget.route.route(point,{...point,lng:point.lng+i/10000});
  assert.equal(calls,25);
  for(let i=0;i<7;i++)await budget.route.route(point,point,{includeGeometry:true});
  assert.equal(calls,31);assert.equal(budget.stats.detailRequests,6);
  assert.equal(budget.stats.routeDecisions,31);
});
test('Matrix outputs plus Lite fallback count together, terminal 429 never falls back', async () => {
  let lite=0,matrix=0;
  const provider=createBaiduRouteProvider({matrixEnabled:true,matrixVerified:true,matrixOutputLimit:10,matrixOutputQps:10,
    client:{requestJson:async({service})=>{if(service==='route_matrix'){matrix++;throw new BaiduApiError('rate_limited',{service});}lite++;}}});
  const budget=createFacilityBudget({placeProvider:{},routeProvider:provider,processBudget:{placeRequests:0,routeDecisions:0},
    signal:new AbortController().signal,input:{maxRouteCandidatesPerSubtype:1},
    limits:{place:30,route:100,taskPlace:30,taskCost:25,taskDetail:6,taskRoute:31}});
  assert.equal((await budget.route.route(point,point)).routeStatus,'rate_limited');
  assert.equal((await budget.route.route(point,point)).routeStatus,'service_halted');
  assert.equal(matrix,1);assert.equal(lite,0);assert.equal(budget.stats.matrixOutputRoutes,1);
});

test('three-candidate extension routes one candidate per subtype per round, without repeating failed endpoints', async()=>{
  const calls=[];
  const names={market:'菜市场',pharmacy:'药店',primary_school:'文锦小学'};
  const analysis=await createFacilityAnalysis({placeProvider:{searchAround:async({subtypeId})=>({...empty(),
    candidates:names[subtypeId]?Array.from({length:3},(_,i)=>({uid:subtypeId+'-'+i,name:names[subtypeId],
      location:{lat:point.lat+.001*(i+1),lng:point.lng}})):[]})},routeProvider:{route:async(_from,_to,options)=>{
      calls.push(options.destinationUid);return options.destinationUid==='pharmacy-0'?{routeStatus:'timeout'}
        :{routeStatus:'ok',mode:'walking',durationSeconds:850,distanceMeters:500,coordinateSystem:'BD-09LL'};
    }}}).analyze({origin:body().origin,maxRouteCandidatesPerSubtype:3});
  assert.deepEqual(calls,Array.from({length:3},(_,i)=>['market-'+i,'pharmacy-'+i,'primary_school-'+i]).flat());
  assert.equal(calls.filter((id)=>id==='pharmacy-0').length,1);
  assert.equal(analysis.categories[1].subtypeResults.find((s)=>s.subtypeId==='pharmacy').accessStatus,'reachable');
});

test('a 24-route process balance clips a 25-cost task and leaves zero room for additional details',async()=>{
  let calls=0;
  const budget=createFacilityBudget({placeProvider:{},routeProvider:{route:async()=>{calls++;return {routeStatus:'ok'};}},
    processBudget:{placeRequests:0,routeDecisions:0},signal:new AbortController().signal,input:{maxRouteCandidatesPerSubtype:1},
    limits:{place:30,route:24,taskPlace:30,taskCost:25,taskDetail:6,taskRoute:31}});
  for(let i=0;i<24;i++)await budget.route.route(point,point);
  assert.equal((await budget.route.route(point,point)).routeStatus,'route_request_limit_reached');
  assert.equal((await budget.route.route(point,point,{includeGeometry:true})).routeStatus,'route_detail_limit_reached');
  assert.equal(calls,24);assert.equal(budget.stats.detailRequests,0);
});
