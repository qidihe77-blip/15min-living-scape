import test from 'node:test';
import assert from 'node:assert/strict';
import { createBaiduClient, BaiduApiError } from './baidu-client.mjs';
import {
  createBaiduIsochroneProvider, parseIsochronePath,
  ISOCHRONE_PROFILES, BAIDU_ISOCHRONE_VERSION,
} from './baidu-isochrone.mjs';
import { readFileSync } from 'node:fs';
const { validIsochroneResponse, emptyIsochroneResponse, permissionDeniedResponse } = JSON.parse(
  readFileSync(new URL('../test/fixtures/baidu-responses.json', import.meta.url), 'utf8'),
);

const center = { lng: 120.1, lat: 30.2 };
const response = (payload) => new Response(JSON.stringify(payload));

function mockProvider(payload, seen = []) {
  const client = createBaiduClient({
    mode: 'mock', maxRetries: 0,
    fetchImpl: async (url) => {
      seen.push(new URL(url));
      return response(payload);
    },
  });
  return createBaiduIsochroneProvider({ client, enabled: true });
}

test('all three travel profiles and 15/20/30 minute thresholds use lng,lat and return closed geometry', async () => {
  for (const [mode, profile] of Object.entries(ISOCHRONE_PROFILES)) {
    for (const minutes of [15, 20, 30]) {
      const seen = [];
      const provider = mockProvider(validIsochroneResponse, seen);
      const result = await provider.getIsochrone({ center, mode, minutes });
      assert.equal(seen[0].searchParams.get('profile'), profile);
      assert.equal(seen[0].searchParams.get('point'), '120.1,30.2');
      assert.equal(seen[0].searchParams.get('timeLimit'), String(minutes * 60));
      assert.equal(seen[0].searchParams.get('inputCrs'), 'bd09ll');
      assert.equal(seen[0].searchParams.get('outputCrs'), 'bd09ll');
      const feature = result.geojson.features[0];
      assert.equal(feature.geometry.type, 'Polygon');
      const ring = feature.geometry.coordinates[0];
      assert.deepEqual(ring[0], ring.at(-1));
      assert.equal(result.geometrySource, 'baidu_isochrone');
      assert.equal(feature.properties.geometrySource, 'baidu_isochrone');
      assert.equal(result.algorithmVersion, BAIDU_ISOCHRONE_VERSION);
      assert.equal(result.thresholdSeconds, minutes * 60);
    }
  }
});

test('flat comma pairs and explicit multipart path close into GeoJSON', () => {
  const flat = parseIsochronePath('120.1,30.2,120.2,30.2,120.2,30.3');
  assert.equal(flat.type, 'Polygon');
  assert.deepEqual(flat.coordinates[0][0], flat.coordinates[0].at(-1));
  const multi = parseIsochronePath(
    '120.1,30.2;120.2,30.2;120.2,30.3|121.1,31.2;121.2,31.2;121.2,31.3',
  );
  assert.equal(multi.type, 'MultiPolygon');
  assert.equal(multi.coordinates.length, 2);
});

test('empty path, malformed points and degenerate geometry fail rather than creating a proxy circle', async () => {
  const provider = mockProvider(emptyIsochroneResponse);
  await assert.rejects(provider.getIsochrone({ center }), { code: 'empty_geometry' });
  for (const path of [
    '120,30;121,31',
    '120,30;120,30;120,30',
    '120,30;121,31;122,32',
    '120,30;181,31;122,30',
    '120,30;121,30;not-a-number,31',
    '120,30;121,30;121,',
  ]) {
    assert.throws(() => parseIsochronePath(path), { code: 'invalid_geometry' });
  }
});

test('invalid center, mode and duration never call the provider', async () => {
  const seen = [];
  const provider = mockProvider(validIsochroneResponse, seen);
  await assert.rejects(provider.getIsochrone({ center: { lng: 200, lat: 30 } }), TypeError);
  await assert.rejects(provider.getIsochrone({ center, mode: 'flying' }), TypeError);
  await assert.rejects(provider.getIsochrone({ center, minutes: 60 }), RangeError);
  assert.equal(seen.length, 0);
});

test('unverified permission and provider status 9 never masquerade as a successful polygon', async () => {
  let calls = 0;
  const client = createBaiduClient({
    mode: 'mock', maxRetries: 0,
    fetchImpl: async () => {
      calls += 1;
      return response(validIsochroneResponse);
    },
  });
  const disabled = createBaiduIsochroneProvider({ client });
  await assert.rejects(disabled.getIsochrone({ center }), (error) =>
    error instanceof BaiduApiError && error.code === 'permission_unverified');
  assert.equal(calls, 0);
  const denied = mockProvider(permissionDeniedResponse);
  await assert.rejects(denied.getIsochrone({ center }), { code: 'permission_denied' });
});

test('a successful status without result.path is invalid response', async () => {
  const provider = mockProvider({ status: 0, result: {} });
  await assert.rejects(provider.getIsochrone({ center }), { code: 'invalid_geometry' });
});

test('official isochrone request forwards cancellation signal', async () => {
  const controller = new AbortController();
  let seenSignal;
  const provider = createBaiduIsochroneProvider({
    enabled: true,
    client: { requestJson: async ({ signal }) => {
      seenSignal = signal;
      return { data: validIsochroneResponse, meta: { retrievedAt: '2026-09-30T00:00:00Z' } };
    } },
  });
  await provider.getIsochrone({ center, signal: controller.signal });
  assert.equal(seenSignal, controller.signal);
});