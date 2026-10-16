import test from'node:test';import assert from'node:assert/strict';
import{knownReachableEnvelope}from'../web/poi-envelope.js';import{selectDrawableRoute}from'../web/selected-route.js';
import{createMapThemeRuntime}from'../web/map-theme-runtime.js';import{createBaiduClient}from'../server/baidu-client.mjs';
import{runBenchmark}from'../scripts/benchmark-ui15.mjs';
import{orderedBatches}from'../server/bounded-batches.mjs';
const origin={uid:'o',location:{lng:120,lat:30}};
const point=(uid,lng,lat,seconds=900)=>({uid,identityKey:'uid:'+uid,location:{lng,lat},subtypeIds:['hospital'],routeEvidence:{routeStatus:'ok',mode:'walking',coordinateSystem:'BD-09LL',origin:origin.location,originUid:'o',destinationUid:uid,durationSeconds:seconds,distanceMeters:500}});
test('POI envelope is separately labelled schematic, rejects 901/stale costs and cannot claim interior reachability',()=>{
 const rows=[point('a',120,30),point('b',120.01,30),point('c',120,30.01),point('d',121,31,901)];const snapshot=JSON.stringify(rows),feature=knownReachableEnvelope(rows,origin);
 assert.equal(feature.properties.presentationOnly,true);assert.equal(feature.properties.continuousRangeAvailable,false);assert.equal(feature.properties.interiorStatus,'unknown');assert.equal(feature.properties.pointCount,3);assert.equal(feature.geometry.coordinates[0].length,4);assert.equal(JSON.stringify(rows),snapshot);
 assert.equal(knownReachableEnvelope(rows,{...origin,uid:'other'}),null);assert.equal(knownReachableEnvelope([point('a',120,30),point('b',120.01,30),point('c',120.02,30)],origin),null);
});
test('single route selection preserves actual bent and disconnected polylines; stale origin and missing geometry cannot draw',()=>{
 const route={identityKey:'a',origin:origin.location,originUid:'o',categoryIds:['medical'],mode:'walking',coordinateSystem:'BD-09LL',durationSeconds:900,distanceMeters:500,geometry:{type:'MultiLineString',coordinates:[[[120,30],[120.002,30],[120.002,30.001]],[[120.003,30.001],[120.004,30.002]]]}};
 assert.equal(selectDrawableRoute([route],origin,'medical'),route);assert.equal(selectDrawableRoute([route],origin,'medical','missing'),null);assert.equal(selectDrawableRoute([{...route,durationSeconds:901}],origin,'medical'),null);assert.equal(selectDrawableRoute([route],{...origin,uid:'new'},'medical'),null);assert.equal(selectDrawableRoute([{...route,geometry:null}],origin,'medical'),null);
});
for(const earlyStyle of[true,false])test('required custom style starts before tiles and handles event order '+earlyStyle,()=>{
 const handlers={},calls=[],timers=new Map();let n=0;const map={addEventListener:(name,fn)=>handlers[name]=fn,setMapStyleV2:x=>calls.push(x)};
 const runtime=createMapThemeRuntime(map,{styleIds:{light:'existing',dark:'old'},waitForBasemap:false,fallbackToDefault:false,setTimer:fn=>{timers.set(++n,fn);return n;},clearTimer:id=>timers.delete(id)});
 runtime.select('light');assert.deepEqual(calls,[{styleId:'existing'}]);handlers[earlyStyle?'style_loaded':'tilesloaded']();assert.notEqual(runtime.getState().status,'applied');handlers[earlyStyle?'tilesloaded':'style_loaded']();assert.equal(runtime.getState().status,'applied');assert.equal(calls.length,1);assert.equal(timers.size,0);runtime.dispose();
});
test('custom style timeout retains placeholder and only manual retry starts another request; no default basemap',()=>{
 const handlers={},calls=[],timers=new Map();let n=0;const runtime=createMapThemeRuntime({addEventListener:(k,v)=>handlers[k]=v,setMapStyleV2:x=>calls.push(x)},{styleIds:{light:'existing',dark:'old'},waitForBasemap:false,fallbackToDefault:false,setTimer:(fn,ms)=>{timers.set(++n,{fn,ms});return n;},clearTimer:id=>timers.delete(id)});
 runtime.select('light');handlers.tilesloaded();[...timers.values()].find(t=>t.ms===30000).fn();assert.equal(runtime.getState().status,'style_error');assert.equal(calls.length,1);assert.ok(!calls.includes('default'));runtime.retry();assert.equal(calls.length,2);runtime.dispose();
});
test('same pending Baidu request shares one network operation and returns independent response objects',async()=>{
 let calls=0;const client=createBaiduClient({mode:'mock',fetchImpl:async()=>{calls++;await new Promise(r=>setTimeout(r,15));return{ok:true,json:async()=>({status:0,results:[]})};}}),options={service:'place',path:'/place/v3/around',params:{query:'中学'},cacheTtlMs:1000};
 const[a,b]=await Promise.all([client.requestJson(options),client.requestJson(options)]);assert.equal(calls,1);a.data.results.push('changed');assert.deepEqual(b.data.results,[]);
});
test('ordered batches cap in-flight operations at two and preserve cancellation and output order',async()=>{
 let active=0,peak=0;const values=await orderedBatches([1,2,3,4],async n=>{peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,5-n));active--;return n;},{concurrency:2});assert.equal(peak,2);assert.deepEqual(values,[1,2,3,4]);const c=new AbortController();c.abort();await assert.rejects(orderedBatches([1],()=>assert.fail(),{signal:c.signal}));
});
test('pipelined range + Place retains all budgets, 900/901 evidence and scores at unchanged per-service concurrency',async()=>{
 const before=await runBenchmark(false),after=await runBenchmark(true);assert.equal(after.signature,before.signature);assert.deepEqual(after.calls,before.calls);assert.deepEqual(after.peak,{place:1,route:1});assert.equal(after.calls.route,25);assert.ok(after.elapsedMs<before.elapsedMs*.9);
});
