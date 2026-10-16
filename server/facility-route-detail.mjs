import { evaluateSubtypeAccess,prepareSubtypeCandidates,facilityIdentity } from './nearest-facility.mjs';
import { facilityRouteCacheKey } from './baidu-route.mjs';
import { summarizeFacilityGroups } from './facility-analysis.mjs';
import { classifySubtypeCandidate } from './facility-categories.mjs';
import {attachSearchDiagnostics} from './evidence-diagnostics.mjs';
import {knownSampleDiagnostics} from './analysis-diagnostics.mjs';

// A new Lite result replaces both cost and geometry for that exact endpoint.
export async function applyFacilityRouteDetail(analysis, previous, route) {
  const rows = analysis.categories.flatMap((group) => group.subtypeResults);
  const memo = new Map();
  for (const item of rows.flatMap((row) => row.routes)) {
    memo.set(facilityRouteCacheKey(item.origin, item.destination, { mode: 'walking',
      originUid: item.originUid, destinationUid: item.destinationUid }), item);
  }
  memo.set(facilityRouteCacheKey(previous.origin, previous.destination, { mode: 'walking',
    originUid: previous.originUid, destinationUid: previous.destinationUid }), route);
  const provider = { route: async () => ({ routeStatus: 'not_verified' }) };
  const refreshed = [];
  for (const sub of rows) {
    if (!sub.routes.some((item) => item.identityKey === previous.identityKey)) { refreshed.push(sub); continue; }
    const excludedKeys=new Set((sub.rangeExcludedCandidates??[]).map(p=>p.identityKey));
    const facilities = analysis.poiMarkers.filter((candidate) => !excludedKeys.has(facilityIdentity(candidate))&&(candidate.queriedSubtypeIds.includes(sub.subtypeId)
      || classifySubtypeCandidate({ ...candidate, subtypeId: sub.subtypeId, categoryMappingVersion: analysis.categoryMappingVersion }).candidateStatus === 'confirmed_by_rule'));
    const preparedCandidates=prepareSubtypeCandidates({demandPoint:analysis.origin,categoryMappingVersion:analysis.categoryMappingVersion,subtypeId:sub.subtypeId,facilities,
      existingRouteOrder:sub.routes.map(r=>r.identityKey)});
    const access = await evaluateSubtypeAccess({ demandPoint: analysis.origin, categoryMappingVersion: analysis.categoryMappingVersion, subtypeId: sub.subtypeId,
      walkingModelId:analysis.walkingModelId, facilities, preparedCandidates, searchComplete: sub.searchComplete, searchRadiusMeters: analysis.searchRadiusMeters,
      maxRouteCandidates: ['all_candidates','circle_candidates'].includes(analysis.routeScope)?Math.max(sub.routes.length,analysis.maxRouteCandidatesPerSubtype):analysis.maxRouteCandidatesPerSubtype, routeMemo: memo, provider, observedAt: analysis.observedAt });
    refreshed.push({ ...sub, ...attachSearchDiagnostics(access,{searchComplete:sub.searchComplete,
      pages:sub.searchPages ?? [],errors:sub.searchErrors ?? []}),nearestAlgorithmVersion:sub.nearestAlgorithmVersion });
  }
  const categories=summarizeFacilityGroups(refreshed,analysis.poiMarkers,analysis.categoryMappingVersion);
  return { ...analysis, categories,...(analysis.auxiliaryMetrics?{auxiliaryMetrics:knownSampleDiagnostics(categories)}:{}),
    diagnostics:analysis.diagnostics?{...analysis.diagnostics,candidates:refreshed.flatMap(sub=>
      (sub.candidateDiagnostics ?? []).map(candidate=>({...candidate,subtypeId:sub.subtypeId})))}:undefined,
    status: refreshed.every((sub) => sub.nearestComplete) ? 'complete' : 'partial' };
}
