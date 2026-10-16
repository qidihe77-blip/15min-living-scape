import { createHash } from 'node:crypto';

export const PHASE4_CONFIG = Object.freeze({
  algorithmVersion: 'walking-grid-cost-v1',
  coordinateSystem: 'BD-09LL',
  thresholdSeconds: 900,
  gridRadiusMeters: 1500,
  gridSpacingMeters: 300,
  maxGridPoints: 90,
  maxWalkingRequests: 220,
  maxConcurrentWalkingRequests: 2,
  requestTimeoutMs: 10_000,
  retryCount: 0,
  cacheTtlSeconds: 1800,
  fallbackMode: 'straight_line_reference_only',
});

const EARTH_METERS_PER_DEGREE = 111_320;

export function generateBoundedRuleGrid(center, overrides = {}) {
  const radiusMeters = overrides.radiusMeters ?? PHASE4_CONFIG.gridRadiusMeters;
  const spacingMeters = overrides.spacingMeters ?? PHASE4_CONFIG.gridSpacingMeters;
  const maxPoints = overrides.maxPoints ?? PHASE4_CONFIG.maxGridPoints;
  if (!Number.isFinite(center?.lat) || !Number.isFinite(center?.lng)
      || center.lat < -90 || center.lat > 90 || center.lng < -180 || center.lng > 180) {
    throw new TypeError('A valid BD-09LL center is required.');
  }
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0
      || !Number.isFinite(spacingMeters) || spacingMeters <= 0
      || !Number.isInteger(maxPoints) || maxPoints < 1) {
    throw new RangeError('Grid limits must be positive finite values.');
  }

  const metersPerLongitudeDegree = EARTH_METERS_PER_DEGREE * Math.cos(center.lat * Math.PI / 180);
  const stepCount = Math.ceil(radiusMeters / spacingMeters);
  const cells = [];
  for (let northStep = -stepCount; northStep <= stepCount; northStep += 1) {
    for (let eastStep = -stepCount; eastStep <= stepCount; eastStep += 1) {
      const northOffsetMeters = northStep * spacingMeters;
      const eastOffsetMeters = eastStep * spacingMeters;
      const offsetMeters = Math.hypot(northOffsetMeters, eastOffsetMeters);
      if (offsetMeters > radiusMeters) continue;
      cells.push({
        northOffsetMeters,
        eastOffsetMeters,
        offsetMeters: Math.round(offsetMeters),
        lat: center.lat + northOffsetMeters / EARTH_METERS_PER_DEGREE,
        lng: center.lng + eastOffsetMeters / metersPerLongitudeDegree,
      });
    }
  }
  cells.sort((a, b) => a.offsetMeters - b.offsetMeters || a.northOffsetMeters - b.northOffsetMeters || a.eastOffsetMeters - b.eastOffsetMeters);
  if (cells.length > maxPoints) {
    throw new RangeError(`Rule grid has ${cells.length} points, exceeding the ${maxPoints}-point project limit.`);
  }
  return cells.map((cell, index) => ({
    gridId: `g-${String(index + 1).padStart(3, '0')}`,
    coordinateSystem: PHASE4_CONFIG.coordinateSystem,
    ...cell,
  }));
}

