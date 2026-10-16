import test from 'node:test';import assert from 'node:assert/strict';
import{publicFacilityCategoryTree,classifySubtypeCandidate}from'../server/facility-categories.mjs';
import{createFacilityJobManager}from'../server/facility-job.mjs';
import{createBaiduRouteProvider}from'../server/baidu-route.mjs';
import{createBaiduWeatherProvider}from'../server/baidu-weather.mjs';
import{buildFacilityDisplay,fivePointScore}from'../server/facility-display.mjs';
import{reportPresentation,radarSvg}from'../web/report-view.js';
import{retinaSvg}from'../web/retina-icons.js';
import{createStaticFacilityRoutes}from'../web/static-facility-routes.js';
const origin={id:'offline-origin',source:'map_click',uid:null,name:'离线起点',location:{lng:120,lat:30}},tree=publicFacilityCategoryTree('facility-categories-v6');
const ring=[[119.99,29.99],[120.01,29.99],[120.008,30.01],[119.99,30.01],[119.99,29.99]];
const range={geometrySource:'baidu_isochrone',geometryStatus:'available',center:origin.location,mode:'walking',thresholdSeconds:900,coordinateSystem:'BD-09LL',geojson:{type:'FeatureCollection',features:[{type:'Feature',properties:{geometrySource:'baidu_isochrone',mode:'walking',thresholdSeconds:900,coordinateSystem:'BD-09LL'},geometry:{type:'Polygon',coordinates:[ring]}}]}};
export async function makeV6Job({official=true}={}){
 const calls={place:0,cost:0,detail:0,order:[],capture:[]};let n=0;
 const manager=createFacilityJobManager({officialEnabled:official,officialEntitlementVerified:official,officialRequestLimit:official?1:0,
  officialProvider:{getIsochrone:async()=>{calls.order.push('range');return range;}},
  placeProvider:{searchAround:async({subtypeId})=>{calls.place++;calls.order.push('place');const sub=tree.categories.flatMap(g=>g.subtypes).find(s=>s.id===subtypeId);
   return {status:'complete',searchComplete:true,requestStats:{logicalRequests:1},candidates:[0,1].map(i=>({uid:subtypeId+'-'+i,name:sub.searchQueries[0]+i,rawCategory:sub.rawCategoryHints[0],location:{lng:120+.0002*(++n),lat:30+.0003+i*.0004}}))};}},
  routeProvider:{route:async(from,to,options)=>{options.includeGeometry?calls.detail++:calls.cost++;calls.capture.push(options.captureGeometry);
   return {routeStatus:'ok',source:'explicit_offline_fixture',mode:'walking',coordinateSystem:'BD-09LL',durationSeconds:options.destinationUid==='hospital-0'?900:options.destinationUid==='hospital-1'?901:500,distanceMeters:700,
    requestedOrigin:{location:from,uid:options.originUid??null},requestedDestination:{location:to,uid:options.destinationUid},
    geometry:{type:'LineString',coordinates:[[from.lng,from.lat],[to.lng,from.lat],[to.lng,to.lat]]},geometryStatus:'provider_path',retrievedAt:'2026-10-09T00:00:00Z'};
  }}});
 const created=manager.create({version:6,categoryMappingVersion:tree.version,origin,categoryIds:tree.categories.map(g=>g.id),mode:'walking',minutes:15,priorities:{},includeReachableNetwork:true,routeScope:'all_candidates'});
 let job;for(let i=0;i<200;i++){job=manager.get(created.analysisId);if(['complete','partial','failed'].includes(job.status))break;await new Promise(r=>setTimeout(r,1));}
 assert.notEqual(job.status,'failed');return{job,calls,manager};
}
test('v6 has 17 children and only hospital/pharmacy; historical 25/23/19 trees remain immutable',()=>{
 assert.deepEqual(tree.categories.map(g=>g.subtypes.length),[3,2,4,2,2,4]);assert.deepEqual(tree.categories[1].subtypes.map(s=>s.id),['hospital','pharmacy']);
 assert.equal(classifySubtypeCandidate({categoryMappingVersion:tree.version,subtypeId:'hospital',name:'医院社区卫生服务站'}).candidateStatus,'excluded_by_rule');
 for(const[v,count]of [[3,25],[4,23],[5,19]])assert.equal(publicFacilityCategoryTree('facility-categories-v'+v).categories.flatMap(g=>g.subtypes).length,count);
});
test('v6 publishes all 34 circle candidates within the existing 25 cost budget; 901 is visible but remains unreachable',async()=>{
 const{job,calls,manager}=await makeV6Job();assert.equal(calls.order[0],'range');assert.equal(calls.place,17);assert.equal(calls.cost,25);assert.equal(calls.detail,0);assert.ok(calls.capture.every(Boolean));
 assert.equal(job.display.facilities.length,34);assert.equal(job.display.totalMapFacilities,34);assert.equal(job.display.rangeAvailable,true);assert.equal(job.display.complete,false);
 const hospital0=job.display.facilities.find(p=>p.uid==='hospital-0'),hospital1=job.display.facilities.find(p=>p.uid==='hospital-1');
 assert.equal(hospital0.displayStatus,'reachable');assert.equal(hospital0.drawable,true);assert.equal(hospital1.displayStatus,'over_threshold');assert.equal(hospital1.drawable,true);
 assert.ok(job.display.facilities.some(p=>p.statusText==='暂无步行数据'));assert.ok(job.display.routes.some(r=>r.durationSeconds>900&&r.reachabilityState==='over_threshold'));assert.equal(job.display.totalReachable,job.display.facilities.filter(p=>p.displayStatus==='reachable').length);assert.equal(job.scoreDisplay.scale,5);
 const before={...calls};manager.get(job.analysisId);manager.report(job.analysisId);assert.equal(calls.cost,before.cost);assert.equal(calls.place,before.place);
});
test('no official range never promotes proxy grids or unprocessed candidates to a circle; five point presentation keeps score evidence',async()=>{
 const{job}=await makeV6Job({official:false});assert.equal(job.display.rangeAvailable,false);assert.equal(job.display.continuousRangeAvailable,false);
 assert.equal(job.display.totalMapFacilities,job.display.totalReachable);assert.ok(job.display.facilities.some(p=>!p.onMap));
 const view=reportPresentation(job,tree,{scale:5,simple:true});assert.equal(view.counts.total,17);assert.equal(view.overall.text,'5');assert.equal(job.score.S_low,100);
 assert.equal(fivePointScore({...job.score,S_low:40,S_high:80,isExact:false}).low,2);assert.equal(fivePointScore({...job.score,S_low:40,S_high:80,isExact:false}).high,4);
 assert.equal((radarSvg(view.groups).match(/class="radar-axis-dot"/g)??[]).length,6);
});
test('a real reachable endpoint outside the official boundary stays visible with an explicit disagreement, without changing scores',async()=>{
 const{job}=await makeV6Job();const copy=structuredClone(job),before=JSON.stringify(copy.score);
 copy.geojson.features[0].geometry.coordinates=[[[119.9999,29.9999],[120.0001,29.9999],[120.0001,30.0001],[119.9999,30.0001],[119.9999,29.9999]]];
 const display=buildFacilityDisplay(copy);assert.ok(display.rangeRouteDisagreements>0);assert.ok(display.facilities.some(p=>p.rangeRouteDisagreement&&p.onMap&&p.drawable));assert.match(display.note,/存在差异/);assert.equal(JSON.stringify(copy.score),before);
});
test('a single lite cost request can retain real steps; later geometry reads reuse it without a second call',async()=>{
 let calls=0;const provider=createBaiduRouteProvider({client:{requestJson:async opts=>{calls++;assert.equal(opts.params.steps_info,'1');return{data:{result:{routes:[{duration:900,distance:800,steps:[{path:'120,30;120.001,30;120.001,30.001'}]}]}},meta:{retrievedAt:'2026-10-09T00:00:00Z'}};}}});
 const destination={lng:120.001,lat:30.001};const cost=await provider.route(origin.location,destination,{mode:'walking',originUid:null,destinationUid:'school',captureGeometry:true});
 assert.equal(cost.geometry.type,'LineString');const geometry=await provider.route(origin.location,destination,{mode:'walking',originUid:null,destinationUid:'school',includeGeometry:true});
 assert.equal(calls,1);assert.equal(geometry.cached,true);assert.deepEqual(geometry.geometry,cost.geometry);
});
test('weather uses BD09 lon/lat and now, keeps 0C, caches/coalesces and never invents weather on quota or permission errors',async()=>{
 let calls=0,clock=10000;const provider=createBaiduWeatherProvider({now:()=>clock,requestLimit:1,client:{requestJson:async opts=>{calls++;assert.equal(opts.params.coordtype,'bd09ll');assert.equal(opts.params.data_type,'now');return{data:{result:{now:{temp:0,text:'晴'},location:{city:'离线测试'}}},meta:{retrievedAt:'2026-10-09T00:00:00Z'}};}}});
 const[w1,w2]=await Promise.all([provider.query(origin.location),provider.query(origin.location)]);assert.equal(w1.temperature,0);assert.equal(w2.temperature,0);assert.equal(calls,1);
 await provider.query(origin.location);assert.equal(calls,1);clock+=1000;assert.equal((await provider.query({lng:121,lat:30})).reasonCode,'weather_budget_exhausted');
 const denied=createBaiduWeatherProvider({client:{requestJson:async()=>{throw Object.assign(new Error('denied'),{code:'permission_denied'});}}});assert.equal((await denied.query(origin.location)).status,'unavailable');
});
test('retina SVG raises source pixel dimensions, preserves its viewBox and does not change logical anchors',()=>{
 const svg='<svg width="32" height="40" viewBox="0 0 30 38"></svg>';const high=retinaSvg(svg,3);assert.match(high,/width="96" height="120"/);assert.match(high,/viewBox="0 0 30 38"/);
});
test('static route filters reuse data and reject different origin, 901 seconds and malformed geometry with no particle renderer',()=>{
 let additions=0;const overlays=[];class Polyline{constructor(points,opts){this.points=points;this.opts=opts;}addEventListener(){}}class Point{constructor(lng,lat){this.lng=lng;this.lat=lat;}}
 const renderer=createStaticFacilityRoutes({map:{addOverlay(o){additions++;overlays.push(o);},removeOverlay(o){overlays.splice(overlays.indexOf(o),1);}},B:{Polyline,Point},getOrigin:()=>origin});
 const g=[{id:'education',color:'#649eff'},{id:'medical',color:'#28d9f5'}],r={mode:'walking',coordinateSystem:'BD-09LL',origin,originUid:null,durationSeconds:900,identityKey:'one',categoryIds:['education'],geometry:{type:'LineString',coordinates:[[120,30],[120.001,30],[120.001,30.001]]}};
 renderer.set([r,{...r,identityKey:'bad',durationSeconds:901}],g);assert.equal(overlays.length,1);renderer.set([r,{...r,identityKey:'bad',durationSeconds:901}],g);assert.equal(additions,1);
 renderer.set([r],g,'medical');assert.equal(overlays.length,0);renderer.set([{...r,origin:{...origin,uid:'other'}}],g);assert.equal(overlays.length,0);
});
