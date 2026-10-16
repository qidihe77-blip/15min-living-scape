import{orderedBatches}from'./bounded-batches.mjs';
import { assessWalkingCost, generateBoundedRuleGrid, PHASE4_CONFIG } from './travel-cost-analysis.mjs';

const METERS_PER_DEGREE = 111_320;
const SECTOR_COUNT = 8;
export const ISOCHRONE_VERSION = 'walking-sample-cells-v2';
export const SAMPLING_BUDGET_PROFILES = Object.freeze({ low: 24, medium: 48, high: 88 });

function offsetPoint(center, north, east) {
  return {
    lat: center.lat + north / METERS_PER_DEGREE,
    lng: center.lng + east / (METERS_PER_DEGREE * Math.cos(center.lat * Math.PI / 180)),
  };
}
function sampleSector(point) {
  const angle = (Math.atan2(point.northOffsetMeters, point.eastOffsetMeters) + 2 * Math.PI) % (2 * Math.PI);
  return Math.floor(((angle + Math.PI / SECTOR_COUNT) % (2 * Math.PI)) / (2 * Math.PI / SECTOR_COUNT));
}
export function orderDirectionalSamples(grid) {
  if (!Array.isArray(grid)) throw new TypeError('A sampling grid is required.');
  const sectors = Array.from({ length: SECTOR_COUNT }, () => []);
  for (const point of grid) {
    if (point.offsetMeters !== 0) sectors[sampleSector(point)].push(point);
  }
  for (const sector of sectors) {
    sector.sort((a, b) => a.offsetMeters - b.offsetMeters
      || a.northOffsetMeters - b.northOffsetMeters || a.eastOffsetMeters - b.eastOffsetMeters);
  }
  const result = [];
  let round = 0;
  while (sectors.some((sector) => round < sector.length)) {
    for (const sector of sectors) if (sector[round]) result.push(sector[round]);
    round += 1;
  }
  return result;
}
function sampleCell(center, sample, sideMeters) {
  const half = sideMeters / 2;
  const corners = [[-half, -half], [-half, half], [half, half], [half, -half], [-half, -half]];
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [corners.map(([dn, de]) => {
      const point = offsetPoint(center, sample.northOffsetMeters + dn, sample.eastOffsetMeters + de);
      return [point.lng, point.lat];
    })] },
    properties: {
      evidenceId: sample.evidenceId,
      featureType: sample.sampleStage === 'coarse' ? 'sample_cell' : 'refined_sample_cell',
      coverageStatus: sample.coverageStatus,
      durationSeconds: sample.durationSeconds,
      routeStatus: sample.routeStatus,
      decisionSource: sample.decisionSource,
      geometryConfidence: 'visual_proxy_at_sample_only',
      geometrySource: 'walking_sampling_fallback',
      coordinateSystem: 'BD-09LL',
      distanceMeters: sample.distanceMeters, retrievedAt: sample.retrievedAt ?? null,
      sampleStage: sample.sampleStage, supportScope: 'tested_destination_proxy_only',
    },
  };
}
function unknownStudyDisk(center, radiusMeters) {
  const ring = [];
  for (let i = 0; i <= 72; i += 1) {
    const radians = i * 2 * Math.PI / 72;
    const point = offsetPoint(center, Math.cos(radians) * radiusMeters, Math.sin(radians) * radiusMeters);
    ring.push([point.lng, point.lat]);
  }
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: {
      evidenceId: 'study-disk-unknown', featureType: 'unsampled_study_disk',
      coverageStatus: 'unknown', geometryConfidence: 'visual_study_extent_only',
      geometrySource: 'walking_sampling_fallback', coordinateSystem: 'BD-09LL',
    },
  };
}
function key(north, east) { return north + ',' + east; }
function classify(point, route, stage) {
  const inputRoute = route && typeof route === 'object' ? route : { routeStatus: 'upstream_unavailable' };
  const safeRoute = inputRoute.routeStatus === 'ok' && point.offsetMeters > 0
    && Number.isFinite(inputRoute.distanceMeters) && inputRoute.distanceMeters > 4 * point.offsetMeters
    ? { ...inputRoute, routeStatus: 'route_anomalous_detour' } : inputRoute;
  const decision = assessWalkingCost(safeRoute);
  return {
    ...point, ...decision,
    decisionSource: safeRoute.localOrigin ? 'local_origin_identity' : decision.decisionSource,
    evidenceId: 'iso-' + point.gridId, sampleStage: stage,
    sector: point.offsetMeters === 0 ? null : sampleSector(point),
  };
}
function unsampled(point, reason) {
  return classify(point, { routeStatus: reason, durationSeconds: null }, 'unsampled');
}
function shouldStopAfter(route) {
  return route?.routeStatus === 'route_service_error' || route?.routeStatus === 'upstream_http_error'
    || route?.routeStatus === 'route_request_limit_reached' || route?.routeStatus === 'rate_limited'
    || route?.routeStatus === 'permission_denied' || route?.routeStatus === 'quota_exhausted'
    || route?.routeStatus === 'upstream_unavailable';
}

