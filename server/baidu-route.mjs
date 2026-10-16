import { BaiduApiError } from './baidu-client.mjs';
import { validBd09ll } from './walking-provider.mjs';
import { createHash } from 'node:crypto';
import{parseWalkingNavigation}from'./walking-navigation-steps.mjs';
import{walkingOdCacheKey}from'./walking-cache.mjs';

export const BAIDU_ROUTE_VERSION = 'direction-lite-matrix-v1';
const ROUTE_PATHS = Object.freeze({ walking: 'walking', cycling: 'riding', driving: 'driving' });
const MATRIX_CALL_LIMIT = Object.freeze({ walking: 50, cycling: 50, driving: 100 });

function pointOf(value) { return value?.location ?? value; }
function uidOf(value, override) { return override ?? value?.uid ?? null; }
function serializePoint(value) {
  const point = pointOf(value);
  if (!validBd09ll(point)) throw new TypeError('Invalid BD-09LL route point.');
  return point.lat.toFixed(6) + ',' + point.lng.toFixed(6);
}
function validateMode(mode) {
  if (!Object.hasOwn(ROUTE_PATHS, mode)) throw new RangeError('Unsupported travel mode.');
}
function statusFromError(error) {
  if (!(error instanceof BaiduApiError)) return 'upstream_unavailable';
  if (error.apiStatus === 7) return 'no_route';
  return error.code;
}
function routeUnknown(mode, source, status) {
  return { mode, source, routeStatus: status, durationSeconds: null, distanceMeters: null,
    coordinateSystem: 'BD-09LL', retrievedAt: null };
}
function validCost(duration, distance, { allowZeroDuration = true } = {}) {
  return Number.isFinite(duration) && (allowZeroDuration ? duration >= 0 : duration > 0)
    && Number.isFinite(distance) && distance >= 0;
}

export { parseBaiduStepGeometry } from './route-geometry.mjs';
import { parseBaiduStepGeometry } from './route-geometry.mjs';

function endpoint(value, uid) {
  const point = pointOf(value);
  return { location: { lat: Number(point.lat.toFixed(6)), lng: Number(point.lng.toFixed(6)) }, uid: uid ?? null };
}
const requestKey=(a,b,o={})=>facilityRouteCacheKey(a,b,o)+(o.destinationNavigation==='coordinates'?':destination_coordinates':'');
export function facilityRouteCacheKey(origin, destination, { mode = 'walking', originUid, destinationUid } = {}) {
  return JSON.stringify([mode, endpoint(origin, uidOf(origin, originUid)), endpoint(destination, uidOf(destination, destinationUid))]);
}

