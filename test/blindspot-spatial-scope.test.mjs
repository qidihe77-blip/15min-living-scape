import test from'node:test';import assert from'node:assert/strict';
import{uiSnapshot}from'../server/ui-snapshot.mjs';import{assessServiceGaps}from'../server/service-gaps.mjs';
import{buildBlindspotModel,buildBlindspotModels,hasBlindspotDisplay}from'../web/blindspot-model.js';
import{buildBlindspotCollection,blindspotHits}from'../web/blindspot-collection.js';
import{buildServiceGapSummary}from'../web/service-gap-summary.js';
import{localServiceProjection}from'../web/grid-contours.js';
import{isolationFixture,specialtyTree,specialtyIds,addSpecialtyCandidate}from'./fixtures/specialty-isolation-fixture.mjs';
function job(a){for(const s of a.categories.find(g=>g.categoryId==='eldercare').subtypeResults)Object.assign(s,{searchComplete:true,searchTruncated:false,searchStatus:'complete',searchErrors:[]});return{analysisId:'spatial-scope',categoryMappingVersion:specialtyTree.version,analysis:a,serviceGaps:assessServiceGaps(a),score:{S_low:50,evidenceFingerprint:'same-evidence'},display:{facilities:[]},geojson:{features:[{properties:{featureType:'sampled_boundary'},geometry:{type:'Polygon',coordinates:[[[119.996,29.996],[120.004,29.996],[120.004,30.004],[119.996,30.004],[119.996,29.996]]]}}]}};}

for(const subtypeId of specialtyIds)test(subtypeId+': priority data remains in the audit but does not produce a blindspot',()=>{
 const a=isolationFixture();addSpecialtyCandidate(a,subtypeId,1500);const original=job(a),before=JSON.stringify(original),view=uiSnapshot(original),m=buildBlindspotModel(view,[],specialtyTree,{type:'specialty',categoryId:subtypeId});
 assert.equal(hasBlindspotDisplay(m),false);assert.deepEqual(m.components,[]);assert.equal(view.serviceGapEvidence.specialties.find(s=>s.subtypeId===subtypeId).confirmed.length,1);assert.equal(JSON.stringify(original),before);assert.deepEqual(view.score,original.score);
});
for(const[id,sibling]of[['market','supermarket'],['pharmacy','hospital'],['primary_school','kindergarten']])test(id+': a reachable sibling still suppresses the whole major, with no priority layer',()=>{
 const a=isolationFixture();addSpecialtyCandidate(a,id,1500);const p=addSpecialtyCandidate(a,sibling,500),view=uiSnapshot(job(a)),group=specialtyTree.categories.find(g=>g.subtypes.some(s=>s.id===id)),rows=[{...p,routeEvidence:p.circleRouteEvidence}],major=buildBlindspotModel(view,rows,specialtyTree,{type:'category',categoryId:group.id});
 assert.equal(major.categoryPresent,true);assert.deepEqual(major.components,[]);assert.ok(buildBlindspotModels(view,rows,specialtyTree).every(m=>m.target.type==='category'));
});
test('six models reuse the exact major grid; historical priority components cannot enter the map or summary',()=>{
 const view=uiSnapshot(job(isolationFixture())),models=buildBlindspotModels(view,[],specialtyTree);assert.equal(models.length,6);const elder=models.find(m=>m.categoryId==='eldercare'),legacy={...elder,target:{type:'specialty',categoryId:'primary_school'},label:'小学'},collection=buildBlindspotCollection([...models,legacy]);
 assert.ok(elder.components.length);assert.equal(collection.models.length,1);assert.deepEqual(collection.targets,[{type:'category',categoryId:'eldercare'}]);assert.equal(collection.combinations.length,1);
 const first=collection.models[0],i=first.components[0].cellIds[0],p=[first.x0+(i%first.width+.5)*200,first.y0+(Math.floor(i/first.width)+.5)*200];assert.equal(blindspotHits(collection,p).length,1);
 assert.deepEqual(buildServiceGapSummary(view,[],specialtyTree,models).combinations,buildServiceGapSummary(view,[],specialtyTree,[...models,legacy]).combinations);
});
test('different major geometries expose only hit categories and count shared area once',()=>{
 const projection=localServiceProjection({lng:120,lat:30}),rect=(x,w)=>[[x,0],[x+w,0],[x+w,100],[x,100],[x,0]],scope=rect(0,300).map(q=>{const p=projection.unproject(q);return[p.lng,p.lat];}),make=(id,x)=>({target:{type:'category',categoryId:id},categoryId:id,subtypeId:null,label:id,status:'available',representation:'area',projection,polygons:[[scope]],assessmentScope:'full',components:[{rings:[rect(x,200)]}]}),models=[make('eldercare',0),make('education',100)],collection=buildBlindspotCollection(models);
 assert.equal(blindspotHits(collection,[50,50]).length,1);assert.equal(blindspotHits(collection,[150,50]).length,2);assert.equal(blindspotHits(collection,[250,50])[0].target.categoryId,'education');assert.ok(Math.abs(collection.area-30000)<1e-5);for(const m of collection.models)assert.ok(Math.abs(m.area-20000)<1e-5);
 const summary=buildServiceGapSummary({analysis:{origin:{location:{lng:120,lat:30}}}},[],specialtyTree,models);assert.equal(summary.combinations.length,3);assert.ok(Math.abs(summary.gapArea-collection.area)<1e-5);assert.ok(summary.combinations.some(c=>c.labels.includes('education')));
});
