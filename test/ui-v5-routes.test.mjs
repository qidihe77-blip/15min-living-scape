import test from 'node:test';import assert from 'node:assert/strict';
import {categoryRouteDescriptors,createCategoryRouteController} from '../web/representative-route-view.js';
import {projectedLine,pointAlongLine} from '../web/route-flow.js';
import {publicFacilityCategoryTree,classifySubtypeCandidate} from '../server/facility-categories.mjs';
import {createFacilityJobManager} from '../server/facility-job.mjs';
import {reportPresentation,subtypeChartColumns} from '../web/report-view.js';
const origin={id:'point',source:'map_click',uid:null,name:'起点',location:{lng:120,lat:30}};
const cost={evidenceStatus:'verified_cost',coordinateSystem:'BD-09LL',durationSeconds:900,distanceMeters:500,
 origin,uid:'school',destinationUid:'school',identityKey:'uid:school',subtypeId:'secondary_school',name:'中学',categoryId:'education',label:'教育'};
const geometry={type:'LineString',coordinates:[[120,30],[120.001,30],[120.001,30.001]]};
const job=(route=cost)=>({analysisId:'test-job',categoryMappingVersion:'facility-categories-v5',score:{evidenceFingerprint:'fingerprint'},
 analysis:{origin,categories:[{categoryId:'education',label:'教育',color:'#649eff',nearestReachableAnySubtype:null}]},representativeRoutes:[route]});
