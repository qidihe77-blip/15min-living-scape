import{decisionSeconds,BAIDU_TIME_MODEL}from'../web/walking-model.js';
import{accessContributions}from'../web/weighted-access.js';
import { createHash } from 'node:crypto';
import { FACILITY_CATEGORY_IDS, FACILITY_MAPPING_VERSION, FACILITY_GROUPS, FACILITY_GROUP_IDS,
  FACILITY_V3_MAPPING_VERSION, FACILITY_CLASSIFICATION_VERSION, facilityCategoryTree, facilityRequestVersion } from './facility-categories.mjs';

export const PRIORITY_SCORE_VERSION = 'facility-priority-score-v1';
export const SIX_GROUP_SCORE_VERSION = 'six-group-subtype-access-v1';

export function scoreSixGroupPriorities({ analysis, priorities = {}, selectedCategoryIds } = {}) {
  const mappingVersion = analysis?.categoryMappingVersion;
  const tree = facilityCategoryTree(mappingVersion);
  if (![3,4,5,6,7,8].includes(analysis?.version) || analysis.version !== facilityRequestVersion(mappingVersion)
    || analysis.mode !== 'walking' || analysis.thresholdSeconds !== 900
    || !Array.isArray(analysis.categories) || analysis.categories.length !== 6) {
    throw new TypeError('A complete version 3 six-group evidence structure is required.');
  }
  if (selectedCategoryIds != null && (!Array.isArray(selectedCategoryIds) || selectedCategoryIds.length !== 6
    || new Set(selectedCategoryIds).size !== 6 || selectedCategoryIds.some((id) => !FACILITY_GROUP_IDS.includes(id)))) {
    throw new RangeError('Display filters must not change the score denominator.');
  }
  if (!priorities || typeof priorities !== 'object' || Array.isArray(priorities)
    || Object.entries(priorities).some(([id, value]) => !FACILITY_GROUP_IDS.includes(id)
      || !Number.isInteger(value) || value < (analysis.version>=8?1:0) || value > (analysis.version>=8?3:6))) throw new RangeError('Invalid six-group priority.');
  const weights = Object.fromEntries(FACILITY_GROUP_IDS.map((id) => [id, priorities[id] ?? (analysis.version>=8?2:1)]));
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const groupMap = new Map(analysis.categories.map((group) => [group.categoryId, group]));
  let rows = tree.categories.map((group) => {
    const evidence = groupMap.get(group.id);
    if (!evidence || evidence.categoryMappingVersion !== mappingVersion
      || evidence.mode !== 'walking' || evidence.thresholdSeconds !== 900
      || !Array.isArray(evidence.subtypeResults) || evidence.subtypeResults.length !== group.subtypes.length) {
      throw new TypeError('Inconsistent group evidence or missing subtypes.');
    }
    const byId = new Map(evidence.subtypeResults.map((subtype) => [subtype.subtypeId, subtype]));
    const subtypes = group.subtypes.map((definition) => {
      const sub = byId.get(definition.id);
      if (!sub || sub.categoryId !== group.id || sub.categoryMappingVersion !== mappingVersion
        || sub.mode !== 'walking' || sub.thresholdSeconds !== 900 || !Array.isArray(sub.routes)
        || !['reachable', 'unknown', 'no_reachable_in_declared_search'].includes(sub.accessStatus)) {
        throw new TypeError('Inconsistent subtype evidence.');
      }
      const valid = (route) => validRoute(route) && Number.isFinite(route.distanceMeters) && route.distanceMeters >= 0
        && route.mode === 'walking' && route.coordinateSystem === 'BD-09LL'
        && route.classification?.candidateStatus === 'confirmed_by_rule';
      const witnesses = sub.routes.filter((route) => valid(route) && decisionSeconds(route,analysis.walkingModelId??BAIDU_TIME_MODEL)!==null && decisionSeconds(route,analysis.walkingModelId??BAIDU_TIME_MODEL) <= 900);
      if ((sub.accessStatus === 'reachable') !== (witnesses.length > 0)) throw new TypeError('Reachability lacks matching classified route evidence.');
      if (sub.accessStatus === 'no_reachable_in_declared_search' && (sub.searchComplete !== true
        || sub.nearestComplete !== true || (sub.unknownReasons?.length ?? 0) !== 0
        || sub.routes.length !== sub.confirmedCandidateCount || !sub.routes.every((route) => valid(route) && decisionSeconds(route,analysis.walkingModelId??BAIDU_TIME_MODEL)!==null && decisionSeconds(route,analysis.walkingModelId??BAIDU_TIME_MODEL) > 900))) {
        throw new TypeError('Absence lacks complete declared-search evidence.');
      }
      return { subtypeId: definition.id, label: definition.label, accessStatus: sub.accessStatus,
        reachable: witnesses.length ? 1 : 0, unknown: !witnesses.length && sub.accessStatus === 'unknown' ? 1 : 0,
        nearestStatus: sub.nearestStatus, evidenceIds: [...(sub.evidenceIds ?? [])] };
    });
    const reachable = subtypes.reduce((sum, sub) => sum + sub.reachable, 0);
    const unknown = subtypes.reduce((sum, sub) => sum + sub.unknown, 0);
    const low = 100 * reachable / subtypes.length, high = 100 * (reachable + unknown) / subtypes.length;
    const normalizedWeight = total ? weights[group.id] / total : 0;
    return { categoryId: group.id, label: group.label, priority: weights[group.id],
      normalizedWeight: round(normalizedWeight), totalSubtypeCount: subtypes.length,
      reachableSubtypeCount: reachable, unknownSubtypeCount: unknown,
      G_low: round(low), G_high: round(high), contributionLow: round(low * normalizedWeight),
      contributionHigh: round(high * normalizedWeight), subtypes,
      evidenceIds: [...new Set(subtypes.flatMap((sub) => sub.evidenceIds))] };
  });
  const evidenceFingerprint = createHash('sha256').update(JSON.stringify({
    categoryTree: tree.categories, classificationVersion: tree.classificationVersion,
    mappingVersion, walkingModel:analysis.walkingModel, analysisVersion: analysis.algorithmVersion,
    nearestVersion: analysis.nearestAlgorithmVersion, origin: analysis.origin, analysisLocation: analysis.analysisLocation, region: analysis.region,
    mode: analysis.mode, thresholdSeconds: analysis.thresholdSeconds, radius: analysis.searchRadiusMeters,
    observedAt: analysis.observedAt, categories: FACILITY_GROUP_IDS.map((id) => groupMap.get(id)),
  })).digest('hex');
  const unified=analysis.version>=8?accessContributions(rows):null;if(unified)rows=unified.categories;
  const low = unified?unified.S_low:total ? rows.reduce((sum, row) => sum + weights[row.categoryId] * row.G_low, 0) / total : null;
  const high = unified?unified.S_high:total ? rows.reduce((sum, row) => sum + weights[row.categoryId] * row.G_high, 0) / total : null;
  return { formulaVersion: SIX_GROUP_SCORE_VERSION, priorityScheme:unified?'p123-fixed-v1':'legacy-descending-tiers',calculationPrecision:unified?'full_precision_shared_contributions':'legacy_six_decimals', evidenceVersion: analysis.algorithmVersion,
    evidenceSnapshotId: analysis.analysisId ?? evidenceFingerprint.slice(0, 16), evidenceFingerprint,
    categoryMappingVersion: mappingVersion, scoreStatus: total ? 'scored' : 'not_requested',
    mode: 'walking', thresholdSeconds: 900, selectedCategoryIds: [...FACILITY_GROUP_IDS], priorities: weights,
    positiveWeightTotal: total, normalizedWeights: Object.fromEntries(rows.map((row) => [row.categoryId, row.normalizedWeight])),
    S_low: low == null ? null : unified?low:round(low), S_high: high == null ? null : unified?high:round(high),
    isExact: total > 0 && low === high, unknownWeight: total ? round((high - low) / 100) : 0,
    categories: rows, interpretation: 'preference_weighted_subtype_access_existence' };
}
const COVERAGE_STATUSES = new Set(['covered', 'over_threshold', 'unknown_search', 'unknown_route']);
const UNKNOWN_STATUSES = new Set(['unknown_search', 'unknown_route']);

