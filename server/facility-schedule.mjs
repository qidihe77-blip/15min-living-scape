import { FACILITY_GROUPS, FACILITY_SUBTYPES, facilityCategoryTree, FACILITY_V3_MAPPING_VERSION } from './facility-categories.mjs';

// Core specialty evidence first, then one subtype per group per round.
export function fairSubtypeOrder(version = FACILITY_V3_MAPPING_VERSION) {
  const FACILITY_GROUPS = facilityCategoryTree(version).categories;
  const FACILITY_SUBTYPES = FACILITY_GROUPS.flatMap(g=>g.subtypes.map(s=>({...s,categoryId:g.id})));
  const core = ['market', 'pharmacy', 'primary_school'];
  const ordered = core.map((id) => FACILITY_SUBTYPES.find((item) => item.id === id));
  const queues = FACILITY_GROUPS.map((group) => group.subtypes
    .filter((item) => !core.includes(item.id)).map((item) => FACILITY_SUBTYPES.find((sub) => sub.id === item.id)));
  while (queues.some((queue) => queue.length)) {
    for (const queue of queues) if (queue.length) ordered.push(queue.shift());
  }
  return ordered;
}
