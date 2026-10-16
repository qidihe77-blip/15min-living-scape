import { validBd09ll } from './walking-provider.mjs';

const METERS_PER_DEGREE = 111_320;
function validPair(pair) {
  return Array.isArray(pair) && pair.length >= 2 && Number.isFinite(pair[0]) && Number.isFinite(pair[1])
    && pair[0] >= -180 && pair[0] <= 180 && pair[1] >= -90 && pair[1] <= 90;
}
function polygonsFrom(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates;
  return null;
}
function validPolygon(polygon) {
  return Array.isArray(polygon) && polygon.length > 0 && polygon.every((ring) =>
    Array.isArray(ring) && ring.length >= 4 && ring.every(validPair)
      && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]);
}
function officialPolygons(result) {
  if (!['baidu_isochrone','baidu_isodistance'].includes(result?.geometrySource) || result.coordinateSystem !== 'BD-09LL') return null;
  const features = result.geojson?.type === 'FeatureCollection' ? result.geojson.features : null;
  if (!Array.isArray(features) || !features.length) return null;
  const polygons = features.flatMap((feature) => {
    if (feature?.properties?.geometrySource !== result.geometrySource) return [];
    return polygonsFrom(feature.geometry) ?? [];
  });
  return polygons.length && polygons.every(validPolygon) ? polygons : null;
}
function ringBounds(ring) {
  const lngs = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  return { west: Math.min(...lngs), south: Math.min(...lats), east: Math.max(...lngs), north: Math.max(...lats) };
}
export function officialGeometryBounds(result) {
  const polygons = officialPolygons(result);
  if (!polygons) return null;
  const bounds = polygons.map((polygon) => ringBounds(polygon[0]));
  return {
    west: Math.min(...bounds.map((b) => b.west)), south: Math.min(...bounds.map((b) => b.south)),
    east: Math.max(...bounds.map((b) => b.east)), north: Math.max(...bounds.map((b) => b.north)),
  };
}
function distanceToSegmentMeters(point, a, b) {
  const xScale = METERS_PER_DEGREE * Math.cos(point.lat * Math.PI / 180);
  const ax = (a[0] - point.lng) * xScale;
  const ay = (a[1] - point.lat) * METERS_PER_DEGREE;
  const bx = (b[0] - point.lng) * xScale;
  const by = (b[1] - point.lat) * METERS_PER_DEGREE;
  const length2 = (bx - ax) ** 2 + (by - ay) ** 2;
  const t = length2 ? Math.max(0, Math.min(1, -(ax * (bx - ax) + ay * (by - ay)) / length2)) : 0;
  return Math.hypot(ax + t * (bx - ax), ay + t * (by - ay));
}
function containsRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > point.lat) !== (b[1] > point.lat)
      && point.lng < (b[0] - a[0]) * (point.lat - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function classifyOfficialPoint(result, point, { edgeToleranceMeters = 15 } = {}) {
  if (!validBd09ll(point)) throw new TypeError('Invalid BD-09LL candidate point.');
  if (!Number.isFinite(edgeToleranceMeters) || edgeToleranceMeters < 0 || edgeToleranceMeters > 500) {
    throw new RangeError('Invalid edge tolerance.');
  }
  const polygons = officialPolygons(result);
  if (!polygons) return { status: 'unknown', geometrySource: result?.geometrySource ?? 'none', edgeDistanceMeters: null };
  let nearestEdge = Infinity;
  for (const polygon of polygons) for (const ring of polygon) for (let i = 0; i < ring.length - 1; i++) {
    nearestEdge = Math.min(nearestEdge, distanceToSegmentMeters(point, ring[i], ring[i + 1]));
  }
  if (nearestEdge <= edgeToleranceMeters) {
    return { status: 'boundary', geometrySource: result.geometrySource, edgeDistanceMeters: nearestEdge };
  }
  const inside = polygons.some((polygon) => containsRing(point, polygon[0])
    && !polygon.slice(1).some((hole) => containsRing(point, hole)));
  return { status: inside ? 'inside' : 'outside', geometrySource: result.geometrySource, edgeDistanceMeters: nearestEdge };
}
export function preselectFacilityCandidates(result, candidates, options) {
  if (!Array.isArray(candidates)) throw new TypeError('Candidates must be an array.');
  const retained = [], excluded = [];
  for (const candidate of candidates) {
    const location = candidate.location ?? (Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng)
      ? { lat: candidate.lat, lng: candidate.lng } : null);
    const assessment = validBd09ll(location)
      ? classifyOfficialPoint(result, location, options)
      : { status: 'unknown', geometrySource: result?.geometrySource ?? 'none', edgeDistanceMeters: null };
    const record = { ...candidate, geometryAssessment: assessment };
    if (assessment.status === 'outside') excluded.push(record);
    else retained.push(record);
  }
  return { retained, excluded, spatialSource: officialPolygons(result) ? result.geometrySource : 'unknown' };
}
export function geometryCacheKey({
  geometrySource, mode, thresholdSeconds, algorithmVersion, center, geometryId = '',
} = {}) {
  if (!['baidu_isochrone','baidu_isodistance', 'walking_sampling_fallback', 'none'].includes(geometrySource)
    || !['walking', 'cycling', 'driving'].includes(mode)
    || !Number.isInteger(thresholdSeconds) || thresholdSeconds <= 0
    || typeof algorithmVersion !== 'string' || !algorithmVersion
    || !validBd09ll(center)) throw new TypeError('Incomplete geometry cache identity.');
  return JSON.stringify([
    geometrySource, mode, thresholdSeconds, algorithmVersion,
    Number(center.lat).toFixed(6), Number(center.lng).toFixed(6), String(geometryId),
  ]);
}

export class GeometryAssessmentCache {
  #entries = new Map();
  #maxEntries;
  constructor({ maxEntries = 5000 } = {}) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new RangeError('Invalid geometry cache size.');
    this.#maxEntries = maxEntries;
  }
  assess({ result, point, mode, thresholdSeconds, algorithmVersion, center, geometryId, edgeToleranceMeters = 15 }) {
    const identity = geometryCacheKey({
      geometrySource: result?.geometrySource ?? 'none', mode, thresholdSeconds,
      algorithmVersion, center, geometryId: geometryId ?? result?.retrievedAt ?? '',
    });
    if (!validBd09ll(point)) throw new TypeError('Invalid candidate point.');
    const key = JSON.stringify([identity, point.lat.toFixed(6), point.lng.toFixed(6), edgeToleranceMeters]);
    if (this.#entries.has(key)) return this.#entries.get(key);
    const assessment = classifyOfficialPoint(result, point, { edgeToleranceMeters });
    if (this.#entries.size >= this.#maxEntries) this.#entries.delete(this.#entries.keys().next().value);
    this.#entries.set(key, assessment);
    return assessment;
  }
  clear() { this.#entries.clear(); }
}