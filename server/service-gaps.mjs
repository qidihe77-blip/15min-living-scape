import { FACILITY_V3_MAPPING_VERSION, FACILITY_V4_MAPPING_VERSION, FACILITY_V5_MAPPING_VERSION, FACILITY_V6_MAPPING_VERSION,FACILITY_V7_MAPPING_VERSION,FACILITY_V8_MAPPING_VERSION, getFacilitySubtype, classifySubtypeCandidate,facilityCategoryTree } from './facility-categories.mjs';
import { straightDistanceMeters } from './facility-coverage.mjs';
import { validBd09ll } from './walking-provider.mjs';
import{boundWalkingEvidence}from'../web/reachable-presentation.js';
import{specialtyEvidenceRecords}from'./specialty-gap-evidence.mjs';

export const SERVICE_GAP_VERSION = 'six-group-walking-1km-v1';
export const SPECIALTY_SUBTYPE_IDS = Object.freeze(['market', 'pharmacy', 'primary_school']);
const finiteCost = (route) => route?.routeStatus === 'ok' && route.mode === 'walking'
  && route.coordinateSystem === 'BD-09LL' && Number.isFinite(route.distanceMeters) && route.distanceMeters >= 0
  && Number.isFinite(route.durationSeconds) && route.durationSeconds >= 0;
function summary(rows) {
  const absent = rows.filter((row) => row.status === 'absent_in_declared_search');
  const unknown = rows.filter((row) => row.status === 'unknown');
  return { presentCount: rows.filter((row) => row.status === 'present').length,
    absentCount: absent.length, unknownCount: unknown.length,
    anyMissing: absent.length ? true : unknown.length ? null : false,
    allThreeMissing: absent.length === 3 ? true : rows.some((row) => row.status === 'present') ? false : null };
}
function diagnostic(candidates, complete, reasons, nearestKey) {
  candidates.sort((a,b) => a[nearestKey]-b[nearestKey] || String(a.identityKey).localeCompare(String(b.identityKey)));
  const nearby = candidates.filter((row) => row[nearestKey] <= 1000);
  const status = nearby.length ? 'present' : complete ? 'absent_in_declared_search' : 'unknown';
  return { status, thresholdMeters: 1000, noFacilityWithinOneKilometer: status === 'present' ? false
    : status === 'absent_in_declared_search' ? true : null,
    nearbyCountLowerBound: nearby.length, nearestVerified: candidates[0] ?? null,
    nearestWithinOneKilometer: nearby[0] ?? null, evidenceComplete: complete,
    evidenceIds: [...new Set(candidates.map((row) => row.evidenceId).filter(Boolean))], unknownReasons: [...new Set(reasons)] };
}