export function providerEndpoint(value){
 const p=value?.originPt??value?.destinationPt??value;
 if(p?.lat==null||p?.lng==null)return null;
 const point={lat:Number(p.lat),lng:Number(p.lng)};return validBd09ll(point)?point:null;
}
export function createBaiduRouteProvider({
  client, liteRequestLimit = 24, matrixEnabled = false,
  matrixVerified = false, matrixOutputLimit = 0, matrixOutputQps = 0, now = Date.now, cacheMaxEntries=512,requestLimitWindowMs=null,
  persistentCache=null,cacheEndpoint='direction_lite',originNavigation='uid',
} = {}) {
  if (!client?.requestJson) throw new TypeError('An injectable Baidu client is required.');
  if (!Number.isInteger(liteRequestLimit) || liteRequestLimit < 0 || liteRequestLimit > 50000
    || !Number.isInteger(matrixOutputLimit) || matrixOutputLimit < 0 || matrixOutputLimit > 10000
    || !Number.isInteger(matrixOutputQps) || matrixOutputQps < 0 || matrixOutputQps > 1000
    || typeof now !== 'function'||!Number.isInteger(cacheMaxEntries)||cacheMaxEntries<1||cacheMaxEntries>10000) {
    throw new RangeError('Invalid route request limits.');
  }
  if(requestLimitWindowMs!==null&&(!Number.isFinite(requestLimitWindowMs)||requestLimitWindowMs<=0))throw new RangeError('Invalid route request window.');
  let requestWindowStart=now(),liteRequestsTotal=0;
  let liteRequests = 0;
  let matrixRequests = 0;
  let matrixOutputRoutes = 0;
  let cacheHits = 0;
  const cache = new Map();
  const inFlight = new Map();
  function readCache(key, includeGeometry) {
    const entry = cache.get(key);
    if(entry?.expiresAt<=now())cache.delete(key);
    if (!entry || entry.expiresAt <= now() || (includeGeometry && !entry.detailsRequested)) return null;
    cache.delete(key);cache.set(key,entry);
    cacheHits += 1;
    return { ...structuredClone(entry.route), cached: true };
  }
  function remember(key, route, detailsRequested = false) {
    if (route.routeStatus !== 'ok') return route;
    const previous = cache.get(key);
    // A newer Matrix cost must not keep an older Lite geometry attached.
    cache.set(key, { route: structuredClone(route), detailsRequested, expiresAt: now() + 300000 });
    for(const[k,v]of cache)if(v.expiresAt<=now())cache.delete(k);
    while(cache.size>cacheMaxEntries)cache.delete(cache.keys().next().value);
    if (previous && previous.route.retrievedAt !== route.retrievedAt) route.replacedCachedEvidence = true;
    return route;
  }
  const recentMatrixOutputs = [];
  function outputsThisSecond() {
    const cutoff = now() - 1000;
    while (recentMatrixOutputs.length && recentMatrixOutputs[0].at <= cutoff) recentMatrixOutputs.shift();
    return recentMatrixOutputs.reduce((sum, item) => sum + item.count, 0);
  }

  function canBatch(mode, outputRoutes) {
    validateMode(mode);
    return matrixEnabled === true && matrixVerified === true
      && Number.isInteger(outputRoutes) && outputRoutes > 0
      && outputRoutes <= MATRIX_CALL_LIMIT[mode]
      && matrixOutputQps > 0 && outputsThisSecond() + outputRoutes <= matrixOutputQps
      && matrixOutputRoutes + outputRoutes <= matrixOutputLimit;
  }

  async function fetchRoute(origin, destination, { mode = 'walking', originUid, destinationUid, signal, includeGeometry = false, captureGeometry = false,destinationNavigation='uid' } = {}) {
    validateMode(mode);
    const from = serializePoint(origin), to = serializePoint(destination);
    if(requestLimitWindowMs!==null&&now()-requestWindowStart>=requestLimitWindowMs){requestWindowStart=now();liteRequests=0;}
    if (liteRequests >= liteRequestLimit) return routeUnknown(mode, 'direction_lite', 'route_request_limit_reached');
    liteRequests += 1;liteRequestsTotal += 1;
    const params = { origin: from, destination: to, coord_type: 'bd09ll', ret_coordtype: 'bd09ll' };
    if (includeGeometry || captureGeometry) params.steps_info = '1';
    const fromUid = uidOf(origin, originUid), toUid = uidOf(destination, destinationUid);
    if (fromUid) params.origin_uid = String(fromUid);
    if (toUid&&destinationNavigation!=='coordinates') params.destination_uid = String(toUid);
    try {
      const { data, meta } = await client.requestJson({
        service: 'direction_lite', path: '/directionlite/v1/' + ROUTE_PATHS[mode],
        params, cacheTtlMs: 300000, signal,
      });
      const first = data.result?.routes?.[0];
      if (!first) return routeUnknown(mode, 'direction_lite', 'no_route');
      const duration = Number(first.duration), distance = Number(first.distance);
      if (first.duration == null || first.distance == null || !validCost(duration, distance)) {
        return routeUnknown(mode, 'direction_lite', 'invalid_response');
      }
      const geometry = includeGeometry || captureGeometry ? parseBaiduStepGeometry(first.steps)
        : { geometry: null, geometryStatus: 'not_requested' };
      return { mode, source: 'direction_lite', routeStatus: 'ok', ...geometry,
        ...(mode==='walking'&&(includeGeometry||captureGeometry)?{navigation:parseWalkingNavigation(first.steps)}:{}),
        durationSeconds: duration, distanceMeters: distance,
        coordinateSystem: 'BD-09LL', retrievedAt: meta.retrievedAt, cached: meta.cached,
        requestedOrigin: endpoint(origin, fromUid), requestedDestination: endpoint(destination, toUid),
        destinationNavigation,requestDestinationUidApplied:destinationNavigation!=='coordinates'&&Boolean(toUid),
        providerOrigin:providerEndpoint(data.result?.origin),
        providerDestination:providerEndpoint(data.result?.destination) };
    } catch (error) { return {...routeUnknown(mode, 'direction_lite', statusFromError(error)),
      apiStatus:Number.isInteger(error?.apiStatus)?error.apiStatus:null,httpStatus:Number.isInteger(error?.httpStatus)?error.httpStatus:null}; }
  }

  async function route(origin, destination, options = {}) {
    const mode = options.mode ?? 'walking';
    validateMode(mode);
    serializePoint(origin); serializePoint(destination);
    if (options.signal?.aborted) return routeUnknown(mode, 'direction_lite', 'cancelled');
    await persistentCache?.ready;
    const key = requestKey(origin, destination, { ...options, mode });
    const diskKey=walkingOdCacheKey(origin,destination,{...options,mode,endpoint:cacheEndpoint,originNavigation});
    const persistent=persistentCache?.get(diskKey,!!(options.includeGeometry||options.captureGeometry));
    if(persistent){cacheHits++;return {...persistent,requestedOrigin:endpoint(origin,uidOf(origin,options.originUid)),requestedDestination:endpoint(destination,uidOf(destination,options.destinationUid))};}
    const cached = readCache(key, options.includeGeometry === true || options.captureGeometry === true);
    if (cached) return cached;
    const pendingKey = key + (options.includeGeometry === true || options.captureGeometry === true ? ':details' : ':cost');
    // Only share in-flight requests with the same cancellation scope.
    let scopes=inFlight.get(pendingKey);if(!scopes){scopes=new Map();inFlight.set(pendingKey,scopes);}
    if(scopes.has(options.signal))return structuredClone(await scopes.get(options.signal));
    const promise = fetchRoute(origin, destination, options).then((result) => {
      if (result.routeStatus === 'ok') result.evidenceId = 'route-' + createHash('sha256').update(JSON.stringify([
        key, result.source, result.retrievedAt, result.durationSeconds, result.distanceMeters, result.geometry,
      ])).digest('hex').slice(0, 24);
      persistentCache?.set(diskKey,result,options.includeGeometry === true || options.captureGeometry === true);
      return remember(key, result, options.includeGeometry === true || options.captureGeometry === true);
    });
    scopes.set(options.signal,promise);
    try { return structuredClone(await promise); }
    finally { if(scopes.get(options.signal)===promise)scopes.delete(options.signal);if(!scopes.size)inFlight.delete(pendingKey); }
  }

  async function routeMatrix({ origins, destinations, mode = 'walking', signal } = {}) {
    validateMode(mode);
    if (!Array.isArray(origins) || !Array.isArray(destinations)
      || !origins.length || !destinations.length) throw new TypeError('Nonempty route arrays are required.');
    const outputRoutes = origins.length * destinations.length;
    if (outputRoutes > MATRIX_CALL_LIMIT[mode]) throw new RangeError('Matrix output exceeds per-call mode limit.');
    const pointWithUid = (value) => {
      const coordinate = serializePoint(value);
      const uid = mode === 'driving' ? null : uidOf(value);
      if (uid && /[|;]/.test(String(uid))) throw new TypeError('Invalid route UID.');
      return uid ? coordinate + ';' + uid : coordinate;
    };
    const from = origins.map(pointWithUid).join('|');
    const to = destinations.map(pointWithUid).join('|');
    if (!matrixEnabled || !matrixVerified) {
      return Array.from({ length: outputRoutes }, () => routeUnknown(mode, 'route_matrix', 'matrix_unverified'));
    }
    if (matrixOutputRoutes + outputRoutes > matrixOutputLimit) {
      return Array.from({ length: outputRoutes }, () => routeUnknown(mode, 'route_matrix', 'route_request_limit_reached'));
    }
    if (!matrixOutputQps || outputsThisSecond() + outputRoutes > matrixOutputQps) {
      return Array.from({ length: outputRoutes }, () => routeUnknown(mode, 'route_matrix', 'matrix_local_rate_limited'));
    }
    matrixOutputRoutes += outputRoutes;
    recentMatrixOutputs.push({ at: now(), count: outputRoutes });
    matrixRequests += 1;
    try {
      const { data, meta } = await client.requestJson({
        service: 'route_matrix', path: '/routematrix/v2/' + ROUTE_PATHS[mode],
        params: { origins: from, destinations: to, coord_type: 'bd09ll', output: 'json' },
        cacheTtlMs: 0, signal,
      });
      if (!Array.isArray(data.result) || data.result.length !== outputRoutes) {
        return Array.from({ length: outputRoutes }, () => routeUnknown(mode, 'route_matrix', 'invalid_response'));
      }
      return data.result.map((item, index) => {
        const durationValue=item?.duration&&typeof item.duration==='object'?item.duration.value:item?.duration;
        const distanceValue=item?.distance&&typeof item.distance==='object'?item.distance.value:item?.distance;
        const duration = Number(durationValue), distance = Number(distanceValue);
        // Matrix documents zero as no computed result; never use it as a 0-second witness.
        if (durationValue == null || distanceValue == null
          || !validCost(duration, distance, { allowZeroDuration: false })) {
          return routeUnknown(mode, 'route_matrix', 'no_route');
        }
        const origin = origins[Math.floor(index / destinations.length)], destination = destinations[index % destinations.length];
        const key = facilityRouteCacheKey(origin, destination, { mode });
        return remember(key, { mode, source: 'route_matrix', routeStatus: 'ok', geometry: null, geometryStatus: 'not_provided',
          durationSeconds: duration, distanceMeters: distance,
          coordinateSystem: 'BD-09LL', retrievedAt: meta.retrievedAt, cached: meta.cached,
          requestedOrigin: endpoint(origin, uidOf(origin)), requestedDestination: endpoint(destination, uidOf(destination)),
          evidenceId: 'route-' + createHash('sha256').update(JSON.stringify([
            key, 'route_matrix', meta.retrievedAt, duration, distance,
          ])).digest('hex').slice(0, 24) });
      });
    } catch (error) {
      const status = statusFromError(error);
      return Array.from({ length: outputRoutes }, () => routeUnknown(mode, 'route_matrix', status));
    }
  }

  async function routeMany({ origin, destinations, mode = 'walking', signal } = {}) {
    validateMode(mode);
    if (!Array.isArray(destinations)) throw new TypeError('Destinations must be an array.');
    if (!destinations.length) return [];
    serializePoint(origin);
    destinations.forEach(serializePoint);
    let results;
    if (canBatch(mode, destinations.length)) {
      results = await routeMatrix({ origins: [origin], destinations, mode, signal });
    } else {
      results = Array.from({ length: destinations.length }, () => null);
    }
    for (let i = 0; i < destinations.length; i += 1) {
      if (!results[i] || results[i].routeStatus !== 'ok') {
        results[i] = await route(origin, destinations[i], { mode, signal });
      }
    }
    return results;
  }

  function stats() { return {
    liteRequests,liteRequestsTotal,requestLimitWindowMs, liteRequestLimit, matrixRequests, cacheHits,
    matrixOutputRoutes, matrixOutputLimit, matrixOutputQps, matrixOutputsThisSecond: outputsThisSecond(),
    matrixEnabled: matrixEnabled === true && matrixVerified === true,
    cacheEntries:cache.size,cacheMaxEntries,
  }; }
  return Object.freeze({ route, routeMany, routeMatrix, canBatch, stats,
    ready:persistentCache?.ready??Promise.resolve(),
    peek: (origin, destination, options = {}) => {
      const saved=persistentCache?.get(walkingOdCacheKey(origin,destination,{...options,endpoint:cacheEndpoint,originNavigation}),!!(options.includeGeometry||options.captureGeometry));
      if(saved)return {...saved,requestedOrigin:endpoint(origin,uidOf(origin,options.originUid)),requestedDestination:endpoint(destination,uidOf(destination,options.destinationUid))};
      const key = requestKey(origin, destination, options);
      const entry = cache.get(key);
      if(entry?.expiresAt<=now())cache.delete(key);
      if(!entry||entry.expiresAt<=now()||((options.includeGeometry||options.captureGeometry)&&!entry.detailsRequested))return null;
      cache.delete(key);cache.set(key,entry);return structuredClone(entry.route);
    } });
}
