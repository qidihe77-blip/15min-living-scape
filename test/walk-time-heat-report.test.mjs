import test from'node:test';import assert from'node:assert/strict';
import{timeHeatWeight,walkingTimeHeatData}from'../web/walk-time-heat.js';
import{boundPoiScore,categoryCountsHtml,subtypeAccessHtml,roundedScoreRing}from'../web/report-accessibility.js';
const origin={uid:'start',location:{lng:120,lat:30}},poly=[[119.99,29.99],[120.01,29.99],[120.01,30.01],[119.99,30.01],[119.99,29.99]];
const job={analysis:{origin},geojson:{features:[{properties:{featureType:'sampled_boundary'},geometry:{type:'Polygon',coordinates:[poly]}}]}};
const poi=(uid,seconds,category='education')=>({uid,identityKey:'uid:'+uid,name:'测试设施',location:{lng:120.001,lat:30},subtypeIds:['primary_school'],memberships:[category],categoryIds:[category],routeEvidence:{mode:'walking',routeStatus:'ok',coordinateSystem:'BD-09LL',origin,originUid:'start',destinationUid:uid,durationSeconds:seconds,distanceMeters:seconds*80/60}});
test('walking-time weight is monotonically inverse, 900s zero, 901s and unknown excluded',()=>{
 assert.deepEqual([0,180,450,900,901,NaN,-1].map(timeHeatWeight),[1,.8,.5,0,null,null,null]);
});
test('category heat follows bound costs only and UID/coincident points never inflate heat density',()=>{
 const a=poi('a',180),b=poi('b',450,'medical'),before=JSON.stringify([a,b]);
 const all=walkingTimeHeatData(job,[a,a,b]);assert.equal(all.pointCount,1);assert.equal(all.data[0].properties.count,80);
 assert.equal(walkingTimeHeatData(job,[a,b],'medical').data[0].properties.count,50);assert.equal(walkingTimeHeatData(job,[a,b],'eldercare').status,'unavailable');assert.equal(JSON.stringify([a,b]),before);
 const stale=poi('s',120);stale.routeEvidence.originUid='other';assert.equal(walkingTimeHeatData(job,[stale]).pointCount,0);
 const outside=poi('o',120);outside.location={lng:121,lat:30};assert.equal(walkingTimeHeatData(job,[outside]).pointCount,0);
});
test('global samples require explicit matching origin and original cost; model time remains separate from provider seconds',()=>{
 const s={mode:'walking',routeStatus:'ok',coordinateSystem:'BD-09LL',requestedOrigin:origin,requestedDestination:{location:{lng:120.002,lat:30}},durationSeconds:901,distanceMeters:600,walkingModelId:'walking80-v1',modelDurationSeconds:450};
 const j={...job,heatSamples:[s]};assert.equal(walkingTimeHeatData(j,[]).data[0].properties.count,50);assert.equal(walkingTimeHeatData(j,[],'education').pointCount,0);
 assert.equal(walkingTimeHeatData({...j,heatSamples:[{...s,requestedOrigin:{...origin,uid:'wrong'}}]},[]).pointCount,0);
});
test('POI display score keeps original existence semantics and unknown is not zero',()=>{
 assert.equal(boundPoiScore(poi('a',900),origin).score,5);assert.equal(boundPoiScore(poi('b',901),origin).score,0);assert.equal(boundPoiScore({...poi('c',5),routeEvidence:null},origin).score,null);
 const r=poi('stale',50);r.routeEvidence.originUid='old';assert.equal(boundPoiScore(r,origin).score,null);
});
test('category count has no accordion, subtype disclosure preserves unknown and renders time/score from existing rows',()=>{
 const groups=[{id:'education',label:'教育',color:'#369cf8',circlePoiCount:2,subtypes:[{id:'primary_school',label:'小学',status:'reachable',statusText:'可达'},{id:'secondary_school',label:'中学',status:'unknown',statusText:'暂无步行数据'}]}];
 const count=categoryCountsHtml(groups,()=>'<i></i>');assert.doesNotMatch(count,/<details/);assert.match(count,/data-count-category="education"/);
 const rows=[poi('school',180),{...poi('unknown',10),routeEvidence:null}],html=subtypeAccessHtml(groups,rows,origin);assert.equal((html.match(/data-subtype-bar=/g)??[]).length,2);assert.match(html,/3分钟/);assert.match(html,/未知/);assert.match(html,/5 \/5/);assert.doesNotMatch(html,/最近结果为部分核验/);
 assert.match(roundedScoreRing(76,100),/stroke-dasharray/);
});