export function assessWalkingCost(record, thresholdSeconds = PHASE4_CONFIG.thresholdSeconds) {
  if (!Number.isFinite(thresholdSeconds) || thresholdSeconds <= 0) {
    throw new RangeError('Walking-time threshold must be positive.');
  }
  if (record?.routeStatus === 'ok' && Number.isFinite(record.durationSeconds) && record.durationSeconds >= 0) {
    return {
      ...record,
      coverageStatus: record.durationSeconds <= thresholdSeconds ? 'covered' : 'over_threshold',
      decisionSource: 'baidu_walking_duration',
    };
  }
  const straightLineFallback = Number.isFinite(record?.straightLineDistanceMeters)
    ? {
      status: 'reference_only',
      distanceMeters: record.straightLineDistanceMeters,
      label: '直线距离降级参考（非路网步行时间，不参与15分钟覆盖判定）',
    }
    : null;
  return {
    ...record,
    durationSeconds: null,
    coverageStatus: 'unknown',
    decisionSource: 'route_unavailable',
    straightLineFallback,
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function createAnalysisRun({
  center,
  grid,
  costRecords,
  categories = [],
  retrievedAt = new Date().toISOString(),
  warnings = [],
  samplingMethod = 'bounded_regular_grid_proxy',
  requestStats = {},
}) {
  const evaluatedCosts = costRecords.map((record) => assessWalkingCost(record));
  const replayInput = {
    center,
    coordinateSystem: PHASE4_CONFIG.coordinateSystem,
    grid,
    categories: [...categories].sort(),
    costs: evaluatedCosts,
    config: PHASE4_CONFIG,
  };
  const fingerprint = createHash('sha256').update(stableJson(replayInput)).digest('hex');
  return {
    analysisRunId: `ar-${fingerprint.slice(0, 20)}`,
    inputFingerprint: fingerprint,
    createdAt: retrievedAt,
    thresholdSeconds: PHASE4_CONFIG.thresholdSeconds,
    algorithmVersion: PHASE4_CONFIG.algorithmVersion,
    input: {
      center,
      coordinateSystem: PHASE4_CONFIG.coordinateSystem,
      samplingMethod,
      areaStatus: 'no_verified_community_boundary',
      gridParameters: {
        radiusMeters: PHASE4_CONFIG.gridRadiusMeters,
        spacingMeters: PHASE4_CONFIG.gridSpacingMeters,
        maxGridPoints: PHASE4_CONFIG.maxGridPoints,
      },
      categories: [...categories].sort(),
      config: PHASE4_CONFIG,
    },
    grid,
    travelCosts: evaluatedCosts,
    apiStats: {
      maxRequests: PHASE4_CONFIG.maxWalkingRequests,
      attempted: evaluatedCosts.length,
      succeeded: evaluatedCosts.filter((record) => record.routeStatus === 'ok').length,
      failed: evaluatedCosts.filter((record) => record.routeStatus !== 'ok').length,
      cacheTtlSeconds: PHASE4_CONFIG.cacheTtlSeconds,
      maxConcurrent: PHASE4_CONFIG.maxConcurrentWalkingRequests,
      retryCount: PHASE4_CONFIG.retryCount,
      ...requestStats,
    },
    fallback: {
      mode: PHASE4_CONFIG.fallbackMode,
      label: '直线距离仅作醒目标注的参考值，不替代 walking duration，不参与覆盖判定。',
    },
    geometry: null,
    warnings: [...warnings, '当前为有界规则网格代理，不是经核验的居住网格或社区边界。', '尚未生成等时圈多边形；路线失败样本保持未知，不插值补造精确边界。'],
  };
}

export class WalkingCostCache {
  #entries = new Map();
  #ttlMs;
  #maxEntries;

  constructor({ ttlSeconds = PHASE4_CONFIG.cacheTtlSeconds, maxEntries = PHASE4_CONFIG.maxWalkingRequests } = {}) {
    this.#ttlMs = ttlSeconds * 1000;
    this.#maxEntries = maxEntries;
  }

  key({ origin, destination, category = '', coordinateSystem = PHASE4_CONFIG.coordinateSystem }) {
    const point = (value) => `${Number(value.lat).toFixed(6)},${Number(value.lng).toFixed(6)}`;
    return `${coordinateSystem}|${category}|${point(origin)}>${point(destination)}`;
  }

  get(request, now = Date.now()) {
    const key = this.key(request);
    const entry = this.#entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.#entries.delete(key);
      return null;
    }
    return structuredClone(entry.value);
  }

  set(request, value, now = Date.now()) {
    const key = this.key(request);
    this.#entries.delete(key);
    if (value?.routeStatus === 'ok') {
      this.#entries.set(key, { value: structuredClone(value), expiresAt: now + this.#ttlMs });
      while (this.#entries.size > this.#maxEntries) this.#entries.delete(this.#entries.keys().next().value);
    }
  }
}
