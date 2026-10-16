import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createBatchWalkingProvider} from '../server/batch-walking.mjs';
import {createAuthorizedWalkingProvider,walkingTaskAllowance} from '../server/authorized-walking.mjs';
import {createFacilityPrefetch} from '../server/facility-prefetch.mjs';
import {createFacilityAnalysis} from '../server/facility-analysis.mjs';
import {scoreSixGroupPriorities} from '../server/priority-score.mjs';
import {publicFacilityCategoryTree} from '../server/facility-categories.mjs';
import {sampleReferenceWalkingRange,rayDestination} from '../server/reference-walking-range.mjs';
import {assessRegionalGaps} from '../server/regional-gaps.mjs';

const origin={id:'fixture',source:'map_click',uid:'community',location:{lng:120,lat:30}};
const targets=n=>Array.from({length:n},(_,i)=>({uid:'p'+i,location:{lng:120+(i+1)*.0001,lat:30.001}}));
function matrixFixture(options={}){
 let clock=Date.parse('2026-10-14T00:00:00Z');const calls=[];
 const provider=createBatchWalkingProvider({enabled:true,expiresAt:'2026-10-16T23:59:59.999+08:00',
  now:()=>clock,sleep:async ms=>{clock+=ms;},client:{requestJson:async q=>{
   calls.push({at:clock,...q});return{data:{result:q.params.destinations.split('|').map((_,i)=>({distance:{value:100+i},duration:{value:90+i}}))},meta:{retrievedAt:'fixture',cached:false}};
  }},...options});
 return{provider,calls,setClock:value=>{clock=value;}};
}
test('matrix preserves 25 ordered outputs in bounded chunks and shares a rolling output quota across callers',async()=>{
 const {provider,calls}=matrixFixture();const [a,b]=await Promise.all([
  provider.routeMany({origin,destinations:targets(18)}),
  provider.routeMany({origin,destinations:targets(25)})]);
 assert.equal(a.length,18);assert.equal(b.length,25);
 assert.equal(provider.stats().matrixOutputRoutes,25,'in-flight duplicates share one output');
 assert.equal(calls.reduce((n,c)=>n+c.params.destinations.split('|').length,0),25);
 for(const call of calls){const sameWindow=calls.filter(c=>c.at>=call.at&&c.at<call.at+1000);
  assert.ok(sameWindow.reduce((n,c)=>n+c.params.destinations.split('|').length,0)<=10);}
 assert.equal(b[24].requestedDestination.uid,'p24');
 assert.equal(b[0].requestedOrigin.uid,'community');
 assert.ok(calls.every(c=>!c.params.origins.includes(';community')));
 assert.ok(calls[0].params.destinations.includes(';p0'));
 await provider.routeMany({origin,destinations:targets(25)});
 assert.equal(provider.stats().matrixOutputRoutes,25);
 await provider.routeMany({origin:{...origin,uid:'different-community'},destinations:targets(1)});
 assert.equal(provider.stats().matrixOutputRoutes,26);
 await provider.routeMany({origin:{...origin.location,uid:'flat-community'},destinations:targets(1)});
 assert.ok(!calls.at(-1).params.origins.includes(';'),'flat origin objects must also use coordinate navigation');
});
test('matrix expiry, daily cap and persisted reservations prevent unauthorized calls after a restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'matrix-quota-')),path=join(dir,'usage.json');
 const first=matrixFixture({dailyLimit:2,usagePath:path});await first.provider.ready;
 await first.provider.routeMany({origin,destinations:targets(2)});
 assert.equal(JSON.parse(await readFile(path,'utf8')).outputs,2);
 const next=matrixFixture({dailyLimit:2,usagePath:path});await next.provider.ready;
 const exhausted=await next.provider.routeMany({origin,destinations:targets(1)});
 assert.equal(exhausted[0].routeStatus,'matrix_daily_limit_reached');assert.equal(next.calls.length,0);
 next.setClock(Date.parse('2026-10-15T00:00:00Z'));
 assert.equal((await next.provider.routeMany({origin,destinations:targets(1)}))[0].routeStatus,'ok');
 next.setClock(Date.parse('2026-10-17T00:00:00Z'));
 const expired=await next.provider.routeMany({origin,destinations:targets(2).slice(1)});
 assert.equal(expired[0].routeStatus,'permission_expired');assert.equal(next.calls.length,1);
});
test('regional cost-only verification uses three bounded batches for 25 cells and keeps the overall score separate',async()=>{
 const f=matrixFixture(),analysis={origin,categoryMappingVersion:'facility-categories-v8',categories:[{
  categoryId:'medical',label:'医疗',poiMarkers:[],subtypeResults:[{subtypeId:'hospital',searchComplete:true,
   searchTruncated:false,pendingClassificationCount:0,invalidCandidateCount:0,searchStatus:'success'}]}]};
 const geometry={geojson:{features:[{properties:{featureType:'sampled_boundary'},geometry:{type:'Polygon',
  coordinates:[[[119.99,29.99],[120.01,29.99],[120.01,30.01],[119.99,30.01],[119.99,29.99]]]}}]}};
 const result=await assessRegionalGaps({analysis,geometry,matrixProvider:f.provider});
 assert.equal(result.summary.verifiedCells,25);assert.equal(f.calls.length,3);
 assert.equal(f.provider.stats().matrixOutputRoutes,25);
 assert.equal(result.affectsOverallScore,false);assert.equal(result.specialty1kmUnchanged,true);
});
test('matrix cancellation does not dispatch queued outputs; an upstream zero stays unknown',async()=>{
 const controller=new AbortController(),first=matrixFixture({client:{requestJson:async()=>{
  controller.abort(new Error('cancel fixture'));return{data:{result:[{distance:0,duration:0}]},meta:{}};
 }},outputQps:1});
 await assert.rejects(first.provider.routeMany({origin,destinations:targets(3),signal:controller.signal}),/cancel fixture/);
 assert.equal(first.provider.stats().matrixOutputRoutes,1);
 const zero=matrixFixture({client:{requestJson:async()=>({data:{result:[{distance:0,duration:0}]},meta:{}})}});
 assert.equal((await zero.provider.routeMany({origin,destinations:targets(1)}))[0].routeStatus,'no_route');
});
test('Walking retry backoff releases the sole network slot for an unrelated route',async()=>{
 let release,entered;const waiting=new Promise(r=>{entered=r;}),pause=new Promise(r=>{release=r;});
 const seen=[];let attempts=0;
 const p=createAuthorizedWalkingProvider({concurrency:1,sleep:async()=>{entered();await pause;},
  client:{requestJson:async q=>{seen.push(q.params.destination);if(q.params.destination_uid==='p0'&&attempts++===0)throw Error('transient');
   return{data:{result:{routes:[{distance:200,duration:180}]}},meta:{}};}}});
 const a=walkingTaskAllowance(3),o={walkingAllowance:a};
 const retry=p.route(origin,targets(1)[0],o);await waiting;
 const other=await p.route(origin,targets(2)[1],o);
 assert.equal(other.routeStatus,'ok');assert.equal(seen.length,2,'second route finishes while retry is sleeping');
 release();assert.equal((await retry).routeStatus,'ok');assert.equal(a.used,3);assert.equal(a.retries,1);
});

