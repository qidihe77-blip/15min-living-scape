import test from 'node:test';
import assert from 'node:assert/strict';
import { equalPriorityTiers, movePriority, tierWeights } from '../web/priority-tiers.js';
const ids = ['education','medical','commerce','transport','eldercare','leisure'];
test('drag splitting and joining preserves six memberships and supports equal priorities', () => {
  let model = equalPriorityTiers(ids);
  assert.deepEqual(Object.values(tierWeights(model,ids)),[1,1,1,1,1,1]);
  model = movePriority(model,'medical',0,'insert');
  assert.equal(tierWeights(model,ids).medical,2);
  model = movePriority(model,'education',0,'join');
  assert.equal(tierWeights(model,ids).education,tierWeights(model,ids).medical);
  assert.equal(tierWeights(model,ids).leisure,1);
  assert.deepEqual(movePriority(model,'education',0,'join'),model);
});
test('six separate tiers derive 6 to 1, exclusion is zero and all excluded is valid', () => {
  let model = {tiers:ids.map((id)=>[id]),excluded:[]};
  assert.deepEqual(Object.values(tierWeights(model,ids)),[6,5,4,3,2,1]);
  for (const id of ids) model = movePriority(model,id,0,'exclude');
  assert.deepEqual(Object.values(tierWeights(model,ids)),[0,0,0,0,0,0]);
  model = movePriority(model,'medical',0,'insert');
  assert.equal(tierWeights(model,ids).medical,1);
  assert.throws(()=>tierWeights({tiers:[ids, ['education']],excluded:[]},ids));
});
test('moving a singleton above or below its neighbour normalizes empty tiers', () => {
  let model={tiers:[['medical'],['education'],ids.slice(2)],excluded:[]};
  model=movePriority(model,'education',0,'insert');
  assert.deepEqual(model.tiers.slice(0,2),[['education'],['medical']]);
  model=movePriority(model,'education',2,'insert');
  assert.deepEqual(model.tiers.slice(0,2),[['medical'],['education']]);
});
