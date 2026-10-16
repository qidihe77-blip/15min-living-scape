import { validBd09ll } from './walking-provider.mjs';
import { FACILITY_CATEGORY_IDS, FACILITY_MAPPING_VERSION, classifyFacilityCandidate } from './facility-categories.mjs';

const EARTH_RADIUS_METERS = 6_371_000;
export const P0_CATEGORY_IDS = Object.freeze(['market', 'pharmacy', 'primary_school']);
// Historical geometric-only API below is retained for old reports. Active v3
// walking/geometric specialty diagnostics live in service-gaps.mjs.

export function straightDistanceMeters(a, b) {
  if (!validBd09ll(a) || !validBd09ll(b)) throw new TypeError('Invalid BD-09LL point.');
  const rad = (value) => value * Math.PI / 180;
  const deltaLat = rad(b.lat - a.lat);
  const deltaLng = rad(b.lng - a.lng);
  const h = Math.sin(deltaLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(deltaLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

export function dedupeFacilityCandidates(input) {
  if (!Array.isArray(input)) throw new TypeError('Candidates must be an array.');
  const seen = new Set();
  const unique = [];
  const duplicateUids = [];
  let invalidCount = 0;
  for (const candidate of input) {
    if (!validBd09ll(candidate?.location)) {
      invalidCount += 1;
      continue;
    }
    const uid = typeof candidate.uid === 'string' && candidate.uid.trim() ? candidate.uid.trim() : null;
    if (uid && seen.has(uid)) {
      duplicateUids.push(uid);
      continue;
    }
    if (uid) seen.add(uid);
    unique.push({ ...candidate, uid });
  }
  return { candidates: unique, duplicateUids, invalidCount };
}

export function assessKilometerGap({ origin, facilities, searchComplete, searchRadiusMeters = 0 }) {
  const nearby = facilities
    .map((facility) => ({ facility, meters: straightDistanceMeters(origin, facility.location) }))
    .filter(({ meters }) => Math.round(meters * 1000) / 1000 <= 1000);
  if (nearby.length) return { noFacilityWithinOneKilometer: false, status: 'confirmed_present', nearbyCount: nearby.length };
  if (searchComplete === true && searchRadiusMeters >= 1000) return { noFacilityWithinOneKilometer: true, status: 'confirmed_absent_in_declared_search', nearbyCount: 0 };
  return { noFacilityWithinOneKilometer: null, status: 'unknown_search', nearbyCount: 0 };
}

export async function evaluateFacilityAccess({
  demandPoint, categoryId, facilities, searchComplete, searchRadiusMeters = 0, provider,
  maxRouteCandidates = 4, mode = 'walking', thresholdSeconds = 900, signal,
} = {}) {
  if (!FACILITY_CATEGORY_IDS.includes(categoryId)) throw new RangeError('Only eight main facility categories are supported.');
  if (!validBd09ll(demandPoint?.location)) throw new TypeError('Invalid BD-09LL demand point.');
  if (!provider?.route) throw new TypeError('A route provider is required.');
  if (!['walking', 'cycling', 'driving'].includes(mode)
    || !Number.isFinite(thresholdSeconds) || thresholdSeconds <= 0) {
    throw new RangeError('Invalid travel mode or time threshold.');
  }
  if (!Number.isInteger(maxRouteCandidates) || maxRouteCandidates < 1 || maxRouteCandidates > 20) {
    throw new RangeError('Invalid route candidate limit.');
  }
  const dedupe = dedupeFacilityCandidates(facilities);
  const classified = dedupe.candidates.map((facility) => ({
    facility, classification: classifyFacilityCandidate({
      categoryId, name: facility.name, rawCategory: facility.rawCategory,
    }),
  }));
  const excludedCandidates = classified.filter(({ classification }) => classification.candidateStatus === 'excluded_by_rule')
    .map(({ facility, classification }) => ({ uid: facility.uid, excludedBy: classification.excludedBy }));
  const eligible = classified.filter(({ classification }) => classification.candidateStatus !== 'excluded_by_rule')
    .map(({ facility }) => facility);
  const effectiveSearchComplete = searchComplete === true && dedupe.invalidCount === 0;
  const geometryRank = (facility) => ({ inside: 0, boundary: 1, unknown: 2, outside: 3 })[
    facility.geometryAssessment?.status] ?? 2;
  const ordered = eligible.map((facility) => ({
    facility,
    straightLineMeters: straightDistanceMeters(demandPoint.location, facility.location),
  })).sort((a, b) => geometryRank(a.facility) - geometryRank(b.facility)
    || a.straightLineMeters - b.straightLineMeters
    || String(a.facility.uid ?? '').localeCompare(String(b.facility.uid ?? '')));
  const selected = ordered.slice(0, maxRouteCandidates);
  const routeTarget = (facility) => ({
    location: validBd09ll(facility.naviLocation) ? facility.naviLocation : facility.location,
    uid: facility.uid,
  });
  let batch = null;
  if (selected.length && provider.routeMany && provider.canBatch?.(mode, selected.length)) {
    try {
      batch = await provider.routeMany({
        origin: { location: demandPoint.location, uid: demandPoint.uid },
        destinations: selected.map(({ facility }) => routeTarget(facility)), mode, signal,
      });
      if (!Array.isArray(batch) || batch.length !== selected.length) batch = null;
    } catch { batch = null; }
  }
  let covered = false;
  let coveredByUid = null;
  const routes = [];
  for (const [index, { facility, straightLineMeters }] of selected.entries()) {
    let route = batch?.[index];
    if (!route) {
      try {
        route = await provider.route(demandPoint.location, routeTarget(facility).location, {
          mode, originUid: demandPoint.uid, destinationUid: facility.uid, signal,
        });
      } catch { route = { routeStatus: 'upstream_unavailable', durationSeconds: null }; }
    }
    const routeValid = route?.routeStatus === 'ok'
      && Number.isFinite(route.durationSeconds) && route.durationSeconds >= 0;
    const evidence = {
      evidenceId: 'facility-' + demandPoint.id + '-' + categoryId + '-' + (routes.length + 1),
      facilityUid: facility.uid,
      straightLineMeters: Math.round(straightLineMeters),
      routeStatus: routeValid ? 'ok' : route?.routeStatus === 'ok' ? 'invalid_route' : route?.routeStatus ?? 'upstream_unavailable',
      durationSeconds: routeValid ? route.durationSeconds : null,
      distanceMeters: routeValid ? route.distanceMeters : null,
      source: route?.source ?? null, mode,
    };
    routes.push(evidence);
    if (routeValid && route.durationSeconds <= thresholdSeconds && !covered) {
      covered = true;
      coveredByUid = facility.uid;
    }
    if (covered && !batch) break;
  }
  const successful = routes.filter((route) => route.routeStatus === 'ok' && Number.isFinite(route.durationSeconds));
  const shortestRouteSeconds = successful.length ? Math.min(...successful.map((route) => route.durationSeconds)) : null;
  const common = {
    demandPointId: demandPoint.id, categoryId, categoryMappingVersion: FACILITY_MAPPING_VERSION,
    mode, thresholdSeconds, shortestRouteSeconds,
    shortestWalkingSeconds: mode === 'walking' ? shortestRouteSeconds : null,
    routes, evidenceIds: routes.map((route) => route.evidenceId),
    candidatesFound: ordered.length, candidatesRetrieved: dedupe.candidates.length,
    candidatesRouted: routes.length, excludedCandidates, searchComplete: effectiveSearchComplete,
    duplicateUids: dedupe.duplicateUids, invalidCandidateCount: dedupe.invalidCount,
  };
  if (covered) return { ...common, coverageStatus: 'covered', coveredByUid };
  const allCandidatesRouted = routes.length === ordered.length;
  const allRoutesValid = routes.length > 0 && routes.every((r) => r.routeStatus === 'ok' && Number.isFinite(r.durationSeconds));
  const coverageStatus = !effectiveSearchComplete ? 'unknown_search'
    : allCandidatesRouted && allRoutesValid ? 'over_threshold' : 'unknown_route';
  return { ...common, coverageStatus, coveredByUid: null };
}

export function evaluateSpecialtyKilometerGap({
  specialtyId, origin, facilities, searchComplete, searchRadiusMeters = 0,
} = {}) {
  if (!P0_CATEGORY_IDS.includes(specialtyId)) throw new RangeError('Unknown specialty category.');
  const dedupe = dedupeFacilityCandidates(facilities);
  return {
    specialtyId, specialtyMappingVersion: 'p0-facility-categories-v1',
    ...assessKilometerGap({
      origin, facilities: dedupe.candidates,
      searchComplete: searchComplete === true && dedupe.invalidCount === 0,
      searchRadiusMeters,
    }),
    duplicateUids: dedupe.duplicateUids, invalidCandidateCount: dedupe.invalidCount,
  };
}

export function summarizeDemandCoverage(results) {
  const valid = results.filter((result) => result.coverageStatus !== 'not_applicable');
  const denominator = valid.length;
  const covered = valid.filter((result) => result.coverageStatus === 'covered').length;
  const overThreshold = valid.filter((result) => result.coverageStatus === 'over_threshold').length;
  const unknown = denominator - covered - overThreshold;
  return {
    numeratorCovered: covered, denominator, unknownCount: unknown, overThresholdCount: overThreshold,
    confirmedLowerBound: denominator ? covered / denominator : null,
    potentialUpperBound: denominator ? (covered + unknown) / denominator : null,
    unknownShare: denominator ? unknown / denominator : null,
  };
}
