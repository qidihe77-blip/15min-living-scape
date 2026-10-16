import test from'node:test';import assert from'node:assert/strict';import{priorityGroups,movePriority,p123Weights,p123Default}from'../web/p123-horizontal.js';import{specialtyStatsRows,diagnosticCards}from'../web/specialty-diagnostics.js';import{enlargeChartText}from'../web/chart-text-scale.js';
const ids=['a','b','c','d','e','f'],three={order:ids,levels:{a:1,b:1,c:2,d:2,e:3,f:3}};
test('internal insertion reorders tied members; three occupied grades no longer block a valid drop',()=>{
 const before=structuredClone(three),r=movePriority(three,{ids:['e'],target:'d',mode:'before'});assert.equal(r.changed,true);assert.deepEqual(r.model.order,['a','b','c','e','d','f']);assert.equal(r.model.levels.e,2);assert.equal(priorityGroups(r.model).length,3);assert.deepEqual(three,before);
 const within=movePriority(three,{ids:['a'],target:'b',mode:'after'});assert.deepEqual(within.model.order,['b','a','c','d','e','f']);assert.deepEqual(within.model.levels,three.levels);
});
test('group boundaries choose existing adjacent grades without creating P4 or relabelling other members',()=>{
 const r=movePriority(three,{ids:['a'],target:'c',mode:'before'});assert.equal(r.changed,true);assert.deepEqual(r.model.order,['b','a','c','d','e','f']);assert.deepEqual(r.model.levels,three.levels);
 const higher=movePriority(three,{ids:['f'],target:'a',mode:'before'});assert.equal(higher.model.levels.f,1);assert.deepEqual(higher.model.order,['f','a','b','c','d','e']);assert.ok(Object.values(higher.model.levels).every(n=>n>=1&&n<=3));
});
test('outer edges can create an available P1 or P3; magnets and whole groups keep raw 3:2:1 weights',()=>{
 let m=p123Default(ids);m=movePriority(m,{ids:['a'],target:'b',mode:'before'}).model;assert.equal(m.levels.a,1);m=movePriority(m,{ids:['b'],target:'f',mode:'after'}).model;assert.equal(m.levels.b,3);m=movePriority(m,{ids:['c'],target:'a',mode:'tie'}).model;assert.equal(m.levels.c,1);
 const moved=movePriority(m,{ids:['a','c'],target:'b',mode:'after'}).model;assert.deepEqual(priorityGroups(moved).at(-1).ids,['a','c']);assert.equal(new Set(moved.order).size,6);assert.deepEqual(new Set(Object.values(p123Weights(moved,ids))),new Set([1,2,3]));
});
const origin={location:{lng:120,lat:30},uid:null},tree={specialtySubtypeIds:['pharmacy'],categories:[{id:'medical',subtypes:[{id:'pharmacy',label:'药店'}]}]},route=(id,distance)=>({identityKey:'uid:'+id,facilityUid:id,destinationUid:id,origin:origin.location,originUid:null,mode:'walking',routeStatus:'ok',coordinateSystem:'BD-09LL',distanceMeters:distance,durationSeconds:distance/1.1,name:id,location:{lng:120.001,lat:30}}),poi=(id,distance,subtypeIds=['pharmacy'])=>({uid:id,identityKey:'uid:'+id,subtypeIds,location:{lng:120.001,lat:30},name:id,routeEvidence:route(id,distance)});
test('specialty quantity counts unique confirmed facilities at the real 1000m boundary, keeps raw time and unknown state',()=>{
 const job={analysis:{origin}},rows=specialtyStatsRows(job,tree,{},[poi('a',200),poi('a',200),poi('b',1000),poi('over',1001),poi('pending',100,[])]);assert.equal(rows[0].facilityCount,2);assert.equal(rows[0].nearestWithinScope.distanceMeters,200);assert.equal(rows[0].nearestWithinScope.durationSeconds,200/1.1);assert.equal(rows[0].status,'unknown');
 const html=diagnosticCards(rows);assert.match(html,/2\.5分钟/);assert.match(html,/data-specialty-count="pharmacy">2/);assert.match(html,/待核验/);assert.doesNotMatch(html,/diagnosis-metric|diagnosis-action/);
 const none=diagnosticCards(specialtyStatsRows(job,tree));assert.match(none,/is-zero/);assert.match(none,/data-specialty-count="pharmacy">0/);assert.match(none,/待核验/);assert.doesNotMatch(none,/1公里内无服务/);
});
test('chart typography adds two pixels without changing score/count data or render callbacks',()=>{const fn=()=>1,o={textStyle:{fontSize:12},series:[{data:[81.944444,98],renderItem:fn}],graphic:[{style:{fontSize:30}}]},next=enlargeChartText(o);assert.equal(next.textStyle.fontSize,14);assert.equal(next.graphic[0].style.fontSize,32);assert.deepEqual(next.series[0].data,o.series[0].data);assert.strictEqual(next.series[0].renderItem,fn);assert.equal(o.textStyle.fontSize,12);});
