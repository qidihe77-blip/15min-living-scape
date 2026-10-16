import test from'node:test';import assert from'node:assert/strict';
import{sharedRouteSegments,sharedCategoryAt}from'../web/route-flow-a42.js';
test('shared road detection is direction-independent, category-specific and leaves original geometry unchanged',()=>{
 const routes=[{categoryId:'education',lines:[[[1,2],[2,2],[3,3]]]},{categoryId:'medical',lines:[[[2,2],[1,2]]]},{categoryId:'medical',lines:[[[1,2],[2,2]]]},{categoryId:'commerce',lines:[[[1,2.00001],[2,2.00001]]]}],before=structuredClone(routes),shared=sharedRouteSegments(routes);
 assert.equal(shared.size,1);assert.deepEqual([...shared.values()][0],['education','medical']);assert.deepEqual(routes,before);
});
test('shared-road color slots alternate while the active category takes precedence without shifting the path',()=>{
 const ids=['education','medical'];assert.equal(sharedCategoryAt(ids,0),'education');assert.equal(sharedCategoryAt(ids,660),'medical');assert.equal(sharedCategoryAt(ids,1320),'education');assert.equal(sharedCategoryAt(ids,0,['medical']),'medical');assert.equal(sharedCategoryAt(ids,660,['medical']),'medical');
});
