import test from 'node:test';
import assert from 'node:assert/strict';
import { facilityViewRows, makeFacilityTask } from '../web/facility-view.js';
import { poiGlyph, poiIconSvg } from '../web/poi-icons.js';
import { createFacilityRouteController } from '../web/facility-routes.js';
import { publicFacilityCategoryTree } from '../server/facility-categories.mjs';
const tree=publicFacilityCategoryTree();
const route={identityKey:'uid:shared',facilityUid:'shared',routeStatus:'ok',durationSeconds:900,distanceMeters:600,
  mode:'walking',coordinateSystem:'BD-09LL',origin:{lng:120,lat:30},originUid:'origin',destination:{lng:120,lat:30},destinationUid:'shared',
  subtypeId:'pharmacy',geometry:null};
const analysis={poiMarkers:[{uid:'shared',identityKey:'uid:shared',name:'多功能设施',location:{lng:120,lat:30},
  subtypeIds:['pharmacy','primary_school'],queriedSubtypeIds:['pharmacy','primary_school','market'],pendingSubtypeIds:[]},
  {uid:'shared',identityKey:'uid:shared',subtypeIds:['pharmacy'],location:{lng:120,lat:30}}],
  categories:[{categoryId:'medical',subtypeResults:[{routes:[route]}]},{categoryId:'education',subtypeResults:[{routes:[{...route,subtypeId:'primary_school'}]}]}]};
test('UID union is one marker/list item across memberships, excluded queries never become view membership',()=>{
  const all=facilityViewRows(analysis,tree),medical=facilityViewRows(analysis,tree,'medical'),education=facilityViewRows(analysis,tree,'education');
  assert.equal(all.length,1);assert.equal(medical.length,1);assert.equal(education.length,1);
  assert.equal(facilityViewRows(analysis,tree,'commerce').length,0);
  assert.equal(medical[0].iconKey,'pharmacy');assert.equal(education[0].iconKey,'school');
  assert.equal(medical[0].routeEvidence.durationSeconds,900);assert.equal(medical[0].status,'reachable');
  assert.equal(all[0].relatedSubtypes.length,2);
});
test('view changes leave the task contract and fixed 25-child denominator untouched',()=>{
  const task=makeFacilityTask({origin:{id:'origin',location:{lat:30,lng:120}},categoryTree:tree,region:'上海市',priorities:{medical:0}});
  const before=JSON.stringify(task);
  for(const id of ['all',...tree.categories.map((g)=>g.id)])facilityViewRows(analysis,tree,id);
  assert.equal(JSON.stringify(task),before);assert.equal(task.version,3);assert.equal(task.categoryIds.length,6);
  assert.equal(task.subtypeScope,'all');assert.equal(task.mode,'walking');assert.equal(task.minutes,15);
  assert.equal(Object.hasOwn(task,'activeCategoryId'),false);
});
test('missing icon falls back locally and dark/light styles preserve readable semantic glyphs',()=>{
  assert.equal(poiGlyph('not-registered','transport'),poiGlyph('transport'));
  assert.notEqual(poiGlyph('hospital'),poiGlyph('pharmacy'));
  for(const theme of ['dark','light']){
    const outline=theme==='light'?'#ffffff':'#e9f6ff';
    const svg=poiIconSvg({iconKey:'medical',color:'#28D9F5',palette:{outline,glyph:'#ffffff'},status:'reachable'});
    assert.match(svg,/<path/);assert.match(svg,/stroke="currentColor"/);assert.match(svg,/style="color:#28D9F5"/);
    assert.ok(svg.includes('style="color:'+outline+'" fill="none" stroke="currentColor"'));assert.match(svg,/data-facility-face="medical"/);
    assert.doesNotMatch(svg,/(?:href|src)="https?:/);
  }
});
test('cached geometry draws without fetch; missing geometry is fetched once only on user show',async()=>{
  let requests=0,draws=0;const job={analysisId:'fixture',score:{evidenceFingerprint:'fp'}};
  const controller=createFacilityRouteController({clear:()=>{},requestDetail:async()=>{requests++;return{routeStatus:'ok',route:{...route,geometry:{type:'LineString'}}};},
    draw:()=>draws++,updateJob:()=>{}});
  controller.filter('medical');assert.equal(requests,0);
  await controller.show({job,row:{identityKey:'uid:shared',name:'药店',memberships:['medical'],routeEvidence:{...route,geometry:{type:'LineString'}}}});
  assert.equal(requests,0);assert.equal(draws,1);
  await controller.show({job,row:{identityKey:'uid:shared',name:'药店',memberships:['medical'],routeEvidence:route}});
  assert.equal(requests,1);assert.equal(draws,2);
});
test('clearing or filtering away a route aborts and ignores late detail callbacks; no path never draws a straight line',async()=>{
  let resolve,signal,draws=0,updates=0;const job={analysisId:'fixture',score:{evidenceFingerprint:'fp'}};
  const row={identityKey:'uid:shared',name:'药店',memberships:['medical'],routeEvidence:route};
  const controller=createFacilityRouteController({clear:()=>{},requestDetail:async(_id,_body,s)=>{signal=s;return new Promise((r)=>{resolve=r;});},
    draw:()=>draws++,updateJob:()=>updates++});
  const pending=controller.show({job,row});controller.filter('education');
  assert.equal(signal.aborted,true);resolve({routeStatus:'ok',route:{...route,geometry:{type:'LineString'}},job:{}});await pending;
  assert.equal(draws,0);assert.equal(updates,0);assert.equal(controller.selectedIdentityKey,null);
  const empty=createFacilityRouteController({clear:()=>{},requestDetail:async()=>({routeStatus:'ok',route}),draw:()=>draws++,updateJob:()=>{}});
  await empty.show({job,row});assert.equal(draws,0);
});
