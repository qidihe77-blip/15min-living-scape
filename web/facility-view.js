import{confirmedCategoryIds}from'./facility-membership.js';
import{withinWalkingLimit,decisionSeconds}from'./walking-model.js';
import{boundWalkingEvidence}from'./reachable-presentation.js';
const routeOrder = (a, b) => Number(withinWalkingLimit(b)) - Number(withinWalkingLimit(a))
  || a.distanceMeters - b.distanceMeters || a.durationSeconds - b.durationSeconds;
export function facilityViewRows(analysis, categoryTree, activeCategoryId = 'all', display = null) {
  if (!analysis) return [];
  const groups = categoryTree.categories;
  const subtypeMap = new Map(groups.flatMap((group) => group.subtypes.map((sub) => [sub.id, { ...sub, group }])));
  const routesByKey = new Map();
  for (const route of (analysis.categories??[]).flatMap((group) => [...(group.subtypeResults??[]).flatMap((sub) => sub.routes??[]),...(group.categoryOnlyRoutes??[])])) {
    const list = routesByKey.get(route.identityKey) ?? []; list.push(route); routesByKey.set(route.identityKey, list);
  }
  const byIdentity = new Map();
  for (const poi of display?.facilities ?? analysis.poiMarkers ?? []) {
    const key = poi.identityKey ?? (poi.uid ? 'uid:' + poi.uid : JSON.stringify([poi.name, poi.location]));
    if (byIdentity.has(key)) continue;
    const related = [...new Set([...(poi.subtypeIds ?? []), ...(poi.pendingSubtypeIds ?? [])])]
      .map((id) => subtypeMap.get(id)).filter(Boolean);
    const memberships = [...new Set([...related.map((sub) => sub.group.id),...confirmedCategoryIds(poi,categoryTree)])];
    if (activeCategoryId !== 'all' && !memberships.includes(activeCategoryId)) continue;
    const selectedGroup = groups.find((group) => memberships.includes(group.id)
      && (activeCategoryId === 'all' || group.id === activeCategoryId)) ?? groups[0];
    const confirmed = selectedGroup.subtypes.find((sub) => (poi.subtypeIds ?? []).includes(sub.id));
    const allRoutes = routesByKey.get(key) ?? [];if(poi.routeEvidence&&!allRoutes.some(r=>r.evidenceId===poi.routeEvidence.evidenceId))allRoutes.push(poi.routeEvidence);
    const validRoutes = allRoutes.filter((route) => boundWalkingEvidence({...poi,routeEvidence:route},analysis.origin)).sort(routeOrder);
    const route = validRoutes[0] ?? null;
    byIdentity.set(key, { ...poi, identityKey: key, memberships, relatedSubtypes: related,
      group: selectedGroup, iconKey: confirmed?.iconKey ?? selectedGroup.iconKey, routeEvidence: route,
      routeCandidates: allRoutes, status: route ? withinWalkingLimit(route) ? 'reachable' : 'over_threshold' : 'unknown' });
  }
  return [...byIdentity.values()].sort((a, b) => {
    const status = { reachable: 0, over_threshold: 1, unknown: 2 };
    return status[a.status] - status[b.status] || (a.routeEvidence?.distanceMeters ?? Infinity)
      - (b.routeEvidence?.distanceMeters ?? Infinity) || a.identityKey.localeCompare(b.identityKey);
  });
}
export function makeFacilityTask({ origin, analysisLocation = origin, categoryTree, priorities, region, samplingConfirmed = false,walkingModelId=null }) {
  return { version: categoryTree.requestVersion ?? (categoryTree.version === 'facility-categories-v8'?8:categoryTree.version === 'facility-categories-v7'?7:categoryTree.version === 'facility-categories-v6'?6:categoryTree.version === 'facility-categories-v5'?5:categoryTree.version === 'facility-categories-v4'?4:3), categoryMappingVersion: categoryTree.version, origin, analysisLocation,
    categoryIds: categoryTree.categories.map((group) => group.id), subtypeScope: 'all',
    mode: 'walking', minutes: 15, region, priorities: { ...priorities }, searchRadiusMeters: 1500,
    includeReachableNetwork: true, maxRouteCandidatesPerSubtype: ['facility-categories-v6','facility-categories-v7','facility-categories-v8'].includes(categoryTree.version)?3:1,...(['facility-categories-v6','facility-categories-v7','facility-categories-v8'].includes(categoryTree.version)?{routeScope:['facility-categories-v7','facility-categories-v8'].includes(categoryTree.version)?'circle_candidates':'all_candidates'}:{}), ...(walkingModelId?{walkingModelId}:{}),samplingBudget: 'low', confirmRealWalkingSampling: samplingConfirmed };
}
