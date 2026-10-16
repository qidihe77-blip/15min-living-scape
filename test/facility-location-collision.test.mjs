import test from'node:test';import assert from'node:assert/strict';
import{classifyV3FacilityCandidate,classifySubtypeCandidate,facilityCategoryTree}from'../server/facility-categories.mjs';
import{facilitySubjectName,facilityNameProof}from'../server/facility-name-evidence.mjs';
import{mergeFacilityCandidatesV3,prepareSubtypeCandidates,evaluateSubtypeAccess}from'../server/nearest-facility.mjs';
import{readFileSync}from'node:fs';
const version='facility-categories-v8',classify=p=>classifyV3FacilityCandidate(p,version);
test('recorded provider categories distinguish shops, bus stops and branch addresses from real sports venues and libraries',()=>{const {items}=JSON.parse(readFileSync(new URL('./fixtures/poi-name-collision-recorded.json',import.meta.url),'utf8'));assert.ok(items.length>9);for(const p of items){const c=classify(p);if(/购物|医疗|交通设施|培训机构|政府机构/.test(p.rawCategory))assert.ok(!c.categoryIds.includes('leisure'),p.name);else if(/运动健身/.test(p.rawCategory))assert.ok(c.subtypeIds.includes('sports_venue'),p.name);else if(/图书馆/.test(p.rawCategory))assert.ok(c.subtypeIds.includes('culture_venue'),p.name);}});
// Names supplied in the screenshot; tags below are controlled fixtures, not API observations.
const collisions=[
 ['雾柚电子雾化器集合店(体育场路店)','购物;商店'],['大树路与体育场路交叉口','道路;交叉口'],
 ['学而思素养(体育场路日报校区)','教育培训;培训机构'],['邂逅(体育场路店)',''],
 ['中国联通(拱墅体育场路营业厅)','生活服务;营业厅'],['小夏建材(体育场路店)','购物;家居建材'],
 ['全家便利店(体育场路二店)','购物;便利店'],['天天好大药房(体育场路店)','医疗;药店'],
 ['杭州市市场监督管理局(体育场路办公区)','政府机构;行政单位'],
];
for(const[name,rawCategory]of collisions)test('location name is not leisure evidence: '+name,()=>{
 for(const p of[{name},{name,rawCategory},{name,rawCategory,matchedQueries:['体育场馆'],queriedSubtypeIds:['sports_venue']}])assert.ok(!classify(p).categoryIds.includes('leisure'));
 const m=classifySubtypeCandidate({name,rawCategory,subtypeId:'sports_venue',categoryMappingVersion:version});assert.equal(m.candidateStatus,'excluded_by_rule');assert.ok(m.ruleEvidence.incidentalNameMatches.includes('体育场'));
});
test('correct pharmacy and retail memberships survive; UID pooling cannot restore incidental leisure matches',()=>{
 for(const[name,rawCategory,id]of[[collisions[6][0],collisions[6][1],'convenience_store'],[collisions[7][0],collisions[7][1],'pharmacy']]){const p={uid:id,name,rawCategory,location:{lng:120,lat:30}},merged=mergeFacilityCandidatesV3([p,{...p,matchedQueries:['体育场'],rawCategoryTags:[rawCategory]}]).candidates[0],m=classify(merged);assert.ok(m.subtypeIds.includes(id));assert.ok(!m.categoryIds.includes('leisure'));}
});
test('real venues on the same road, functional aliases and provider venue tags still qualify',()=>{
 for(const[name,rawCategory,id]of[['体育场路社区体育馆','运动健身;体育场馆','sports_venue'],['社区体育馆(体育场路店)','','sports_venue'],['社区中心（图书馆）','','culture_venue'],['公共图书馆','教育培训;图书馆','culture_venue'],['超级猩猩(体育场路店)','运动健身;健身中心','sports_venue'],['公园路社区健身房','运动健身;健身房','sports_venue'],['杭州市体育场','','sports_venue'],['市民休闲广场','旅游景点;广场','park_green']])assert.ok(classify({name,rawCategory}).subtypeIds.includes(id),name);
});
test('unparenthesized road names, category-address collisions and commercial venue-name collisions cannot qualify',()=>{
 for(const p of[{name:'体育场路',rawCategory:'地名地址信息;体育场路'},{name:'体育场馆用品店',rawCategory:'购物;体育场馆用品店'},{name:'博物馆咖啡店',rawCategory:'美食;咖啡厅'},{name:'公园药房',rawCategory:'医疗;药店'},{name:'体育场路培训中心',rawCategory:'教育培训;培训机构'},{name:'市体育馆',rawCategory:'交通设施;公交车站'}])assert.ok(!classify(p).categoryIds.includes('leisure'),p.name);
 assert.ok(classify({name:'市体育馆',rawCategory:'交通设施;公交车站'}).subtypeIds.includes('bus_stop'));
 assert.deepEqual(facilityNameProof(['体育场路社区体育馆'],['体育场','体育馆']).matches,['体育馆']);assert.equal(facilitySubjectName('药房（体育场路店）').trim(),'药房');
});
test('the shared name rule also prevents school and hospital branch names from becoming facility proof',()=>{
 for(const[name,id]of[['全家便利店(人民医院店)','hospital'],['仁心药房(实验小学店)','primary_school'],['人民医院路公交站','hospital']])assert.equal(classifySubtypeCandidate({name,subtypeId:id,categoryMappingVersion:version}).candidateStatus,'excluded_by_rule');
 assert.ok(classify({name:'人民医院路社区卫生服务站',rawCategory:'医疗;社区卫生服务站'}).subtypeIds.includes('community_clinic'));
 const stop=classify({name:'人民医院',rawCategory:'交通设施;公交车站'});assert.deepEqual(stop.subtypeIds,['bus_stop']);
});
test('excluded address collisions never consume Walking calls during subtype evaluation',async()=>{
 const origin={uid:'o',location:{lng:120,lat:30}},facilities=collisions.map(([name,rawCategory],i)=>({uid:'collision-'+i,name,rawCategory,location:{lng:120+.0001*i,lat:30},queriedSubtypeIds:['sports_venue']}));
 const preparedCandidates=prepareSubtypeCandidates({demandPoint:origin,subtypeId:'sports_venue',categoryMappingVersion:version,facilities}),result=await evaluateSubtypeAccess({demandPoint:origin,subtypeId:'sports_venue',categoryMappingVersion:version,preparedCandidates,searchComplete:true,provider:{route:()=>assert.fail('No Walking call for an unrelated POI')},walkingModelId:'walking80-v1'});
 assert.equal(result.confirmedCandidateCount,0);assert.equal(result.excludedCandidateCount,9);assert.equal(result.candidatesRouted,0);assert.equal(result.reachableCountLowerBound,0);assert.equal(result.accessStatus,'no_reachable_in_declared_search');assert.equal(facilityCategoryTree(version).categories.flatMap(g=>g.subtypes).length,18);
});
