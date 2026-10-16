import{withinWalkingLimit,decisionSeconds}from'./walking-model.js';
const validPoint = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)
  && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
export function routeLines(geometry) {
  const lines = geometry?.type === 'LineString' ? [geometry.coordinates]
    : geometry?.type === 'MultiLineString' ? geometry.coordinates : [];
  return Array.isArray(lines) && lines.length && lines.every((line) => Array.isArray(line)
    && line.length >= 2 && line.every(validPoint)) ? lines : [];
}
export function reachableNetworkRoutes(job) {
  const routes = [], seen = new Set();
  const add = (row, source) => {
    if (row.routeStatus !== 'ok' || row.mode !== 'walking' || row.coordinateSystem !== 'BD-09LL'
      || !Number.isFinite(row.durationSeconds) || row.durationSeconds < 0 || !withinWalkingLimit(row)
      || !Number.isFinite(row.distanceMeters) || row.distanceMeters < 0) return;
    for (const line of routeLines(row.geometry)) {
      const key = JSON.stringify([line, row.durationSeconds]); if (seen.has(key)) continue; seen.add(key);
      routes.push({ coordinates: line, durationSeconds: row.durationSeconds, source, evidenceId: row.evidenceId });
    }
  };
  for (const feature of job.geojson?.features ?? []) if (feature.properties?.featureType === 'reachable_route')
    add({ ...feature.properties, geometry: feature.geometry }, 'walking_sampling');
  for (const group of job.analysis?.categories ?? []) for (const sub of group.subtypeResults ?? [])
    for (const row of sub.routes ?? []) if (row.classification?.candidateStatus === 'confirmed_by_rule') add(row, 'facility_route');
  return routes;
}
export function networkRouteColor(seconds, theme = 'dark') {
  return seconds <= 300 ? (theme === 'light' ? '#007F94' : '#28D9F5')
    : seconds <= 600 ? (theme === 'light' ? '#2563CD' : '#649EFF') : (theme === 'light' ? '#7149BE' : '#A786F0');
}
export function reachableCountBars(analysis, categories) {
  return categories.map((group) => {
    const evidence = analysis.categories.find((row) => row.categoryId === group.id);
    const uids = new Set();
    for (const sub of evidence?.subtypeResults ?? []) for (const route of sub.routes ?? [])
      if (route.facilityUid && route.classification?.candidateStatus === 'confirmed_by_rule'
        && route.routeStatus === 'ok' && route.mode === 'walking' && route.coordinateSystem === 'BD-09LL'
        && Number.isFinite(route.durationSeconds) && route.durationSeconds >= 0 && withinWalkingLimit(route)
        && Number.isFinite(route.distanceMeters) && route.distanceMeters >= 0) uids.add(route.facilityUid);
    const complete = evidence?.subtypeResults?.length === group.subtypes.length
      && evidence.subtypeResults.every((sub) => sub.searchComplete && sub.nearestComplete && !sub.unknownReasons?.length);
    return { categoryId: group.id, count: uids.size, complete };
  });
}
