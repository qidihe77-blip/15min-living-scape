import test from 'node:test';
import assert from 'node:assert/strict';
import {publicFacilityCategoryTree} from '../server/facility-categories.mjs';
import {reportPresentation,radarSvg,reportSummary} from '../web/report-view.js';
const tree=publicFacilityCategoryTree();
function fixture(){return {analysis:{origin:{name:'测试社区'},categories:tree.categories.map((g)=>({categoryId:g.id,subtypeResults:g.subtypes.map((s)=>({subtypeId:s.id,accessStatus:'unknown',nearestReachable:null}))}))},
  score:{scoreStatus:'scored',S_low:20,S_high:85,isExact:false,unknownWeight:.65,categories:tree.categories.map((g)=>({categoryId:g.id,G_low:20,G_high:85}))}};}
test('summary and radar read existing score intervals without declaring incomplete results good',()=>{
  const job=fixture(),view=reportPresentation(job,tree);
  assert.equal(view.overall.text,'20–85');assert.equal(view.overall.verdict,'部分信息暂无');
  assert.equal(view.groups[0].scoreText,'20–85');assert.match(radarSvg(view.groups),/教育 20–85/);
  assert.match(reportSummary(job,tree),/20–85/);
});
test('all25 subtype statuses use their independent evidence, missing children stay unknown',()=>{
  const job=fixture();job.analysis.categories[0].subtypeResults[0].accessStatus='reachable';
  job.analysis.categories[0].subtypeResults[1].accessStatus='no_reachable_in_declared_search';
  job.analysis.categories[1].subtypeResults.pop();
  const view=reportPresentation(job,tree);
  assert.deepEqual(view.counts,{reachable:1,absent:1,unknown:23,total:25});
  assert.equal(view.groups[0].subtypes[1].statusText,'未发现');
});
test('a reachable pharmacy route within1km does not fabricate a missing dedicated specialty result',()=>{
  const job=fixture(),sub=job.analysis.categories[1].subtypeResults.find((s)=>s.subtypeId==='pharmacy');
  sub.accessStatus='reachable';sub.nearestReachable={name:'测试药店',distanceMeters:500,durationSeconds:450};
  assert.deepEqual(reportPresentation(job,tree).specialties.map((s)=>s.status),['unknown','unknown','unknown']);
  assert.deepEqual(reportPresentation(job,tree).specialties.map((s)=>s.subtypeId),['market','pharmacy','primary_school']);
});
test('zero weights, missing scores and malformed scores never produce NaN or fake numbers',()=>{
  const job=fixture();job.score.scoreStatus='not_requested';job.score.S_low=null;job.score.S_high=null;
  assert.equal(reportPresentation(job,tree).overall.text,'未计分');
  const empty=reportPresentation({},tree);assert.equal(empty.counts.unknown,25);
  assert.ok(!radarSvg(empty.groups).includes('NaN'));assert.equal(empty.groups[0].scoreText,'—');
  job.score.categories[0].G_low=Number.NaN;assert.equal(reportPresentation(job,tree).groups[0].scoreText,'—');
});
