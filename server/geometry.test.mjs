import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyOfficialPoint, officialGeometryBounds, preselectFacilityCandidates, geometryCacheKey, GeometryAssessmentCache,
} from './geometry.mjs';

const ring = [[120, 30], [120.01, 30], [120.01, 30.01], [120, 30.01], [120, 30]];
const official = {
  geometrySource: 'baidu_isochrone', coordinateSystem: 'BD-09LL',
  geojson: { type: 'FeatureCollection', features: [{
    type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] },
    properties: { geometrySource: 'baidu_isochrone' },
  }] },
};
const point = (lng, lat) => ({ lng, lat });
test('official bounds and inside/outside/edge classifications are distinct', () => {
  assert.deepEqual(officialGeometryBounds(official), { west: 120, south: 30, east: 120.01, north: 30.01 });
  assert.equal(classifyOfficialPoint(official, point(120.005, 30.005)).status, 'inside');
  assert.equal(classifyOfficialPoint(official, point(120.02, 30.005)).status, 'outside');
  assert.equal(classifyOfficialPoint(official, point(120.01, 30.005)).status, 'boundary');
  assert.equal(classifyOfficialPoint(official, point(120.0101, 30.005), { edgeToleranceMeters: 15 }).status, 'boundary');
  assert.equal(classifyOfficialPoint(official, point(120.0103, 30.005), { edgeToleranceMeters: 15 }).status, 'outside');
});
test('official holes and multiple polygons are respected', () => {
  const hole = [[120.003, 30.003], [120.007, 30.003], [120.007, 30.007], [120.003, 30.007], [120.003, 30.003]];
  const withHole = structuredClone(official);
  withHole.geojson.features[0].geometry.coordinates.push(hole);
  assert.equal(classifyOfficialPoint(withHole, point(120.005, 30.005)).status, 'outside');
  assert.equal(classifyOfficialPoint(withHole, point(120.003, 30.005)).status, 'boundary');
  withHole.geojson.features[0].geometry = { type: 'MultiPolygon', coordinates: [[ring, hole], [
    [[121, 31], [121.01, 31], [121.01, 31.01], [121, 31.01], [121, 31]],
  ]] };
  assert.equal(classifyOfficialPoint(withHole, point(121.005, 31.005)).status, 'inside');
});
test('sample proxy, malformed official and absent geometry never exclude a POI', () => {
  const candidates = [
    { uid: 'a', location: point(120.005, 30.005) },
    { uid: 'b', location: point(120.02, 30.005) },
    { uid: 'c', location: null },
  ];
  const sampled = { ...official, geometrySource: 'walking_sampling_fallback' };
  assert.equal(classifyOfficialPoint(sampled, point(120.02, 30.005)).status, 'unknown');
  assert.equal(preselectFacilityCandidates(sampled, candidates).retained.length, 3);
  assert.equal(preselectFacilityCandidates(null, candidates).retained.length, 3);
  assert.equal(preselectFacilityCandidates(official, candidates).excluded.length, 1);
  const malformed = structuredClone(official);
  malformed.geojson.features[0].geometry.coordinates[0][0] = [999, 30];
  assert.equal(preselectFacilityCandidates(malformed, candidates).retained.length, 3);
});
test('geometry cache partitions source, mode, threshold and version', () => {
  const base = { geometrySource: 'baidu_isochrone', mode: 'walking', thresholdSeconds: 900, algorithmVersion: 'v1', center: point(120, 30) };
  const key = geometryCacheKey(base);
  for (const change of [
    { geometrySource: 'walking_sampling_fallback' }, { mode: 'cycling' },
    { mode: 'driving' }, { thresholdSeconds: 1200 }, { algorithmVersion: 'v2' },
    { center: point(120.01, 30) },
  ]) assert.notEqual(geometryCacheKey({ ...base, ...change }), key);
});

test('cached assessment partitions official and sample sources, modes, thresholds and versions', () => {
  const cache = new GeometryAssessmentCache();
  const input = {
    result: official, point: point(120.005, 30.005), center: point(120, 30),
    mode: 'walking', thresholdSeconds: 900, algorithmVersion: 'v1',
  };
  assert.equal(cache.assess(input).status, 'inside');
  assert.equal(cache.assess({ ...input, result: { ...official, geometrySource: 'walking_sampling_fallback' } }).status, 'unknown');
  assert.equal(cache.assess({ ...input, mode: 'cycling', result: null }).status, 'unknown');
  assert.equal(cache.assess({ ...input, thresholdSeconds: 1200, result: null }).status, 'unknown');
  assert.equal(cache.assess({ ...input, algorithmVersion: 'v2', result: null }).status, 'unknown');
});