function round(value) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function validRoute(route) {
  return route?.routeStatus === 'ok'
    && Number.isFinite(route.durationSeconds) && route.durationSeconds >= 0;
}

function validateEvidence(category, thresholdSeconds) {
  const routes = category.routes;
  if (!Array.isArray(routes)) throw new TypeError('Each scored category needs route evidence.');
  if (category.coverageStatus === 'covered'
    && !routes.some((route) => validRoute(route) && route.durationSeconds <= thresholdSeconds)) {
    throw new TypeError('Covered category lacks an in-threshold route.');
  }
  if (category.coverageStatus === 'over_threshold'
    && (category.searchComplete !== true || routes.length === 0
      || routes.length !== category.candidatesFound
      || !routes.every((route) => validRoute(route) && route.durationSeconds > thresholdSeconds))) {
    throw new TypeError('Over-threshold category lacks complete route evidence.');
  }
}

export function scoreFacilityPriorities({ analysis, selectedCategoryIds, priorities = {} } = {}) {
  if (!analysis || !Array.isArray(analysis.categories)
    || typeof analysis.algorithmVersion !== 'string' || !analysis.algorithmVersion
    || analysis.categoryMappingVersion !== FACILITY_MAPPING_VERSION
    || !['walking', 'cycling', 'driving'].includes(analysis.mode)
    || !Number.isFinite(analysis.thresholdSeconds) || analysis.thresholdSeconds <= 0) {
    throw new TypeError('A versioned eight-category route analysis is required.');
  }
  if (!priorities || typeof priorities !== 'object' || Array.isArray(priorities)) {
    throw new TypeError('Priorities must be a category-to-integer object.');
  }
  for (const [id, value] of Object.entries(priorities)) {
    if (!FACILITY_CATEGORY_IDS.includes(id) || !Number.isInteger(value) || value < 0 || value > 5) {
      throw new RangeError('Priority values must be integers from 0 to 5 for the eight categories.');
    }
  }

  const byId = new Map();
  for (const category of analysis.categories) {
    if (!FACILITY_CATEGORY_IDS.includes(category?.categoryId) || byId.has(category.categoryId)
      || !COVERAGE_STATUSES.has(category.coverageStatus)
      || category.categoryMappingVersion !== FACILITY_MAPPING_VERSION
      || category.mode !== analysis.mode || category.thresholdSeconds !== analysis.thresholdSeconds) {
      throw new TypeError('Analysis category evidence is inconsistent.');
    }
    byId.set(category.categoryId, category);
  }
  const selected = selectedCategoryIds ?? analysis.categories.map((category) => category.categoryId);
  if (!Array.isArray(selected) || !selected.length || new Set(selected).size !== selected.length
    || selected.some((id) => !FACILITY_CATEGORY_IDS.includes(id) || !byId.has(id))) {
    throw new RangeError('Select unique categories already present in this evidence snapshot.');
  }

  const selectedPriorities = Object.fromEntries(selected.map((id) => [id, priorities[id] ?? 1]));
  const positiveWeightTotal = Object.values(selectedPriorities).reduce((sum, value) => sum + value, 0);
  if (positiveWeightTotal === 0) throw new RangeError('At least one selected category must have positive priority.');

  const scoredCategories = selected.map((id) => {
    const category = byId.get(id);
    const priority = selectedPriorities[id];
    if (priority > 0) validateEvidence(category, analysis.thresholdSeconds);
    const normalizedWeight = priority / positiveWeightTotal;
    const covered = category.coverageStatus === 'covered';
    const unknown = UNKNOWN_STATUSES.has(category.coverageStatus);
    return {
      categoryId: id, priority, normalizedWeight: round(normalizedWeight),
      coverageStatus: category.coverageStatus,
      contributionLow: covered ? round(100 * normalizedWeight) : 0,
      contributionHigh: covered || unknown ? round(100 * normalizedWeight) : 0,
      shortestRouteSeconds: category.shortestRouteSeconds ?? null,
      evidenceIds: Array.isArray(category.evidenceIds) ? [...category.evidenceIds] : [],
    };
  });
  const coveredPriority = scoredCategories.reduce((sum, row) => sum + (row.coverageStatus === 'covered' ? row.priority : 0), 0);
  const unknownPriority = scoredCategories.reduce((sum, row) => sum + (UNKNOWN_STATUSES.has(row.coverageStatus) ? row.priority : 0), 0);
  const evidenceFingerprint = createHash('sha256').update(JSON.stringify({
    algorithmVersion: analysis.algorithmVersion,
    categoryMappingVersion: analysis.categoryMappingVersion,
    origin: analysis.origin,
    mode: analysis.mode,
    thresholdSeconds: analysis.thresholdSeconds,
    geometrySource: analysis.geometrySource,
    categories: FACILITY_CATEGORY_IDS.filter((id) => byId.has(id)).map((id) => byId.get(id)),
  })).digest('hex');

  return {
    formulaVersion: PRIORITY_SCORE_VERSION,
    evidenceVersion: analysis.algorithmVersion,
    evidenceSnapshotId: analysis.analysisId ?? analysis.id ?? evidenceFingerprint.slice(0, 16),
    evidenceFingerprint,
    categoryMappingVersion: FACILITY_MAPPING_VERSION,
    mode: analysis.mode, thresholdSeconds: analysis.thresholdSeconds,
    selectedCategoryIds: [...selected], priorities: selectedPriorities,
    normalizedWeights: Object.fromEntries(scoredCategories.map((row) => [row.categoryId, row.normalizedWeight])),
    positiveWeightTotal,
    S_low: round(100 * coveredPriority / positiveWeightTotal),
    S_high: round(100 * (coveredPriority + unknownPriority) / positiveWeightTotal),
    unknownWeight: round(unknownPriority / positiveWeightTotal),
    isExact: unknownPriority === 0,
    categories: scoredCategories,
  };
}