function prefetchFixture(){
 const tree=publicFacilityCategoryTree('facility-categories-v8'),pool=tree.categories.flatMap(g=>g.subtypes.map((s,i)=>({
  uid:s.id,name:s.searchQueries[0],rawCategory:s.rawCategoryHints[0],
  location:{lng:120+.0003*(i+1),lat:30.001},queriedSubtypeIds:[s.id]})));
 const searches=new Map(tree.categories.flatMap(g=>g.subtypes.map(s=>[s.id,{candidates:pool.filter(p=>p.uid===s.id),searchComplete:true,status:'success'}])));
 const prepared={searches,order:tree.categories.flatMap(g=>g.subtypes.map(s=>({...s,categoryId:g.id}))),subtypeCount:18,candidatePool:pool,searchMs:0};
 const cache=new Map();let calls=0;
 const provider={stats:()=>({queueConcurrency:6}),peek:(a,b,o)=>cache.get(o.destinationUid),route:async(a,b,o)=>{
  calls++;o.walkingAllowance&&(o.walkingAllowance.used++);
  const r={mode:'walking',routeStatus:'ok',source:'explicit_offline_fixture',coordinateSystem:'BD-09LL',
   distanceMeters:300,durationSeconds:260,requestedOrigin:{location:a,uid:o.originUid},requestedDestination:{location:b,uid:o.destinationUid},
   geometry:{type:'LineString',coordinates:[[a.lng,a.lat],[b.lng,b.lat]]},walkingRequestAttempts:1};
  cache.set(o.destinationUid,r);return r;
 }};
 const geometry={geometrySource:'walking_sampling_fallback',geojson:{features:[{properties:{featureType:'sampled_boundary'},geometry:{type:'Polygon',coordinates:[[[119.99,29.99],[120.01,29.99],[120.01,30.01],[119.99,30.01],[119.99,29.99]]]}}]}};
 return {prepared,provider,geometry,calls:()=>calls};
}
test('overlapped prefetch reuses bound paths while keeping all six groups, eighteen subtype outcomes and scores identical',async()=>{
 async function run(withPrefetch){const f=prefetchFixture(),allowance=walkingTaskAllowance(220);
  const prefetch=withPrefetch?createFacilityPrefetch({preparedSearches:Promise.resolve(f.prepared),origin,
   mappingVersion:'facility-categories-v8',provider:f.provider,walkingAllowance:allowance,walkingModelId:'walking80-v1',signal:new AbortController().signal}):null;
  await prefetch?.promise;prefetch?.stop();
  const wrapped={...f.provider,route:async(a,b,o)=>await prefetch?.claim(a,b,o)??f.provider.route(a,b,{...o,walkingAllowance:allowance})};
  const analysis=await createFacilityAnalysis({placeProvider:{searchAround:async()=>assert.fail('prepared recall must be reused')},routeProvider:wrapped}).analyze({
   origin,categoryMappingVersion:'facility-categories-v8',preparedSearches:Promise.resolve(f.prepared),geometry:f.geometry,
   routeScope:'circle_candidates',walkingModelId:'walking80-v1',maxRouteCandidatesPerSubtype:3});
  return{analysis,score:scoreSixGroupPriorities({analysis,priorities:Object.fromEntries(['education','medical','commerce','transport','eldercare','leisure'].map(id=>[id,2]))}),calls:f.calls(),prefetch:prefetch?.stats()};
 }
 const a=await run(false),b=await run(true);
 const business=value=>JSON.parse(JSON.stringify(value,(key,item)=>
  ['evidenceId','evidenceIds','observedAt','cached','walkingRequestAttempts'].includes(key)?undefined:item));
 assert.deepEqual(business(b.analysis.categories),business(a.analysis.categories));
 assert.equal(b.score.S_low,a.score.S_low);assert.equal(b.score.S_high,a.score.S_high);
 assert.equal(b.calls,a.calls,'same unique real Walking paths, no extra geometry calls');
 assert.ok(b.prefetch.claimed>0);
});
test('prefetch stops scheduling when range completes and leaves constrained budgets to canonical work',async()=>{
 const f=prefetchFixture(),signal=new AbortController().signal;
 const p=createFacilityPrefetch({preparedSearches:Promise.resolve(f.prepared),origin,mappingVersion:'facility-categories-v8',
  provider:f.provider,walkingAllowance:walkingTaskAllowance(60),walkingModelId:'walking80-v1',signal});
 await p.promise;assert.equal(f.calls(),0);
 const q=createFacilityPrefetch({preparedSearches:Promise.resolve(f.prepared),origin,mappingVersion:'facility-categories-v8',
  provider:f.provider,walkingAllowance:walkingTaskAllowance(220),walkingModelId:'walking80-v1',signal});
 q.stop();await q.promise;assert.equal(f.calls(),0);
 const capped=createFacilityPrefetch({preparedSearches:Promise.resolve(f.prepared),origin,mappingVersion:'facility-categories-v8',
  provider:f.provider,walkingAllowance:walkingTaskAllowance(220),walkingModelId:'walking80-v1',signal,maxCandidates:5});
 await capped.promise;assert.equal(f.calls(),0,'a configured circle ceiling must not be bypassed');
 const failed=createFacilityPrefetch({preparedSearches:Promise.resolve(f.prepared),origin,mappingVersion:'facility-categories-v8',
  provider:{...f.provider,route:()=>{throw Error('optional prefetch failure');}},
  walkingAllowance:walkingTaskAllowance(220),walkingModelId:'walking80-v1',signal});
 await failed.promise;assert.equal(failed.stats().successful,0);
 assert.equal(await failed.claim(origin.location,f.prepared.candidatePool[0].location,
  {destinationUid:f.prepared.candidatePool[0].uid,originUid:origin.uid}),null);
});
test('36-ray boundary representatives and sample ordering are independent of response completion order',async()=>{
 const byTarget=new Map(Array.from({length:36},(_,i)=>{const p=rayDestination(origin.location,i*10);return[p.lat.toFixed(6)+','+p.lng.toFixed(6),i];}));
 async function run(reverse){return sampleReferenceWalkingRange({center:origin.location,originUid:origin.uid,
  maxRouteCalls:36,sampleCount:36,provider:{stats:()=>({queueConcurrency:10}),route:async(a,b,o)=>{
   const sector=byTarget.get(b.lat.toFixed(6)+','+b.lng.toFixed(6));
   await new Promise(resolve=>setTimeout(resolve,reverse?sector%7:6-sector%7));
   return{mode:'walking',routeStatus:'ok',coordinateSystem:'BD-09LL',distanceMeters:1800,durationSeconds:1600,
    requestedOrigin:{uid:o.originUid,location:a},requestedDestination:{uid:null,location:b},
    geometry:{type:'LineString',coordinates:[[a.lng,a.lat],[b.lng,b.lat]]}};
  }}});}
 const a=await run(false),b=await run(true);
 assert.equal(a.geojson.features.length,1);assert.deepEqual(a.geojson,b.geojson);
 assert.deepEqual(a.samples.map(s=>s.sector),Array.from({length:36},(_,i)=>i));
 assert.deepEqual(b.samples.map(s=>s.sector),a.samples.map(s=>s.sector));
});
