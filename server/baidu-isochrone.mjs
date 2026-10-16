import { BaiduApiError } from './baidu-client.mjs';
import { validBd09ll } from './walking-provider.mjs';
import {validateBoundaryRing} from './boundary-geometry.mjs';

export const BAIDU_ISOCHRONE_VERSION = 'baidu-isochrone-adapter-v2';
export const ISOCHRONE_PROFILES = Object.freeze({
  walking: 'foot_fastest',
  cycling: 'bike_fastest',
  driving: 'car_fastest',
});
export const ISOCHRONE_MINUTES = Object.freeze([15, 20, 30]);

function invalidGeometry(reasonCode) {
  const error=new BaiduApiError('invalid_geometry', { service: 'isochrone' });
  if(reasonCode)error.geometryReasonCode=reasonCode;return error;
}

function validCoordinate(lng, lat) {
  return Number.isFinite(lng) && Number.isFinite(lat)
    && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}

function parseRing(input) {
  const raw = input.trim();
  if (!raw) throw invalidGeometry();
  let pairs;
  if (raw.includes(';')) {
    pairs = raw.split(';').map((part) => {
      const values = part.trim().split(',').map((value) => {
        if (!value.trim()) throw invalidGeometry();
        return Number(value.trim());
      });
      if (values.length !== 2) throw invalidGeometry();
      return values;
    });
  } else {
    const values = raw.split(',').map((part) => {
      if (!part.trim()) throw invalidGeometry();
      return Number(part.trim());
    });
    if (values.length % 2 !== 0) throw invalidGeometry();
    pairs = [];
    for (let i = 0; i < values.length; i += 2) pairs.push([values[i], values[i + 1]]);
  }
  if (pairs.length < 3 || pairs.length > 20000) throw invalidGeometry();
  if (pairs.some(([lng, lat]) => !validCoordinate(lng, lat))) throw invalidGeometry();
  const first = pairs[0];
  const last = pairs[pairs.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) pairs.push([...first]);
  if (new Set(pairs.slice(0, -1).map(([lng, lat]) => lng + ',' + lat)).size < 3) {
    throw invalidGeometry();
  }
  let twiceArea = 0;
  for (let i = 0; i < pairs.length - 1; i += 1) {
    twiceArea += pairs[i][0] * pairs[i + 1][1] - pairs[i + 1][0] * pairs[i][1];
  }
  if (!Number.isFinite(twiceArea) || Math.abs(twiceArea) < 1e-12) throw invalidGeometry();
  const validation=validateBoundaryRing(pairs);if(!validation.valid)throw invalidGeometry(validation.reasonCode);
  return pairs;
}

// The public guide specifies a path string but does not document every multipart separator.
// This parser accepts only flat comma pairs, semicolon-separated pairs and explicit "|" parts.
// Unknown layouts fail closed until a real, authorized response has been checked.
export function parseIsochronePath(path) {
  if (typeof path !== 'string') throw invalidGeometry();
  if (!path.trim()) throw new BaiduApiError('empty_geometry', { service: 'isochrone' });
  const parts = path.split('|');
  if (parts.length > 100) throw invalidGeometry();
  const rings = parts.map(parseRing);
  return rings.length === 1
    ? { type: 'Polygon', coordinates: [rings[0]] }
    : { type: 'MultiPolygon', coordinates: rings.map((ring) => [ring]) };
}

export function createBaiduIsochroneProvider({ client, enabled = false,expiresAt=null,now=Date.now } = {}) {
  if(expiresAt&&!Number.isFinite(Date.parse(expiresAt)))throw new TypeError('Invalid isochrone expiry.');
  if (!client || typeof client.requestJson !== 'function') {
    throw new TypeError('An injectable Baidu HTTP client is required.');
  }
  async function getIsochrone({ center, mode = 'walking', minutes = 15, signal } = {}) {
    if (!enabled) throw new BaiduApiError('permission_unverified', { service: 'isochrone' });
    if(expiresAt&&now()>Date.parse(expiresAt))throw new BaiduApiError('permission_expired',{service:'isochrone'});
    if (!validBd09ll(center)) throw new TypeError('Invalid BD-09LL center.');
    if (!Object.hasOwn(ISOCHRONE_PROFILES, mode)) throw new TypeError('Unsupported travel mode.');
    if (!ISOCHRONE_MINUTES.includes(minutes)) throw new RangeError('Unsupported isochrone duration.');
    const thresholdSeconds = minutes * 60;
    const { data, meta } = await client.requestJson({
      service: 'isochrone',
      path: '/logistics_truck/v1/isochrone',
      params: {
        profile: ISOCHRONE_PROFILES[mode],
        point: center.lng + ',' + center.lat,
        timeLimit: thresholdSeconds,
        inputCrs: 'bd09ll',
        outputCrs: 'bd09ll',
      },
      cacheTtlMs: 300000, signal,
    });
    if (!data?.result || typeof data.result !== 'object') {
      throw new BaiduApiError('invalid_response', { service: 'isochrone' });
    }
    const geometry = parseIsochronePath(data.result.path);
    return {
      geometrySource: 'baidu_isochrone',
      geometryStatus: 'available',
      algorithmVersion: BAIDU_ISOCHRONE_VERSION,
      coordinateSystem: 'BD-09LL',
      mode, thresholdSeconds,
      center: { lng: center.lng, lat: center.lat },
      retrievedAt: meta.retrievedAt,
      cached: meta.cached,
      geojson: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature', geometry,
          properties: {
            geometrySource: 'baidu_isochrone',
            algorithmVersion: BAIDU_ISOCHRONE_VERSION,
            coordinateSystem: 'BD-09LL',
            mode, thresholdSeconds,
          },
        }],
      },
    };
  }
  return Object.freeze({ getIsochrone });
}