test('v5 contains confirmed 19 children, sports merge, entertainment searches and exactly two eldercare types; historical trees stay unchanged',()=>{
 const tree=publicFacilityCategoryTree('facility-categories-v5');assert.equal(tree.requestVersion,5);
 assert.deepEqual(tree.categories.map(g=>g.subtypes.length),[3,4,4,2,2,4]);
 assert.deepEqual(tree.categories[4].subtypes.map(s=>s.label),['养老院','疗养院']);
 assert.deepEqual(tree.categories[5].subtypes.map(s=>s.label),['公园','广场','娱乐','运动']);
 for(const name of ['市民体育场','社区健身房'])assert.equal(classifySubtypeCandidate({categoryMappingVersion:tree.version,subtypeId:'sports',name}).candidateStatus,'confirmed_by_rule');
 for(const name of ['电影院','欢乐KTV','桌游空间','休闲足浴'])assert.equal(classifySubtypeCandidate({categoryMappingVersion:tree.version,subtypeId:'entertainment',name}).candidateStatus,'confirmed_by_rule');
 assert.equal(publicFacilityCategoryTree('facility-categories-v4').categories.flatMap(g=>g.subtypes).length,23);
 assert.equal(publicFacilityCategoryTree('facility-categories-v3').categories.flatMap(g=>g.subtypes).length,25);
});
test('particles follow the actual bent polyline in origin-to-destination order without a diagonal or across disconnected parts',()=>{
 const line=projectedLine([[0,0],[10,0],[10,10]],p=>({x:p[0],y:p[1]}));
 assert.deepEqual(pointAlongLine(line,.25),{x:5,y:0});assert.deepEqual(pointAlongLine(line,.75),{x:10,y:5});
 assert.equal(projectedLine([[0,0],[10,10]],()=>({x:NaN,y:0})),null);
});
test('route view rejects unknown costs, 901 seconds, wrong start or UID, and never generates missing geometry',()=>{
 assert.equal(categoryRouteDescriptors(job({...cost,geometry}))[0].drawable,true);
 for(const r of [{...cost,durationSeconds:901,geometry},{...cost,evidenceStatus:'unknown',geometry},
  {...cost,origin:{...origin,location:{lng:121,lat:30}},geometry},{...cost,origin:{...origin,uid:'other'},geometry}])assert.equal(categoryRouteDescriptors(job(r))[0].drawable,false);
 assert.deepEqual(categoryRouteDescriptors(job())[0].lines,[]);
});
test('existing six-route controls toggle and animate from evidence without making route requests',async()=>{
 let calls=0;const controller=createCategoryRouteController({requestDetail:async()=>{calls++;},updateJob:()=>{}});
 controller.bind(job({...cost,geometry}));await controller.toggle('education');assert.equal(controller.rows()[0].visible,false);
 await controller.toggle('education');controller.setGlobalVisible(false);assert.equal(controller.rows()[0].visible,false);
 controller.setGlobalVisible(true);assert.equal(controller.rows()[0].visible,true);assert.equal(calls,0);
});
test('missing geometry uses one existing-budget detail request and origin changes discard late results',async()=>{
 let resolve,calls=0,updates=0;
 const controller=createCategoryRouteController({requestDetail:()=>{calls++;return new Promise(r=>resolve=r);},updateJob:()=>updates++});
 controller.bind(job());const request=controller.toggle('education');const shifted=job();shifted.analysisId='new-job';shifted.analysis.origin={...origin,location:{lng:121,lat:30}};
 controller.bind(shifted);resolve({routeStatus:'ok',job:job({...cost,geometry})});await request;
 assert.equal(updates,0);assert.equal(calls,1);assert.equal(controller.rows()[0].drawable,false);
});
test('detail budget failure remains non-drawable and repeated UI clicks do not trigger repeated requests',async()=>{
 let calls=0;const controller=createCategoryRouteController({requestDetail:async()=>{calls++;return {routeStatus:'route_detail_limit_reached'};},updateJob:()=>{}});
 controller.bind(job());await controller.toggle('education');await controller.toggle('education');
 assert.equal(calls,1);assert.equal(controller.rows()[0].reasonCode,'route_detail_limit_reached');assert.equal(controller.rows()[0].drawable,false);
});
test('v5 pipeline keeps formulas/900s/1km evidence semantics with 19 dynamic report bars and six representative slots',async()=>{
 const names={kindergarten:'幼儿园',pharmacy:'药店',market:'菜市场',bus_stop:'公交站',residential_eldercare:'养老院',sports:'健身房'};
 const manager=createFacilityJobManager({placeProvider:{searchAround:async({subtypeId})=>({status:'complete',searchComplete:true,candidates:names[subtypeId]
  ?[{uid:subtypeId,name:names[subtypeId],location:{lng:120.001,lat:30}}]:[],requestStats:{logicalRequests:1}})},routeProvider:{route:async(from,to,o)=>({
   routeStatus:'ok',mode:'walking',coordinateSystem:'BD-09LL',durationSeconds:900,distanceMeters:1000,
   requestedOrigin:{location:from,uid:o.originUid??null},requestedDestination:{location:to,uid:o.destinationUid??null},geometry:o.includeGeometry?geometry:null})}});
 const tree=publicFacilityCategoryTree('facility-categories-v5'),created=manager.create({version:5,categoryMappingVersion:tree.version,origin,
  categoryIds:tree.categories.map(g=>g.id),mode:'walking',minutes:15,includeReachableNetwork:true});
 let result;for(let i=0;i<100;i++){result=manager.get(created.analysisId);if(!['queued','running'].includes(result.status))break;await new Promise(r=>setTimeout(r,2));}
 assert.equal(result.status,'complete');assert.equal(result.representativeRoutes.length,6);assert.equal(result.requestStats.placeRequests,19);
 assert.equal(result.score.formulaVersion,'six-group-subtype-access-v1');assert.equal(result.score.categories[5].totalSubtypeCount,4);
 assert.equal(manager.report(created.analysisId).counts.subtypeCount,19);assert.equal(manager.report(created.analysisId).reportVersion,'facility-report-v5');
 const view=reportPresentation(result,tree);assert.equal(view.counts.total,19);assert.equal(subtypeChartColumns(view.groups).flatMap(g=>g.columns).length,19);
 assert.equal(result.serviceGaps.specialties.find(s=>s.subtypeId==='pharmacy').walking_1km_gap.status,'present');
});
