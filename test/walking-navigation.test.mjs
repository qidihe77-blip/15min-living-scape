import test from'node:test';import assert from'node:assert/strict';
import{parseWalkingNavigation,navigationOnRoute}from'../server/walking-navigation-steps.mjs';
import{createWalkingNavigationManager}from'../server/walking-navigation.mjs';
import{layoutWalkingNodes,walkingNodeSvg}from'../web/walking-navigation.js';
import{createRouteClickGate,routeClickCandidates}from'../web/route-click.js';
const origin={uid:'origin',location:{lng:120,lat:30}},geometry={type:'LineString',coordinates:[[120,30],[120.001,30],[120.002,30]]};
const steps=[{instruction:'通过人行横道，走30米',start_location:{lng:120.001,lat:30},end_location:{lng:120.002,lat:30},distance:30,path:'120.001,30;120.002,30'}];
function job(){return{analysisId:'fa-test',status:'complete',analysis:{origin},score:{S_low:76},display:{facilities:[{identityKey:'uid:poi',uid:'poi',routeEvidence:{identityKey:'uid:poi',evidenceId:'saved',mode:'walking',routeStatus:'ok',coordinateSystem:'BD-09LL',origin:origin.location,originUid:origin.uid,destination:{lng:120.002,lat:30},destinationUid:'poi',requestedOrigin:origin,requestedDestination:{location:{lng:120.002,lat:30},uid:'poi'},distanceMeters:200,durationSeconds:160,geometry}}]}};}
function provider(reply){let calls=0;return{calls:()=>calls,route:async(a,b,o)=>{calls++;assert.equal(o.includeGeometry,true);return reply??{routeStatus:'ok',requestedOrigin:a,requestedDestination:b,navigation:parseWalkingNavigation(steps),retrievedAt:'2026-10-16T00:00:00Z'};}};}
test('only explicit navigation text creates nodes; types, step coordinates, HTML removal and duplicate instructions are supported',()=>{
 const n=parseWalkingNavigation([...steps,steps[0],{instructions:'沿天桥通过',stepOriginLocation:{lng:120.002,lat:30}},{instruction:'进入地下通道',start_location:{lng:120.003,lat:30}},{instruction:'过马路',path:'120.004,30;120.005,30'},{instruction:'<b>右转</b>后直行',start_location:{lng:120,lat:30}},{instruction:'前方红绿灯',start_location:{lng:120,lat:30}}]);
 assert.deepEqual(n.nodes.map(n=>n.kind),['crosswalk','overpass','underpass','street_crossing']);assert.equal(n.nodes[0].stepDistanceMeters,30);assert.equal(n.nodes[0].coordinateSystem,'BD-09LL');assert.equal(n.nodes[3].location.lng,120.004);
 const later=parseWalkingNavigation([{instruction:'向前走100米，通过天桥',start_location:{lng:120,lat:30},end_location:{lng:120.001,lat:30}}]);assert.equal(later.nodes[0].location.lng,120.001);
});
test('no route bends, traffic lights, street names, negative instructions or missing coordinates manufacture nodes',()=>{
 assert.equal(parseWalkingNavigation(null).status,'missing_steps');assert.equal(parseWalkingNavigation([{path:'120,30;120.1,30.1'}]).status,'missing_instructions');
 assert.deepEqual(parseWalkingNavigation([{instruction:'经过天桥路直行',start_location:origin.location},{instruction:'不要走地下通道',start_location:origin.location},{instruction:'前方红绿灯',start_location:origin.location},{instruction:'通过天桥'}]).nodes,[]);
 const n=navigationOnRoute(parseWalkingNavigation([{instruction:'通过天桥',start_location:{lng:121,lat:31}}]),geometry);assert.equal(n.status,'route_mismatch');assert.equal(n.nodes.length,0);
});
test('saved complete instructions are reused without requests and never modify the original score or geometry',async()=>{
 const j=job();j.display.facilities[0].routeEvidence.navigation=parseWalkingNavigation(steps);const before=JSON.stringify(j),p=provider(),m=createWalkingNavigationManager({provider:p}),r=await m.get(j,{identityKey:'uid:poi',evidenceId:'saved'});assert.equal(r.nodes.length,1);assert.equal(r.source,'saved_walking_steps');assert.equal(p.calls(),0);assert.equal(JSON.stringify(j),before);
});
test('same route requests coalesce; cache survives manager replacement and separates changed geometry/evidence',async()=>{
 const j=job(),p=provider(),data=new Map(),store={read:async k=>data.get(k),write:async(k,v)=>data.set(k,v)},m=createWalkingNavigationManager({provider:p,store});const before=JSON.stringify(j);
 const [a,b]=await Promise.all([m.get(j,{identityKey:'uid:poi'}),m.get(j,{identityKey:'uid:poi'})]);assert.deepEqual(a,b);assert.equal(p.calls(),1);assert.equal((await m.get(j,{identityKey:'uid:poi'})).cached,true);const next=createWalkingNavigationManager({provider:p,store});assert.equal((await next.get(j,{identityKey:'uid:poi'})).cached,true);assert.equal(p.calls(),1);assert.equal(JSON.stringify(j),before);
 await assert.rejects(m.get(j,{identityKey:'uid:poi',evidenceId:'outdated'}),/证据已更新/);j.display.facilities[0].routeEvidence.evidenceId='new';await next.get(j,{identityKey:'uid:poi'});assert.equal(p.calls(),2);
});
test('missing steps and failures stay empty, cached and bounded; wrong origin is rejected before requesting',async()=>{
 for(const reply of[{routeStatus:'permission_denied'},{routeStatus:'ok',requestedOrigin:origin,requestedDestination:{location:{lng:120.002,lat:30}},navigation:parseWalkingNavigation([])}]){const p=provider(reply),m=createWalkingNavigationManager({provider:p}),r=await m.get(job(),{identityKey:'uid:poi'});assert.equal(r.nodes.length,0);await m.get(job(),{identityKey:'uid:poi'});assert.equal(p.calls(),1);}
 const p=provider(),m=createWalkingNavigationManager({provider:p,requestLimit:0});assert.equal((await m.get(job(),{identityKey:'uid:poi'})).reasonCode,'navigation_request_limit');assert.equal(p.calls(),0);
 const j=job();j.display.facilities[0].routeEvidence.origin={lng:121,lat:30};await assert.rejects(m.get(j,{identityKey:'uid:poi'}),/匹配/);assert.equal(p.calls(),0);
});
test('navigation screen placement avoids collisions without changing geographic anchors',()=>{
 const points=[{id:'a',x:150,y:140,location:{lng:120,lat:30}},{id:'b',x:152,y:140,location:{lng:120.001,lat:30}}],before=JSON.stringify(points),placed=layoutWalkingNodes(points,{width:500,height:400});assert.equal(placed.length,2);assert.equal(JSON.stringify(points),before);assert.ok(Math.abs(placed[0].left-placed[1].left)>=32||Math.abs(placed[0].top-placed[1].top)>=32);assert.equal(layoutWalkingNodes([{x:1,y:1}],{width:100,height:100,obstacles:[{left:0,top:0,width:100,height:100}]}).length,0);assert.match(walkingNodeSvg('overpass'),/path/);assert.doesNotMatch(walkingNodeSvg('crosswalk'),/image|href|script/);
});
test('one pointer gesture hitting multiple route layers selects one focused route; pending and late duplicate hits cannot request again',()=>{
 const queued=new Map(),clicked=[];let id=0,clock=0;const g=createRouteClickGate({onClick:r=>clicked.push(r.identityKey),now:()=>clock,schedule:f=>(queued.set(++id,f),id),cancel:id=>queued.delete(id)}),a={identityKey:'a'},b={identityKey:'b',focused:true};g.hit(a);g.hit(b);g.hit(b);assert.equal(queued.size,1);queued.get(id)();assert.deepEqual(clicked,['b']);g.hit(a);assert.equal(clicked.length,1);clock=100;g.hit(a);g.clear();assert.equal(queued.has(id),false);clock=200;g.hit(a);queued.get(id)();assert.deepEqual(clicked,['b','a']);
 g.beginGesture();g.hit(b);queued.get(id)();clock+=500;g.hit(b);assert.equal(clicked.length,3);g.beginGesture();g.hit(a);queued.get(id)();assert.equal(clicked.length,4);
});
test('route hit testing uses projected real segments and never joins disconnected pieces',()=>{const routes=[{identityKey:'a',pieces:[{pixels:[{x:0,y:0},{x:100,y:0}]},{pixels:[{x:100,y:100},{x:200,y:100}]}]}];assert.equal(routeClickCandidates(routes,50,5).length,1);assert.equal(routeClickCandidates(routes,100,50).length,0);assert.equal(routeClickCandidates(routes,20,30).length,0);});
