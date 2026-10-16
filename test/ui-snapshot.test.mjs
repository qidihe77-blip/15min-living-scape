import test from 'node:test';import assert from 'node:assert/strict';import {uiSnapshot} from '../server/ui-snapshot.mjs';
import {makeUi16Job} from '../scripts/reference-v7-fixtures.mjs';
import {facilityViewRows} from '../web/facility-view.js';import {publicFacilityCategoryTree} from '../server/facility-categories.mjs';import {reachableFacilityRows} from '../web/reachable-presentation.js';
import {reportPresentation} from '../web/report-view.js';
test('UI projection keeps every reachable UID, geometry and exact score/unknown subtype statuses; full snapshot remains immutable',async()=>{
 const {job}=await makeUi16Job({batch:true}),before=JSON.stringify(job),ui=uiSnapshot(job),tree=publicFacilityCategoryTree(job.categoryMappingVersion);
 assert.deepEqual(ui.score,job.score);assert.equal(ui.presentationOnly,true);assert.equal(ui.rangeSamples,undefined);assert.equal(ui.analysis.diagnostics,undefined);assert.equal(ui.analysis.categories.flatMap(g=>g.subtypeResults).length,18);
 assert.deepEqual(ui.display.routes.map(r=>[r.identityKey,r.geometry,r.origin,r.destinationUid,r.distanceMeters,r.durationSeconds]),job.display.routes.map(r=>[r.identityKey,r.geometry,r.origin,r.destinationUid,r.distanceMeters,r.durationSeconds]));
 const rows=j=>reachableFacilityRows(facilityViewRows(j.analysis,tree,'all',j.display),j.analysis.origin).map(r=>r.identityKey).sort();assert.deepEqual(rows(ui),rows(job));
 const a=reportPresentation(job,tree,{scale:5,simple:true}),b=reportPresentation(ui,tree,{scale:5,simple:true});assert.deepEqual(b.groups.map(g=>[g.id,g.reachablePoiCount,g.subtypes.map(s=>[s.id,s.status])]),a.groups.map(g=>[g.id,g.reachablePoiCount,g.subtypes.map(s=>[s.id,s.status])]));
 assert.equal(JSON.stringify(job),before);assert.ok(JSON.stringify(ui).length<JSON.stringify(job).length/3);
});
