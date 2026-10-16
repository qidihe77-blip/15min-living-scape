import test from'node:test';import assert from'node:assert/strict';
import{mkdtemp,readFile,writeFile,rm,mkdir}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{createHash}from'node:crypto';
import{identifyFreshCapabilities,branchEvidenceFromPlace,SERVICE_FUNCTION_RULE_VERSION}from'../server/service-capabilities.mjs';
import{diagnoseFreshService,boundServiceCost,mergeServicePois,assessServiceFunctions}from'../server/service-functions.mjs';
import{createServiceFunctionPlaceProvider}from'../server/service-function-provider.mjs';
import{runServiceFunctions}from'../server/service-function-runner.mjs';import{walkingTaskAllowance}from'../server/authorized-walking.mjs';
import{createServiceFunctionStore,serviceFunctionBinding}from'../server/service-function-store.mjs';import{createServiceFunctionManager}from'../server/service-function-manager.mjs';
const origin={uid:'community',location:{lng:120,lat:30}};
const poi=(uid,name='生鲜超市',tags='购物;超市')=>({uid,name,rawCategory:tags,rawCategoryTags:[tags],coordinateSystem:'BD-09LL',location:{lng:120.001,lat:30},subtypeIds:['supermarket']});
const branch=(p,value,field='description')=>({...p,businessEvidence:branchEvidenceFromPlace({uid:p.uid,detail_info:{[field]:value}},{source:'baidu_place_detail',retrievedAt:'2026-10-14T00:00:00Z'})});
const route=(p,distanceMeters=500,o=origin)=>({routeStatus:'ok',mode:'walking',coordinateSystem:'BD-09LL',distanceMeters,durationSeconds:distanceMeters*2,requestedOrigin:o,requestedDestination:{uid:p.uid,location:p.location},evidenceId:'walking-'+p.uid+'-'+JSON.stringify(o),source:'direction_v2'});
const complete={complete:true,truncated:false,queryScope:'fresh_food_and_supermarkets',center:origin.location,radiusMeters:1500};
const job=()=>({analysisId:'fa-12345678-1234-1234-1234-123456789abc',status:'complete',score:{S_low:88,evidenceFingerprint:'frozen-source'},geojson:{type:'FeatureCollection',features:[{type:'Feature',properties:{featureType:'sampled_boundary'},geometry:{type:'Polygon',coordinates:[[[119.997,29.997],[120.003,29.997],[120.003,30.003],[119.997,30.003],[119.997,29.997]]]}}]},analysis:{origin,searchRadiusMeters:1500,categories:[{categoryId:'commerce',poiMarkers:[],subtypeResults:['market','pharmacy','primary_school'].map(subtypeId=>({subtypeId,searchComplete:true,searchTruncated:false,routes:[]}))}],poiMarkers:[]},display:{facilities:[]}});
const diagnose=(candidates,routes=[],search=complete)=>diagnoseFreshService({origin,candidates:mergeServicePois(candidates),search,getCost:(o,p)=>routes.find(r=>boundServiceCost(r,o,p))});
test('same chain branches need individual operating evidence; brand never implies fresh food',()=>{
 const a=branch(poi('a','联华超市甲店'),'本门店经营蔬菜、水果、鲜肉'),b=poi('b','联华超市乙店');
 assert.equal(identifyFreshCapabilities(a).confidence,'explicit');assert.equal(identifyFreshCapabilities(b).confidence,'insufficient');
 assert.equal(diagnose([a],[route(a)]).status,'confirmed_covered');assert.equal(diagnose([b],[route(b)]).status,'pending_verification');
 assert.equal(identifyFreshCapabilities(branch(b,'联华集团旗下门店提供蔬菜、水果、鲜肉')).confidence,'insufficient');
 assert.equal(identifyFreshCapabilities({...b,businessEvidence:branch(a,'本店经营蔬菜、水果、鲜肉').businessEvidence}).confidence,'insufficient');
});
test('large supermarket, brand reputation, comments and photographs alone are insufficient',()=>{
 for(const name of['永辉超市(大型综合店)','沃尔玛购物广场','盒马门店']){const p={...poi('x',name),reviews:'销售蔬菜鲜肉',content_tag:'蔬菜 水果 鲜肉',photos:['生鲜']};assert.equal(identifyFreshCapabilities(p).confidence,'insufficient');}
});
test('format name is labelled inference; provider fresh category is explicit and versioned',()=>{
 const inferred=poi('x','惠民生鲜超市'),explicit=poi('y','惠民门店','购物;生鲜超市');
 assert.equal(diagnose([inferred],[route(inferred)]).status,'high_confidence_substitute');const d=diagnose([explicit],[route(explicit)]);assert.equal(d.status,'confirmed_covered');assert.equal(d.ruleVersion,SERVICE_FUNCTION_RULE_VERSION);assert.ok(d.facets.fresh_meat.evidence.every(e=>e.source&&e.rule));
});
test('a fruit store only covers fruit; separate branch-proven shops can jointly supply the bundle',()=>{
 const fruit=poi('f','水果店','购物;水果店'),veg=poi('v','蔬菜店','购物;蔬菜店'),meat=poi('m','鲜肉店','购物;鲜肉店');
 const d=diagnose([fruit],[route(fruit)]);assert.equal(d.comprehensiveFreshSupply,false);assert.equal(d.partialCoverage,true);assert.deepEqual(d.missingFacets,['vegetables','fresh_meat']);assert.equal(d.status,'confirmed_missing');
 assert.equal(diagnose([fruit,veg,meat],[fruit,veg,meat].map(p=>route(p))).status,'confirmed_covered');
 assert.equal(identifyFreshCapabilities(poi('tea','鲜果水果茶','餐饮;饮品店')).candidate,false);
});
test('negative branch evidence overrides broad tags; city name Wuxi is not a negative',()=>{
 const p=branch(poi('n','生鲜超市','购物;生鲜超市'),'本店不经营鲜肉，供应蔬菜水果');const cap=identifyFreshCapabilities(p);assert.equal(cap.facets.fresh_meat,undefined);assert.ok(cap.facets.vegetables);assert.equal(cap.completeFreshBundle,false);
 const no=branch(poi('z','永辉超市'),'本店不经营生鲜，仅销售日用百货');assert.equal(identifyFreshCapabilities(no).candidate,true);assert.equal(diagnose([no],[]).status,'confirmed_missing');
 assert.equal(identifyFreshCapabilities(branch(poi('wx','联华超市'),'无锡门店经营蔬菜、水果、鲜肉')).confidence,'explicit');
});
test('UID dedup is exact and reliable; nearby distinct shops stay distinct, conflicts stay unknown',()=>{
 const a=poi('a'),b={...poi('b'),location:{lng:120.00101,lat:30}};assert.equal(mergeServicePois([a,a,b]).length,2);
 const merged=mergeServicePois([a,branch(a,'经营蔬菜水果鲜肉')]);assert.equal(merged.length,1);assert.equal(identifyFreshCapabilities(merged[0]).confidence,'explicit');
 const bad=mergeServicePois([a,{...a,location:{lng:120.004,lat:30}}]);assert.equal(bad[0].coordinateConflict,true);assert.equal(diagnose(bad,[route(a)]).status,'pending_verification');
});
test('1km uses real route distance with exact endpoint binding, independent from 15min and provider time',()=>{
 const p=poi('a','生鲜超市','购物;生鲜超市');assert.equal(diagnose([p],[route(p,1000)]).status,'confirmed_covered');assert.equal(diagnose([p],[route(p,1001)]).status,'confirmed_missing');
 assert.equal(diagnose([p],[{...route(p),durationSeconds:99999}]).status,'confirmed_covered');
 for(const bad of[{...route(p),routeStatus:'timeout'},{...route(p),requestedOrigin:{uid:null,location:origin.location}},{...route(p),requestedDestination:{uid:'other',location:p.location}},{...route(p),coordinateSystem:'GCJ-02'}])assert.equal(diagnose([p],[bad]).status,'pending_verification');
});
test('empty results prove missing only inside a complete declared search window; failures remain unknown',()=>{
 assert.equal(diagnose([],[]).status,'confirmed_missing');
 for(const s of[null,{...complete,complete:false},{...complete,truncated:true},{...complete,center:{lng:120.02,lat:30}}, {...complete,queryScope:'brand_only'}])assert.equal(diagnose([],[],s).status,'pending_verification');
});
test('card-only diagnosis preserves origin binding, score and taxonomy, and returns no regional grid',()=>{
 const j=job(),p=poi('fresh','生鲜超市','购物;生鲜超市');j.analysis.poiMarkers=[p];const original=JSON.stringify(j),field=assessServiceFunctions({job:j,search:complete,routes:[route(p)]});assert.equal(field.originDiagnostic.status,'confirmed_covered');assert.equal(field.grid,undefined);assert.equal(field.scope,'analysis_origin_only');assert.equal(field.affectsOverallScore,false);assert.equal(JSON.stringify(j),original);
 const elsewhere={uid:null,location:{lng:120.002,lat:30}};assert.equal(boundServiceCost(route(p),elsewhere,p),false);
});
test('Place fair paging is bounded; short, repeated, invalid or unknown-total pages cannot prove absence',async()=>{
 const requests=[],client={requestJson:async({params})=>{requests.push(params);return{data:{result_type:'poi_type',total:3,results:[{uid:params.query+'-'+params.page_num,name:'生鲜超市',location:origin.location}]},meta:{cached:params.page_num===0,retrievedAt:'fixture'}};}};
 const p=createServiceFunctionPlaceProvider({client}),r=await p.search({center:origin.location,maxRequests:4});assert.equal(requests.length,4);assert.notEqual(requests[0].query,requests[1].query);assert.equal(requests[2].page_num,1);assert.equal(r.complete,false);assert.equal(r.requestStats.placeHttpRequests,2);assert.ok(requests.every(p=>p.coord_type===3&&p.radius_limit===true));
 const unknown=createServiceFunctionPlaceProvider({client:{requestJson:async()=>({data:{results:[]},meta:{}})}});assert.equal((await unknown.search({center:origin.location,maxRequests:2})).complete,false);
 const empty=createServiceFunctionPlaceProvider({client:{requestJson:async()=>({data:{total:0,results:[]},meta:{}})}});assert.equal((await empty.search({center:origin.location,maxRequests:2})).complete,true);
});
test('detail UID belongs to requested branch and batches contain at most ten UIDs',async()=>{
 const asked=[],p=createServiceFunctionPlaceProvider({client:{requestJson:async args=>{asked.push(args.params.uids.split(','));return{meta:{},data:{results:[{uid:'not-requested',name:'生鲜超市',location:origin.location},...args.params.uids.split(',').map(uid=>({uid,name:'超市',location:origin.location,detail_info:{description:'本店经营蔬菜水果鲜肉'}}))]}};}}});
 const d=await p.details({uids:Array.from({length:25},(_,i)=>'u'+i),maxRequests:2});assert.deepEqual(asked.map(a=>a.length),[10,10]);assert.equal(d.candidates.length,20);assert.ok(d.candidates.every(p=>p.businessEvidence[0].uid===p.uid));
});
test('runner reuses real origin costs, bounds new requests and performs zero grid lookups',async()=>{
 const j=job(),p=poi('fresh','生鲜超市','购物;生鲜超市'),q=poi('q','生鲜超市','购物;生鲜超市'),r=poi('r','生鲜超市','购物;生鲜超市'),pool=[p,q,r];j.analysis.poiMarkers=pool;j.analysis.categories[0].subtypeResults[0].routes=[route(p)];const original=JSON.stringify(j);let calls=0;
 const provider={peek:()=>null,route:async(a,b,o)=>{calls++;o.walkingAllowance.used++;assert.equal(o.originUid,origin.uid);assert.deepEqual(a,origin.location);return route(pool.find(p=>p.uid===o.destinationUid),600,{uid:o.originUid,location:a});}};
 const field=await runServiceFunctions({job:j,routeProvider:provider,searchLimit:0,detailLimit:0,originRouteLimit:3,walkingAllowance:walkingTaskAllowance(2)});assert.equal(calls,2);assert.equal(field.requestStats.walkingRequests,2);assert.equal(field.requestStats.originRouteLookups,2);assert.equal(field.requestStats.recordedCostHits,1);assert.equal(field.grid,undefined);assert.equal(field.requestStats.gridRouteLookups,undefined);assert.equal(field.originDiagnostic.status,'confirmed_covered');assert.equal(JSON.stringify(j),original);
 j.analysis.categories[0].subtypeResults[0].routes=[];const cached=await runServiceFunctions({job:j,routeProvider:{peek:(a,b,o)=>route(pool.find(p=>p.uid===o.destinationUid),500,{uid:o.originUid,location:a}),route:()=>assert.fail('cache must be reused')},searchLimit:0,detailLimit:0,originRouteLimit:0});assert.equal(cached.requestStats.providerCacheHits,3);assert.equal(cached.requestStats.walkingRequests,0);
});
test('snapshot is bound to evidence, origin, geometry and rule version; hash rejects modified data',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'service-fn-'));try{const s=createServiceFunctionStore(dir),j=job(),field=assessServiceFunctions({job:j});const path=await s.write(j,field);assert.deepEqual(await s.read(j),field);assert.notEqual(serviceFunctionBinding({...j,analysis:{...j.analysis,origin:{...origin,uid:'other'}}}),serviceFunctionBinding(j));assert.equal(await s.read({...j,score:{...j.score,evidenceFingerprint:'changed'}}),null);const raw=JSON.parse(await readFile(path,'utf8'));raw.field.originDiagnostic.status='confirmed_covered';await writeFile(path,JSON.stringify(raw));assert.equal(await s.read(j),null);}finally{await rm(dir,{recursive:true,force:true});}
});
test('automatic manager shares concurrent starts, reloads saved results and GET never calls providers',async()=>{
 const j=job();let calls=0,saved=null;const m=createServiceFunctionManager({store:{read:async()=>saved,write:async(j,f)=>{saved=f;}},placeProvider:{search:async()=>{calls++;await new Promise(r=>setTimeout(r,15));return{...complete,candidates:[],freshUids:[],requestStats:{}};}},budgets:{searchLimit:2,detailLimit:0,originRouteLimit:0},remainingWalking:()=>0});
 assert.equal((await m.get(j)).status,'not_started');assert.equal(calls,0);const a=await Promise.all([m.get(j,{start:true}),m.get(j,{start:true})]);assert.equal(a[0],a[1]);await a[0].done;assert.equal(calls,1);assert.equal((await m.get(j,{start:true})).status,'complete');assert.equal(calls,1);assert.equal(saved.originDiagnostic.status,'confirmed_missing');
});
test('legacy grid snapshot projects the genuine origin diagnosis without a grid or any new provider call',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'service-legacy-'));try{const j=job(),field={...assessServiceFunctions({job:j}),version:'walking-1km-service-functions-grid200-v1',grid:{cells:[{old:true}]}},binding=serviceFunctionBinding(j,field.version),folder=join(dir,'data/service-functions',j.analysisId);await mkdir(folder,{recursive:true});await writeFile(join(folder,binding+'.json'),JSON.stringify({binding,field,sha256:createHash('sha256').update(JSON.stringify(field)).digest('hex')}));
 const store=createServiceFunctionStore(dir),m=createServiceFunctionManager({store,placeProvider:{search:()=>assert.fail('must reuse verified origin snapshot')}}),saved=await m.get(j,{start:true});assert.equal(saved.status,'complete');assert.equal(saved.field.grid,undefined);assert.equal(saved.field.scope,'analysis_origin_only');assert.equal(saved.field.migration.extraRequests,0);assert.deepEqual(saved.field.originDiagnostic,field.originDiagnostic);
 }finally{await rm(dir,{recursive:true,force:true});}
});
