import test from'node:test';import assert from'node:assert/strict';
import{facilityCategoryTree,classifyV3FacilityCandidate,publicFacilityCategoryTree}from'../server/facility-categories.mjs';
import{accessContributions}from'../web/weighted-access.js';import{p123Default,p123Weights}from'../web/p123-priorities.js';
import{buildReportChartModel,directionSamples}from'../web/report-chart-model.js';import{uiSnapshot}from'../server/ui-snapshot.mjs';
import{makeUi23Job}from'../scripts/ui23-fixtures.mjs';import{facilityDetailList}from'../web/facility-detail-list.js';
import{contributionOption,roseOption}from'../web/report-charts.js';
import{buildFacilityReport}from'../server/report.mjs';import{reportPdfHtml}from'../server/report-pdf.mjs';
const ids=['education','medical','commerce','transport','eldercare','leisure'],version='facility-categories-v8';
const classify=(name,tag)=>classifyV3FacilityCandidate({name,rawCategory:tag},version).subtypeIds;
test('v8 3/3/4/2/3/3 taxonomy recalls clinics and functional public services; old versions stay exact',()=>{
 const t=facilityCategoryTree(version);assert.deepEqual(t.categories.map(g=>g.subtypes.length),[3,3,4,2,3,3]);assert.equal(t.categories.flatMap(g=>g.subtypes).length,18);
 for(const name of['社区卫生服务中心','社区卫生服务站','普通诊所','卫生院'])assert.deepEqual(classify(name,'医疗;诊所'),['community_clinic']);
 assert.deepEqual(classify('宠物诊所','宠物医院'),[]);assert.ok(classify('居家养老服务照料中心','养老机构').includes('day_care'));assert.deepEqual(classify('老年活动中心','老年活动中心'),['senior_activity']);assert.deepEqual(classify('疗养院','疗养院'),[]);assert.deepEqual(classify('综合为老服务中心','养老机构'),['residential_eldercare']);
 assert.ok(classify('市民休闲广场','旅游景点;广场').includes('park_green'));assert.ok(classify('社区体育馆','体育场馆').includes('sports_venue'));assert.deepEqual(classify('公共图书馆','文化;图书馆'),['culture_venue']);assert.deepEqual(classify('KTV足浴娱乐城','娱乐场所'),[]);
 assert.deepEqual(facilityCategoryTree('facility-categories-v7').categories.map(g=>g.subtypes.length),[3,2,4,2,3,4]);
});
test('fixed P1/P2/P3, ties, empty middle grade and exact normalized contribution totals',()=>{
 const m=p123Default(ids);assert.deepEqual(Object.values(p123Weights(m,ids)),[3,3,2,3,1,2]);m.levels.education=1;m.levels.medical=1;m.levels.commerce=3;assert.deepEqual(Object.values(p123Weights(m,ids)),[3,3,1,3,1,2]);
 for(const priorities of[[3,3,2,2,1,1],[2,2,2,2,2,2],[3,3,3,1,1,1],[1,1,1,1,1,1]]){
  const r=accessContributions(ids.map((categoryId,i)=>({categoryId,priority:priorities[i],totalSubtypeCount:3,reachableSubtypeCount:i%3,unknownSubtypeCount:1})));assert.ok(Math.abs(Object.values(r.normalizedWeights).reduce((a,b)=>a+b,0)-1)<1e-12);assert.ok(Math.abs(r.categories.reduce((a,b)=>a+b.displayWeightPercent,0)-100)<1e-12);assert.equal(r.categories.reduce((a,b)=>a+b.contributionLow,0),r.S_low);assert.equal(r.categories.reduce((a,b)=>a+b.contributionHigh,0),r.S_high);assert.equal(r.score5Low,r.S_low/20);assert.equal(r.score5High,r.S_high/20);assert.ok(r.S_low<=r.S_high&&r.S_high<=100+1e-12);
  for(let i=0;i<6;i++)for(let j=0;j<6;j++)if(priorities[i]===priorities[j])assert.equal(r.categories[i].normalizedWeight,r.categories[j].normalizedWeight);
 }
 assert.throws(()=>accessContributions(ids.map(categoryId=>({categoryId,priority:0,totalSubtypeCount:3,reachableSubtypeCount:1,unknownSubtypeCount:1}))));
});
test('no unknown produces exact scores, all unknown 0–100, all covered exactly 100 and 5',()=>{
 const rows=(r,u)=>ids.map(categoryId=>({categoryId,priority:2,totalSubtypeCount:3,reachableSubtypeCount:r,unknownSubtypeCount:u}));
 const all=accessContributions(rows(3,0));assert.ok(Math.abs(all.S_low-100)<1e-12);assert.equal(all.S_low,all.S_high);assert.ok(Math.abs(all.score5Low-5)<1e-12);
 const unknown=accessContributions(rows(0,3));assert.equal(unknown.S_low,0);assert.ok(Math.abs(unknown.S_high-100)<1e-12);assert.equal(accessContributions(rows(0,0)).S_high,0);
});
test('v8 offline pipeline >25 candidates, raw time independent, 900/901, 18 denominator and synchronized chart model',async()=>{
 const{job,calls,tree}=await makeUi23Job(),model=buildReportChartModel(uiSnapshot(job),tree);assert.equal(job.analysis.version,8);assert.equal(calls.cost,36);assert.equal(job.analysis.circleCosts.selectedCount,36);assert.equal(job.score.priorityScheme,'p123-fixed-v1');assert.equal(model.groups.flatMap(g=>g.children).length,18);
 const hospital=job.analysis.categories.find(g=>g.categoryId==='medical').subtypeResults.find(s=>s.subtypeId==='hospital');assert.equal(hospital.routes.find(p=>p.facilityUid==='hospital-0').durationSeconds,1000);assert.equal(hospital.routes.find(p=>p.facilityUid==='hospital-0').modelDurationSeconds,300);assert.ok(hospital.routes.find(p=>p.facilityUid==='hospital-1').modelDurationSeconds>900);
 assert.equal(model.totalPoi,31);assert.equal(model.groups.reduce((n,g)=>n+g.value,0),model.totalPoi);assert.equal(model.groups.flatMap(g=>g.children).reduce((n,s)=>n+s.value,0),model.totalPoi);assert.equal(new Set(model.allocations.map(a=>a.uid)).size,model.totalPoi);assert.equal(model.contributions.reduce((n,g)=>n+g.contributionLow,0),job.score.S_low);assert.equal(model.contributions.reduce((n,g)=>n+g.contributionHigh,0),job.score.S_high);assert.equal(model.directions.length,36);assert.equal(model.directions.filter(d=>d.value!==null).length,36);
 const detail=facilityDetailList(model.view,model.reachableRows,job.origin,()=>'<i></i>');assert.equal((detail.match(/data-detail-subtype=/g)??[]).length,18);assert.doesNotMatch(detail,/样本医院1/);assert.match(detail,/无该设施/);assert.doesNotMatch(detail,/detail-empty/);assert.equal(contributionOption(model).series.length,2);assert.equal(roseOption(model).series[0].data.length,36);
});
test('directions use only true bound sample costs, reject 901/stale/invalid and never use interpolated boundary estimates',()=>{
 const origin={uid:'a',location:{lng:120,lat:30}},s=(sector,m)=>({sector,mode:'walking',routeStatus:'ok',coordinateSystem:'BD-09LL',walkingModelId:'walking80-v1',modelDurationSeconds:m,distanceMeters:m*80/60,durationSeconds:1500,requestedOrigin:origin,requestedDestination:{location:{lng:120+.001,lat:30},uid:null}}),job={analysis:{origin},heatSamples:[s(0,900),s(1,901),{...s(2,100),requestedOrigin:{...origin,uid:'b'}}],geojson:{features:[{properties:{sector:3,radiusMeters:9999}}]}};
 const d=directionSamples(job);assert.equal(d[0].status,'verified_sample');assert.ok(d[0].value>90);for(const i of[1,2,3,35])assert.equal(d[i].value,null);assert.equal(d[0].sample.durationSeconds,1500);
});
test('composition allocates multifunction UID once and does not mutate score or count pending classifications',async()=>{
 const{job,tree}=await makeUi23Job(),snapshot=uiSnapshot(job),baseline=buildReportChartModel(snapshot,tree),before=JSON.stringify(snapshot.score);
 const first=snapshot.display.facilities.find(p=>p.uid===baseline.allocations[0].uid);first.subtypeIds=[...new Set([...first.subtypeIds,'primary_school'])];
 snapshot.display.facilities.push({...structuredClone(first),identityKey:'duplicate:'+first.uid});
 const m=buildReportChartModel(snapshot,tree);assert.equal(m.totalPoi,baseline.totalPoi);assert.equal(m.allocations.filter(a=>a.uid===first.uid).length,1);assert.ok(m.allocations.find(a=>a.uid===first.uid).functionalSubtypeIds.includes('primary_school'));assert.equal(JSON.stringify(snapshot.score),before);
 first.classificationUncertain=true;first.classificationStatus='pending_review';first.subtypeIds=[];first.pendingSubtypeIds=['kindergarten'];snapshot.display.facilities=snapshot.display.facilities.filter(p=>!p.identityKey.startsWith('duplicate:'));
 assert.equal(buildReportChartModel(snapshot,tree).totalPoi,baseline.totalPoi-1);
});
test('direction invalid coordinates and missing actual costs stay empty instead of zero or boundary interpolation',()=>{
 const origin={location:{lng:120,lat:30},uid:null},base={mode:'walking',routeStatus:'ok',coordinateSystem:'BD-09LL',walkingModelId:'walking80-v1',modelDurationSeconds:60,distanceMeters:80,durationSeconds:100,requestedOrigin:origin};
 const d=directionSamples({analysis:{origin},heatSamples:[{...base,sector:0,requestedDestination:{location:{lng:Infinity,lat:30}}},{...base,sector:1,requestedDestination:{location:{lng:120,lat:91}}},{...base,sector:2,distanceMeters:null,requestedDestination:{location:{lng:120.01,lat:30}}}]});assert.ok(d.every(p=>p.value===null&&p.status==='unverified'));
});
test('v8 printable report renders shared vector charts and 18 statuses; preserves independent model/raw times',async()=>{
 const{job}=await makeUi23Job(),report=buildFacilityReport(job),html=reportPdfHtml(report);
 assert.equal((html.match(/<svg /g)||[]).length,3);assert.match(html,/综合匹配度|优先级加权贡献/);assert.equal(report.analysis.categories.length,6);assert.match(html,/可达设施/);assert.match(html,/社区诊所|日间照料中心|老年活动中心|文化活动场所/);assert.match(html,/步行时间<\/th><th>百度耗时/);assert.doesNotMatch(html,/<h2>18小类可达情况|<script\s+src=|<h2>增长趋势/);assert.match(html,/待核验/);
});
test('P123 rescore rejects 0/4, preserves provider evidence and synchronizes contribution/chart totals',async()=>{
 const{job,manager,calls,tree}=await makeUi23Job(),before=JSON.stringify(calls),fingerprint=job.score.evidenceFingerprint,priorities=Object.fromEntries(ids.map(id=>[id,2]));
 for(const bad of[0,4])assert.throws(()=>manager.rescore(job.analysisId,{evidenceFingerprint:fingerprint,priorities:{...priorities,education:bad}}));
 const scored=manager.rescore(job.analysisId,{evidenceFingerprint:fingerprint,priorities}),current=manager.get(job.analysisId),m=buildReportChartModel(uiSnapshot(current),tree);
 assert.equal(JSON.stringify(calls),before);assert.equal(scored.evidenceFingerprint,fingerprint);assert.equal(m.totalPoi,31);assert.equal(m.score.S_low,scored.S_low);assert.equal(m.contributions.reduce((n,g)=>n+g.contributionLow,0),scored.S_low);assert.equal(m.contributions.reduce((n,g)=>n+g.contributionHigh,0),scored.S_high);assert.ok(m.contributions.every(g=>g.priorityLabel==='P2'));
});