export async function buildIsochrone({
  center, provider,
  strictEvidence = false, originUid = null,
  radiusMeters = PHASE4_CONFIG.gridRadiusMeters,
  spacingMeters = PHASE4_CONFIG.gridSpacingMeters,
  maxGridPoints = PHASE4_CONFIG.maxGridPoints,
  maxRefinementPoints = 8,
  maxRouteCalls = SAMPLING_BUDGET_PROFILES.high,
  minValidSamples = 4,
  minValidSectors = 3,
  onProgress = () => {},
  signal,
} = {}) {
  if (!provider?.route) throw new TypeError('A walking provider is required.');
  if (!Number.isInteger(maxRefinementPoints) || maxRefinementPoints < 0 || maxRefinementPoints > 20) {
    throw new RangeError('Invalid refinement limit.');
  }
  if (!Number.isInteger(maxRouteCalls) || maxRouteCalls < 0 || maxRouteCalls > PHASE4_CONFIG.maxWalkingRequests) {
    throw new RangeError('Invalid sampling route budget.');
  }
  if (!Number.isInteger(minValidSamples) || minValidSamples < 1 || minValidSamples > 80
    || !Number.isInteger(minValidSectors) || minValidSectors < 1 || minValidSectors > SECTOR_COUNT) {
    throw new RangeError('Invalid minimum sampling evidence.');
  }
  const grid = generateBoundedRuleGrid(center, { radiusMeters, spacingMeters, maxPoints: maxGridPoints });
  const verify = (point,route) => {
    if(!strictEvidence || route?.routeStatus!=='ok')return route;
    const same=(actual,expected,uid)=>actual && Number.isFinite(actual.location?.lat)&&Number.isFinite(actual.location?.lng)
      && Math.abs(actual.location.lat-expected.lat)<=.000001 && Math.abs(actual.location.lng-expected.lng)<=.000001
      && (actual.uid ?? null)===(uid ?? null);
    return route.mode==='walking' && route.coordinateSystem==='BD-09LL'
      && same(route.requestedOrigin,center,originUid) && same(route.requestedDestination,point,null)
      ?route:{routeStatus:'invalid_route_binding',durationSeconds:null,distanceMeters:null};
  };
  const origin = grid.find((point) => point.offsetMeters === 0);
  if (!origin) throw new TypeError('Sampling grid must contain its origin.');
  const ordered = orderDirectionalSamples(grid);
  const reserveForRefinement = Math.min(maxRefinementPoints, Math.floor(maxRouteCalls / 8));
  const coarseCallLimit = Math.min(ordered.length, maxRouteCalls - reserveForRefinement);
  const selected = ordered.slice(0, coarseCallLimit);
  const byId = new Map([[origin.gridId, classify(origin, {
    routeStatus: 'ok', durationSeconds: 0, distanceMeters: 0, localOrigin: true,
  }, 'coarse')]]);
  let cursor = 0;
  let routeCalls = 0;
  let completed = 1;
  let stoppedReason = null;
  const workers = Array.from({ length: Math.min(PHASE4_CONFIG.maxConcurrentWalkingRequests, selected.length) }, async () => {
    while (cursor < selected.length) {
      if (signal?.aborted) throw signal.reason ?? new Error('Sampling cancelled.');
      const point = selected[cursor++];
      if (stoppedReason || provider.stats?.().stopped) {
        byId.set(point.gridId, unsampled(point, stoppedReason || 'provider_stopped'));
        completed += 1;
        continue;
      }
      routeCalls += 1;
      let route;
      try {
        route = verify(point,await provider.route(center, point,{originUid}));
      } catch {
        route = { routeStatus: 'upstream_unavailable', durationSeconds: null };
      }
      byId.set(point.gridId, classify(point, route, 'coarse'));
      if (shouldStopAfter(route) || provider.stats?.().stopped) {
        stoppedReason = route?.routeStatus || 'provider_stopped';
      }
      completed += 1;
      onProgress({ phase: 'coarse', completed, total: grid.length, routeCalls });
    }
  });
  await Promise.all(workers);
  for (const point of grid) if (!byId.has(point.gridId)) {
    byId.set(point.gridId, unsampled(point, stoppedReason || 'not_sampled_budget'));
  }
  const samples = grid.map((point) => byId.get(point.gridId));
  const byOffset = new Map(samples.map((sample) => [key(sample.northOffsetMeters, sample.eastOffsetMeters), sample]));
  const edges = [];
  for (const sample of samples) {
    if (sample.sampleStage === 'unsampled') continue;
    for (const [dn, de] of [[spacingMeters, 0], [0, spacingMeters]]) {
      const next = byOffset.get(key(sample.northOffsetMeters + dn, sample.eastOffsetMeters + de));
      if (next && next.sampleStage !== 'unsampled' && next.coverageStatus !== sample.coverageStatus) {
        edges.push([sample, next]);
      }
    }
  }
  const refinableEdges = edges.filter(([a, b]) => a.coverageStatus !== 'unknown' && b.coverageStatus !== 'unknown');
  refinableEdges.sort((a, b) => {
    const proximity = ([x, y]) => Math.abs(x.durationSeconds - 900) + Math.abs(y.durationSeconds - 900);
    return proximity(a) - proximity(b);
  });
  const refined = [];
  const refinementLimit = Math.min(maxRefinementPoints, maxRouteCalls - routeCalls, refinableEdges.length);
  await orderedBatches(refinableEdges.slice(0,refinementLimit),async ([a,b],index)=>{
    if (signal?.aborted) throw signal.reason ?? new Error('Sampling cancelled.');
    if (stoppedReason || provider.stats?.().stopped) return;
    const north = (a.northOffsetMeters + b.northOffsetMeters) / 2;
    const east = (a.eastOffsetMeters + b.eastOffsetMeters) / 2;
    const point = {
      gridId: 'r-' + String(index + 1).padStart(3, '0'),
      northOffsetMeters: north, eastOffsetMeters: east,
      offsetMeters: Math.hypot(north, east),
      ...offsetPoint(center, north, east),
    };
    routeCalls += 1;
    let route;
    try {
      route = verify(point,await provider.route(center, point,{originUid}));
    } catch {
      route = { routeStatus: 'upstream_unavailable', durationSeconds: null };
    }
    refined.push(classify(point, route, 'boundary_refinement'));
    if (shouldStopAfter(route) || provider.stats?.().stopped) stoppedReason = route?.routeStatus || 'provider_stopped';
    onProgress({ phase: 'refinement', completed: refined.length, total: refinementLimit, routeCalls });
  },{concurrency:PHASE4_CONFIG.maxConcurrentWalkingRequests,signal});
  refined.sort((a,b)=>a.gridId.localeCompare(b.gridId));
  const all = [...samples, ...refined];
  const validNonOrigin = all.filter((s) => s.decisionSource === 'baidu_walking_duration');
  const validSectors = new Set(validNonOrigin.map((s) => s.sector));
  const geometryStatus = validNonOrigin.length >= minValidSamples && validSectors.size >= minValidSectors
    ? 'sampled_approximation' : 'unknown';
  const counts = {
    covered: all.filter((s) => s.coverageStatus === 'covered').length,
    overThreshold: all.filter((s) => s.coverageStatus === 'over_threshold').length,
    unknown: all.filter((s) => s.coverageStatus === 'unknown').length,
    coarse: samples.length, refined: refined.length, uncertainEdges: edges.length,
    unsampled: samples.filter((s) => s.sampleStage === 'unsampled').length,
    validNonOrigin: validNonOrigin.length,
  };
  const boundaryFeatures = geometryStatus === 'sampled_approximation' ? edges.map(([a, b], index) => ({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[a.lng, a.lat], [b.lng, b.lat]] },
    properties: {
      evidenceId: 'boundary-' + (index + 1), featureType: 'uncertain_boundary',
      coverageStatus: 'unknown', endpointEvidenceIds: [a.evidenceId, b.evidenceId],
      geometryConfidence: 'uncertain_no_interpolation', coordinateSystem: 'BD-09LL',
      geometrySource: 'walking_sampling_fallback',
    },
  })) : [];
  return {
    algorithmVersion: ISOCHRONE_VERSION,
    geometrySource: 'walking_sampling_fallback',
    geometryStatus, coordinateSystem: 'BD-09LL', center, originUid, thresholdSeconds: 900,
    method: 'direction_balanced_grid_with_boundary_refinement',
    radiusMeters, spacingMeters, refinementSpacingMeters: spacingMeters / 2,
    status: counts.unknown || counts.uncertainEdges || geometryStatus === 'unknown' ? 'partial' : 'complete',
    counts, samples: all,
    unknownRegions: {coordinateSystem:'BD-09LL',outsideStudyAreaStatus:'unknown',
      continuousRangeAvailable:false,supportScope:'tested_destination_proxy_only',
      unmeasuredPoints:all.filter(s=>s.sampleStage==='unsampled').map(s=>({location:{lat:s.lat,lng:s.lng},reasonCode:s.routeStatus})),
      failedPoints:all.filter(s=>s.sampleStage!=='unsampled' && s.coverageStatus==='unknown').map(s=>({location:{lat:s.lat,lng:s.lng},reasonCode:s.routeStatus})),
      uncertainEdges:edges.map(([a,b])=>({endpointEvidenceIds:[a.evidenceId,b.evidenceId],status:'unknown_no_interpolation'})),
      betweenSamplesStatus:'unknown'},
    sampleMetrics: {
      plannedGridPoints: grid.length, attemptedRouteCalls: routeCalls,
      maxRouteCalls, validRoutePoints: validNonOrigin.length, validSectors: validSectors.size,
      unknownShare: all.length ? counts.unknown / all.length : 1,
      unsampledShare: grid.length ? counts.unsampled / grid.length : 1,
      boundaryResolutionMeters: spacingMeters / 2,
      errorBoundStatus: 'not_statistically_estimated',
      stoppedReason,
      providerFailure:provider.stats?.().lastFailure ?? null,
      supportScope: 'tested_destination_proxy_only', continuousRangeAvailable: false,
    },
    geojson: {
      type: 'FeatureCollection',
      features: [
        unknownStudyDisk(center, radiusMeters),
        ...all.filter((sample) => sample.coverageStatus === 'covered' && sample.routeStatus === 'ok'
          && sample.geometry && sample.mode === 'walking' && sample.coordinateSystem === 'BD-09LL').map((sample) => ({
          type: 'Feature', geometry: sample.geometry,
          properties: { featureType: 'reachable_route', evidenceId: sample.evidenceId,
            routeStatus: sample.routeStatus, mode: sample.mode, coordinateSystem: sample.coordinateSystem,
            durationSeconds: sample.durationSeconds, distanceMeters: sample.distanceMeters,
            retrievedAt: sample.retrievedAt, geometrySource: 'walking_sampling_fallback',
            durationScope: 'whole_route', geometryConfidence: 'provider_path_partial_network' },
        })),
        ...(geometryStatus === 'sampled_approximation'
          ? [...samples.filter((s) => s.sampleStage !== 'unsampled').map((s) => sampleCell(center, s, spacingMeters / 2)),
            ...refined.map((s) => sampleCell(center, s, spacingMeters / 4)), ...boundaryFeatures]
          : []),
      ],
    },
    warnings: [
      'Sample cells are visual proxies around tested points, not verified coverage of every location within each cell.',
      'Different adjacent statuses form uncertain boundaries; no route time is interpolated across roads or rivers.',
      'The study area has no verified administrative community boundary.',
      ...(geometryStatus === 'unknown' ? ['Insufficient valid routes across directions; no approximate covered layer is published.'] : []),
    ],
  };
}