// Pure evidence reuse: no provider, retries, interpolation or inferred 900-second distance.
export function assessServiceGaps(analysis) {
  if (![3,4,5,6,7,8].includes(analysis?.version) || ![FACILITY_V3_MAPPING_VERSION,FACILITY_V4_MAPPING_VERSION,FACILITY_V5_MAPPING_VERSION,FACILITY_V6_MAPPING_VERSION,FACILITY_V7_MAPPING_VERSION,FACILITY_V8_MAPPING_VERSION].includes(analysis.categoryMappingVersion)
    || !validBd09ll(analysis.origin?.location) || analysis.mode !== 'walking' || analysis.thresholdSeconds !== 900) {
    throw new TypeError('Current six-group walking evidence is required.');
  }
  let specialties = SPECIALTY_SUBTYPE_IDS.map((subtypeId) => {
    const definition = getFacilitySubtype(subtypeId,analysis.categoryMappingVersion);
    const sub = analysis.categories.find((group) => group.categoryId === definition.categoryId)
      ?.subtypeResults.find((row) => row.subtypeId === subtypeId);
    const markers = (analysis.poiMarkers ?? []).filter((marker) => classifySubtypeCandidate({ ...marker, subtypeId,categoryMappingVersion:analysis.categoryMappingVersion })
      .candidateStatus === 'confirmed_by_rule');
    const seen = new Set();
    const routes = (sub?.routes ?? []).filter((row) => {
      const marker = markers.find((item) => item.identityKey === row.identityKey);
      if (!marker || row.subtypeId !== subtypeId || row.categoryId !== definition.categoryId
        || row.classification?.candidateStatus !== 'confirmed_by_rule' || !finiteCost(row)
        || row.destinationConflict || !boundWalkingEvidence({...marker,routeEvidence:row},analysis.origin)
        || seen.has(row.identityKey)) return false;
      seen.add(row.identityKey); return true;
    });
    const reasons = [...(sub?.unknownReasons ?? [])];
    // A 1km disk about an independent origin is not necessarily inside the Place window.
    if(analysis.analysisLocation && straightDistanceMeters(analysis.origin.location,analysis.searchWindow?.center??analysis.analysisLocation.location)+1000>analysis.searchRadiusMeters)
      reasons.push('origin_1km_window_not_fully_searched');
    if (!sub?.searchComplete || sub.searchTruncated || !(analysis.searchRadiusMeters >= 1000)) reasons.push('search_window_incomplete');
    if (sub?.pendingClassificationCount) reasons.push('classification_pending');
    if (routes.length < markers.length || sub?.confirmedCandidateCount !== routes.length) reasons.push('routes_not_fully_verified');
    if (markers.some((marker) => marker.destinationConflict)) reasons.push('destination_variants_unverified');
    const complete = Boolean(sub?.searchComplete && !sub.searchTruncated && analysis.searchRadiusMeters >= 1000
      && !sub.pendingClassificationCount && !sub.invalidCandidateCount && reasons.length === 0
      && routes.length === markers.length && sub.confirmedCandidateCount === routes.length);
    const geometric = markers.filter((row) => validBd09ll(row.location)).map((row) => ({
      identityKey: row.identityKey, facilityUid: row.uid, name: row.name, location: row.location,
      straightLineMeters: straightDistanceMeters(analysis.origin.location, row.location) }));
    const geometricReasons = reasons.filter((reason) => !['candidate_limit_reached','route_incomplete','routes_not_fully_verified'].includes(reason));
    const geometricComplete = Boolean(sub?.searchComplete && !sub.searchTruncated && analysis.searchRadiusMeters >= 1000
      && !sub.pendingClassificationCount && !sub.invalidCandidateCount && !geometricReasons.length);
    return { subtypeId, categoryId: definition.categoryId, label: definition.label,
      definitionNote: subtypeId === 'market' ? '包括按当前分类规则确认的菜市场、农贸市场与菜店。' : null,
      searchRadiusMeters: analysis.searchRadiusMeters, searchComplete: sub?.searchComplete === true,
      searchEvidence: { source: 'existing_subtype_evidence', subtypeId,
        status: sub?.searchStatus ?? 'unknown', complete: sub?.searchComplete === true,
        truncated: sub?.searchTruncated ?? true, pages: sub?.searchPages ?? [], errors: sub?.searchErrors ?? [],
        confirmedCandidateCount: sub?.confirmedCandidateCount ?? 0,
        pendingClassificationCount: sub?.pendingClassificationCount ?? 0, candidatesRouted: sub?.candidatesRouted ?? 0 },
      walking_1km_gap: diagnostic(routes, complete, reasons, 'distanceMeters'),
      geometric_1km_gap: { ...diagnostic(geometric, geometricComplete, geometricReasons, 'straightLineMeters'),
        referenceOnly: true, distanceDefinition: 'geometric_distance_to_poi' } };
  });
  // One common task-scoped evaluator for all three specialties. The inherited
  // group flags above remain a fallback only for old records without task pages.
  const scoped=specialtyEvidenceRecords({analysis,serviceGaps:{specialties}},facilityCategoryTree(analysis.categoryMappingVersion));
  specialties=specialties.map(row=>{const own=scoped.find(s=>s.subtypeId===row.subtypeId);return own&&!own.legacyEvidence?{...row,searchComplete:own.searchComplete,searchEvidence:{...row.searchEvidence,...own.search,complete:own.searchComplete,truncated:!own.searchComplete},walking_1km_gap:own.diagnostic}:row;});
  const walking = summary(specialties.map((row) => row.walking_1km_gap));
  const geometric = summary(specialties.map((row) => row.geometric_1km_gap));
  const missing = specialties.filter((row) => row.walking_1km_gap.status === 'absent_in_declared_search');
  return { version: SERVICE_GAP_VERSION, categoryMappingVersion: analysis.categoryMappingVersion,
    scope: 'origin_point_only', distanceDefinition: 'provider_walking_distance_meters', thresholdMeters: 1000,
    origin: structuredClone(analysis.origin), observedAt: analysis.observedAt, specialties,
    walking, geometric, regionalAssessment: { status: 'not_requested', pointCount: 0,
      reason: 'No sourced demand points or additional regional request budget were configured.' },
    geojson: { type: 'FeatureCollection', features: missing.length ? [{ type: 'Feature',
      geometry: { type: 'Point', coordinates: [analysis.origin.location.lng, analysis.origin.location.lat] },
      properties: { featureType: 'walking_1km_gap_point', coordinateSystem: 'BD-09LL', scope: 'origin_point_only',
        status: 'absent_in_declared_search', missingSubtypeIds: missing.map((row) => row.subtypeId),
        allThreeMissing: walking.allThreeMissing, evidenceIds: missing.flatMap((row) => row.walking_1km_gap.evidenceIds),
        areaClaim: false } }] : [] } };
}

// Optional finite, already measured demand-point set; never launches new Place/Route calls.
export function assessServiceGapPoints(points, { maxPoints = 0, source } = {}) {
  if (!Array.isArray(points) || !Number.isInteger(maxPoints) || maxPoints < 0 || maxPoints > 32
    || points.length > maxPoints || typeof source !== 'string' || !source.trim()) {
    throw new RangeError('Sourced demand points and an explicit finite limit (0–32) are required.');
  }
  const ids = points.map((point) => point?.origin?.id);
  if (ids.some((id) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) throw new TypeError('Demand point IDs must be unique.');
  return { scope: 'finite_sourced_demand_points', source, pointCount: points.length, maxPoints,
    populationCoverage: null, communityAreaCoverage: null, newRequests: 0,
    points: points.map(assessServiceGaps) };
}
