import {
  assessWalkingCost,
  createAnalysisRun,
  PHASE4_CONFIG,
  WalkingCostCache,
} from './travel-cost-analysis.mjs';

export const REAL_VALIDATION_MAX_ROUTES = 10;
export const REAL_VALIDATION_CATEGORY_IDS = Object.freeze([
  'medical', 'education', 'commerce', 'eldercare', 'culture', 'sports', 'parks', 'public',
]);

const walkingCache = new WalkingCostCache();
const processRouteBudget = { networkRequests: 0 };

function validPoint(point) {
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lng)
    && point.lat >= -90 && point.lat <= 90 && point.lng >= -180 && point.lng <= 180;
}

function straightLineMeters(a, b) {
  const rad = (degrees) => degrees * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

function safeFailureReason(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'timeout';
  return 'network_error';
}

function noRouteRequestRecord(center, category, reason, placeSearch = null) {
  return {
    requestType: 'no_route_request',
    origin: center,
    destination: null,
    category,
    durationSeconds: null,
    distanceMeters: null,
    httpStatus: null,
    apiStatus: null,
    routeExists: false,
    routeStatus: 'unknown',
    failureReason: reason,
    placeSearch,
  };
}

async function searchCategory(center, category, serverAk, fetchImpl) {
  const params = new URLSearchParams({
    query: category.query,
    location: `${center.lat},${center.lng}`,
    radius: '1500',
    radius_limit: 'true',
    coord_type: '3',
    page_num: '0',
    page_size: '5',
    scope: '2',
    output: 'json',
    ak: serverAk,
  });
  let response;
  try {
    response = await fetchImpl(`https://api.map.baidu.com/place/v3/around?${params}`, {
      signal: AbortSignal.timeout(PHASE4_CONFIG.requestTimeoutMs),
    });
  } catch (error) {
    return { fatal: true, reason: safeFailureReason(error), httpStatus: null, apiStatus: null };
  }
  if (!response.ok) {
    return { fatal: true, reason: 'http_error', httpStatus: response.status, apiStatus: null };
  }
  let data;
  try {
    data = await response.json();
  } catch {
    return { fatal: true, reason: 'invalid_json', httpStatus: response.status, apiStatus: null };
  }
  const apiStatus = Number.isInteger(data?.status) ? data.status : null;
  if (apiStatus !== 0) {
    return { fatal: true, reason: 'place_api_error', httpStatus: response.status, apiStatus };
  }
  const results = Array.isArray(data.results) ? data.results : [];
  const places = results.flatMap((place) => {
    const lat = Number(place?.location?.lat);
    const lng = Number(place?.location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !validPoint({ lat, lng })) return [];
    return [{
      uid: typeof place.uid === 'string' ? place.uid : null,
      name: typeof place.name === 'string' ? place.name : '',
      lat,
      lng,
    }];
  });
  return {
    fatal: false,
    reason: places.length ? null : 'no_facility_found',
    httpStatus: response.status,
    apiStatus,
    resultCount: places.length,
    place: places[0] || null,
  };
}

async function requestWalkingCost(center, candidate, serverAk, fetchImpl, cache, stats, budget) {
  const destination = { lat: candidate.lat, lng: candidate.lng };
  const request = { origin: center, destination, category: candidate.categoryId };
  const cached = cache.get(request);
  if (cached) {
    stats.cacheHits += 1;
    return { ...cached, origin: center, destination, category: candidate.categoryId, cached: true, fatal: false };
  }

  if (budget.networkRequests >= REAL_VALIDATION_MAX_ROUTES) {
    return {
      origin: center, destination, category: candidate.categoryId,
      httpStatus: null, apiStatus: null, routeExists: false,
      routeStatus: 'unknown', failureReason: 'route_request_limit_reached', fatal: true,
    };
  }
  stats.networkRequests += 1;
  budget.networkRequests += 1;
  const params = new URLSearchParams({
    origin: `${center.lat.toFixed(6)},${center.lng.toFixed(6)}`,
    destination: `${destination.lat.toFixed(6)},${destination.lng.toFixed(6)}`,
    coord_type: 'bd09ll',
    ret_coordtype: 'bd09ll',
    output: 'json',
    ak: serverAk,
  });
  if (candidate.uid) params.set('destination_uid', candidate.uid);

  let response;
  try {
    response = await fetchImpl(`https://api.map.baidu.com/direction/v2/walking?${params}`, {
      signal: AbortSignal.timeout(PHASE4_CONFIG.requestTimeoutMs),
    });
  } catch (error) {
    return {
      origin: center, destination, category: candidate.categoryId,
      httpStatus: null, apiStatus: null, routeExists: false,
      routeStatus: safeFailureReason(error), failureReason: safeFailureReason(error), fatal: true,
    };
  }
  if (!response.ok) {
    return {
      origin: center, destination, category: candidate.categoryId,
      httpStatus: response.status, apiStatus: null, routeExists: false,
      routeStatus: 'http_error', failureReason: 'http_error', fatal: true,
    };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return {
      origin: center, destination, category: candidate.categoryId,
      httpStatus: response.status, apiStatus: null, routeExists: false,
      routeStatus: 'service_error', failureReason: 'invalid_json', fatal: true,
    };
  }
  const apiStatus = Number.isInteger(data?.status) ? data.status : null;
  if (apiStatus !== 0) {
    return {
      origin: center, destination, category: candidate.categoryId,
      httpStatus: response.status, apiStatus, routeExists: false,
      routeStatus: 'service_error', failureReason: 'walking_api_error', fatal: true,
    };
  }
  const routes = Array.isArray(data?.result?.routes) ? data.result.routes : [];
  const route = routes[0];
  if (!route) {
    return {
      origin: center, destination, category: candidate.categoryId,
      httpStatus: response.status, apiStatus, routeExists: false,
      routeStatus: 'no_route', failureReason: 'no_route', fatal: false,
    };
  }
  const durationSeconds = Number(route.duration);
  const distanceMeters = Number(route.distance);
  if (!Number.isFinite(durationSeconds) || !Number.isFinite(distanceMeters)) {
    return {
      origin: center, destination, category: candidate.categoryId,
      httpStatus: response.status, apiStatus, routeExists: true,
      routeStatus: 'service_error', failureReason: 'invalid_route_fields', fatal: true,
    };
  }
  const value = {
    httpStatus: response.status,
    apiStatus,
    routeExists: true,
    routeStatus: 'ok',
    durationSeconds,
    distanceMeters,
    failureReason: null,
  };
  cache.set(request, value);
  return { ...value, origin: center, destination, category: candidate.categoryId, cached: false, fatal: false };
}

export async function runWalkingValidation({
  center,
  categories,
  serverAk,
  fetchImpl = fetch,
  cache = walkingCache,
  budget = processRouteBudget,
  retrievedAt = new Date().toISOString(),
}) {
  if (!validPoint(center)) throw new TypeError('A valid BD-09LL center is required.');
  if (!serverAk) throw new TypeError('A server-side Baidu key is required.');
  const selectedCategories = REAL_VALIDATION_CATEGORY_IDS.map((categoryId) => ({
    categoryId,
    ...(categories[categoryId] || {}),
  }));
  if (selectedCategories.some((category) => !category.label || !category.query)) {
    throw new TypeError('The existing facility category mapping is incomplete.');
  }

  const records = new Map();
  const candidates = [];
  const stats = {
    maxRequests: REAL_VALIDATION_MAX_ROUTES,
    networkRequests: 0,
    cacheHits: 0,
    maxConcurrent: PHASE4_CONFIG.maxConcurrentWalkingRequests,
    retryCount: 0,
    placeSearchAttempted: 0,
    placeSearchSucceeded: 0,
    placeSearchFailed: 0,
    placeSearchResultCount: 0,
    routeRequestsPlanned: 0,
    stoppedEarly: false,
  };
  const warnings = [
    '本次是文锦中心点每类一个目标的小规模真实验证，不代表社区范围分析。',
    '未生成等时圈、多边形、覆盖率、盲区或热力图。',
  ];

  let stopPlaceSearch = false;
  for (const category of selectedCategories) {
    if (stopPlaceSearch) {
      records.set(category.categoryId, noRouteRequestRecord(center, category.categoryId, 'place_search_stopped_after_error'));
      continue;
    }
    stats.placeSearchAttempted += 1;
    const result = await searchCategory(center, category, serverAk, fetchImpl);
    if (result.fatal) {
      stats.placeSearchFailed += 1;
      records.set(category.categoryId, noRouteRequestRecord(center, category.categoryId, result.reason, {
        httpStatus: result.httpStatus,
        apiStatus: result.apiStatus,
      }));
      stopPlaceSearch = true;
      stats.stoppedEarly = true;
      warnings.push(`设施类别 ${category.categoryId} 的 POI 请求失败；已停止后续真实调用。`);
      continue;
    }
    stats.placeSearchSucceeded += 1;
    stats.placeSearchResultCount += result.resultCount;
    const placeSearch = {
      httpStatus: result.httpStatus,
      apiStatus: result.apiStatus,
      resultCount: result.resultCount,
    };
    if (!result.place) {
      records.set(category.categoryId, noRouteRequestRecord(center, category.categoryId, 'no_facility_found', placeSearch));
      continue;
    }
    candidates.push({
      ...result.place,
      categoryId: category.categoryId,
      placeName: result.place.name,
      placeSearch,
    });
  }

  stats.routeRequestsPlanned = candidates.length;
  const routeResults = new Map();
  if (stopPlaceSearch) {
    for (const candidate of candidates) {
      routeResults.set(candidate.categoryId, noRouteRequestRecord(center, candidate.categoryId, 'walking_stopped_after_place_search_error', candidate.placeSearch));
    }
  } else if (candidates.length) {
    const first = candidates[0];
    const firstResult = await requestWalkingCost(center, first, serverAk, fetchImpl, cache, stats, budget);
    delete firstResult.fatal;
    firstResult.placeName = first.placeName;
    firstResult.placeUid = first.uid;
    firstResult.placeSearch = first.placeSearch;
    routeResults.set(first.categoryId, firstResult);
    if (['http_error', 'service_error', 'timeout', 'network_error'].includes(firstResult.routeStatus)
        || firstResult.failureReason === 'route_request_limit_reached') {
      stats.stoppedEarly = true;
      warnings.push('首条 Walking 请求遇到 HTTP/API/网络错误；已停止后续真实路线请求。');
    } else {
      let cursor = 1;
      let stopped = false;
      const worker = async () => {
        while (!stopped && cursor < candidates.length) {
          const index = cursor++;
          const candidate = candidates[index];
          const result = await requestWalkingCost(center, candidate, serverAk, fetchImpl, cache, stats, budget);
          delete result.fatal;
          result.placeName = candidate.placeName;
          result.placeUid = candidate.uid;
          result.placeSearch = candidate.placeSearch;
          routeResults.set(candidate.categoryId, result);
          if (['http_error', 'service_error', 'timeout', 'network_error'].includes(result.routeStatus)
              || result.failureReason === 'route_request_limit_reached') {
            stopped = true;
            stats.stoppedEarly = true;
          }
        }
      };
      await Promise.all(Array.from({
        length: Math.min(PHASE4_CONFIG.maxConcurrentWalkingRequests, candidates.length - 1),
      }, worker));
      if (stopped) warnings.push('Walking 请求遇到 HTTP/API/网络错误；已停止后续真实路线请求。');
    }
    for (const candidate of candidates) {
      if (!routeResults.has(candidate.categoryId)) {
        routeResults.set(candidate.categoryId, noRouteRequestRecord(center, candidate.categoryId, 'walking_stopped_after_error', candidate.placeSearch));
      }
    }
  }

  for (const [categoryId, result] of routeResults) {
    if (result.destination && result.routeStatus !== 'ok') {
      result.straightLineDistanceMeters = straightLineMeters(center, result.destination);
      result.straightLineSource = 'reference_only';
    }
    records.set(categoryId, result);
  }
  const costRecords = selectedCategories.map((category) => records.get(category.categoryId)
    || noRouteRequestRecord(center, category.categoryId, 'walking_stopped_after_error'));
  const evaluated = costRecords.map((record) => assessWalkingCost(record));
  const run = createAnalysisRun({
    center,
    grid: [],
    categories: selectedCategories.map((category) => category.categoryId),
    costRecords,
    retrievedAt,
    samplingMethod: 'one_real_target_per_facility_category',
    requestStats: {
      ...stats,
      attempted: stats.networkRequests,
      succeeded: evaluated.filter((record) => record.routeStatus === 'ok').length,
      failed: stats.networkRequests - evaluated.filter((record) => record.routeStatus === 'ok').length,
      routeRequestsSucceeded: evaluated.filter((record) => record.routeStatus === 'ok').length,
      routeRequestsFailed: evaluated.filter((record) => record.requestType !== 'no_route_request' && record.routeStatus !== 'ok').length,
      unknownCount: evaluated.filter((record) => record.coverageStatus === 'unknown').length,
      coveredCount: evaluated.filter((record) => record.coverageStatus === 'covered').length,
      overThresholdCount: evaluated.filter((record) => record.coverageStatus === 'over_threshold').length,
    },
    warnings,
  });
  return {
    status: stats.stoppedEarly ? 'partial' : 'complete',
    center,
    coordinateSystem: PHASE4_CONFIG.coordinateSystem,
    analysis_run: run,
    warnings: run.warnings,
  };
}
