import { parseBaiduStepGeometry } from './route-geometry.mjs';
import { PHASE4_CONFIG, WalkingCostCache } from './travel-cost-analysis.mjs';

export function validBd09ll(point) {
  return point && Number.isFinite(point.lat) && Number.isFinite(point.lng)
    && point.lat >= -90 && point.lat <= 90 && point.lng >= -180 && point.lng <= 180;
}

export function createWalkingProvider({
  serverAk, fetchImpl = fetch, cache = new WalkingCostCache(),
  budget = { networkRequests: 0 }, maxRequests = PHASE4_CONFIG.maxWalkingRequests,
  timeoutMs = PHASE4_CONFIG.requestTimeoutMs, signal, onTerminalError = () => {},
} = {}) {
  if (!serverAk) throw new TypeError('A server-side map key is required.');
  if (!Number.isInteger(maxRequests) || maxRequests < 0 || maxRequests > PHASE4_CONFIG.maxWalkingRequests) {
    throw new RangeError('Invalid walking request budget.');
  }
  let cacheHits = 0;
  let failed = 0;
  let succeeded = 0;
  let stopped = false;
  let lastFailure = null;

  async function route(origin, destination, { originUid, destinationUid } = {}) {
    originUid ??= origin?.uid ?? null;
    destinationUid ??= destination?.uid ?? null;
    origin = origin?.location ?? origin;
    destination = destination?.location ?? destination;
    if (!validBd09ll(origin) || !validBd09ll(destination)) throw new TypeError('Invalid BD-09LL coordinates.');
    if (signal?.aborted) return { routeStatus: 'cancelled', durationSeconds: null, distanceMeters: null, cached: false };
    const cacheKey = { origin, destination, category: 'walking_route'
      + (originUid || destinationUid ? ':' + JSON.stringify([originUid, destinationUid]) : '') };
    const cached = cache.get(cacheKey);
    if (cached) {
      cacheHits += 1;
      return { ...cached, cached: true };
    }
    if (signal?.aborted) return { routeStatus: 'cancelled', durationSeconds: null, distanceMeters: null, cached: false };
    if (stopped) return { routeStatus: 'route_service_error', durationSeconds: null, distanceMeters: null, cached: false };
    if (budget.networkRequests >= maxRequests) {
      return { routeStatus: 'route_request_limit_reached', durationSeconds: null, distanceMeters: null, cached: false };
    }
    budget.networkRequests += 1;
    const params = new URLSearchParams({
      origin: origin.lat.toFixed(6) + ',' + origin.lng.toFixed(6),
      destination: destination.lat.toFixed(6) + ',' + destination.lng.toFixed(6),
      coord_type: 'bd09ll', ret_coordtype: 'bd09ll', output: 'json', ak: serverAk,
    });
    if (originUid) params.set('origin_uid', String(originUid));
    if (destinationUid) params.set('destination_uid', String(destinationUid));
    try {
      const response = await fetchImpl('https://api.map.baidu.com/direction/v2/walking?' + params, {
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        failed += 1;
        stopped = true;
        lastFailure={reasonCode:response.status===429?'rate_limited':[401,403].includes(response.status)?'permission_denied':'upstream_http_error',httpStatus:response.status,apiStatus:null};
        if (response.status === 429) onTerminalError('rate_limited');
        if ([401,403].includes(response.status)) onTerminalError('permission_denied');
        return { routeStatus: 'upstream_http_error', httpStatus: response.status, durationSeconds: null, distanceMeters: null, cached: false };
      }
      const data = await response.json();
      if (data.status !== 0) {
        failed += 1;
        // A destination with no route does not revoke other destinations' authorization.
        stopped = data.status !== 7;
        lastFailure={reasonCode:data.status===7?'no_route':data.status===401?'rate_limited':[4,302].includes(data.status)?'quota_exhausted':
          [3,5,9,101,200,201,202,203,210,211,240].includes(data.status)?'permission_denied':'provider_error',
          apiStatus:Number.isInteger(data.status)?data.status:null,httpStatus:response.status};
        if ([4,302].includes(data.status)) onTerminalError('quota_exhausted');
        if (data.status===401) onTerminalError('rate_limited');
        if ([3,5,9,101,200,201,202,203,210,211,240].includes(data.status)) onTerminalError('permission_denied');
        return { routeStatus: data.status===7?'no_route':'route_service_error', apiStatus: Number.isInteger(data.status) ? data.status : null, durationSeconds: null, distanceMeters: null, cached: false };
      }
      const first = data.result?.routes?.[0];
      const duration = Number(first?.duration);
      const distance = Number(first?.distance);
      if (!first || first.duration == null || first.distance == null || !Number.isFinite(duration) || duration < 0 || !Number.isFinite(distance) || distance < 0) {
        failed += 1;
        return { routeStatus: 'no_route', durationSeconds: null, distanceMeters: null, cached: false };
      }
      const snapped = data.result?.destination?.destinationPt;
      const destinationPoint = snapped && Number.isFinite(Number(snapped.lat)) && Number.isFinite(Number(snapped.lng))
        ? { lat: Number(snapped.lat), lng: Number(snapped.lng) } : destination;
      const rawOrigin=data.result?.origin?.originPt??data.result?.origin;
      const providerOrigin=rawOrigin?.lat!=null&&rawOrigin?.lng!=null?{lat:Number(rawOrigin.lat),lng:Number(rawOrigin.lng)}:null;
      const result = { routeStatus: 'ok', durationSeconds: duration, distanceMeters: distance,
        destination: destinationPoint,providerOrigin:validBd09ll(providerOrigin)?providerOrigin:null,providerDestination:validBd09ll(destinationPoint)?destinationPoint:null,cached: false, source: 'direction_walking', mode: 'walking',
        coordinateSystem: 'BD-09LL', retrievedAt: new Date().toISOString(),
        requestedOrigin: { location: { ...origin }, uid: originUid },
        requestedDestination: { location: { ...destination }, uid: destinationUid },
        ...parseBaiduStepGeometry(first.steps) };
      succeeded += 1;
      cache.set(cacheKey, result);
      return result;
    } catch (error) {
      failed += 1;
      return {
        routeStatus: signal?.aborted ? 'cancelled' : error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'upstream_unavailable',
        durationSeconds: null, distanceMeters: null, cached: false,
      };
    }
  }
  return {
    route,
    stats: () => ({ networkRequests: budget.networkRequests, succeeded, failed, cacheHits, stopped: stopped || Boolean(signal?.aborted), maxRequests, lastFailure }),
  };
}
