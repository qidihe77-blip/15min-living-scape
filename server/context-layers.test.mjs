import test from 'node:test';
import assert from 'node:assert/strict';
import { createBaiduTrafficProvider, parseTrafficAround } from './baidu-traffic.mjs';
import { createContextLayerManager, normalizeAoiBoundary, normalizeTrafficEvents } from './context-layers.mjs';

const center = { lng: 120.15, lat: 30.28 };
const origin = { source: 'baidu_poi', uid: 'poi-1', location: center };
const stamp = '2026-09-30T00:00:00.000Z';

test('Traffic around uses BD-09LL request and only real returned link paths become geometry', async () => {
  let request;
  const provider = createBaiduTrafficProvider({ client: { requestJson: async (options) => {
    request = options;
    return { data: { evaluation: { status: 2 }, road_traffic: [
      { road_name: '路甲', traffic_detail: [
        { status: 3, path: '120.15,30.28;120.16,30.29' },
        { status: 2, path: 'bad' },
      ] },
    ] }, meta: { retrievedAt: stamp } };
  } } });
  const result = await provider.around({ center });
  assert.equal(request.path, '/traffic/v1/around');
  assert.equal(request.params.center, '30.280000,120.150000');
  assert.equal(request.params.coord_type_input, 'bd09ll');
  assert.equal(result.status, 'available');
  assert.equal(result.evaluationLabel, '缓行');
  assert.equal(result.geojson.features.length, 1);
  assert.equal(result.geojson.features[0].properties.congestionStatus, 3);
  assert.equal(result.expiresAt, '2026-09-30T00:02:00.000Z');
});

test('basic traffic response without advanced road coordinates remains a summary, not a fabricated line', () => {
  const result = parseTrafficAround({ evaluation: { status: 1 }, road_traffic: [] },
    { retrievedAt: stamp });
  assert.equal(result.status, 'available');
  assert.equal(result.detailStatus, 'no_link_paths');
  assert.equal(result.geojson.features.length, 0);
  assert.equal(parseTrafficAround({ evaluation: { status: 0 } },
    { retrievedAt: stamp }).status, 'unknown');
  assert.throws(() => parseTrafficAround({ evaluation: { status: 1 }, road_traffic: {} },
    { retrievedAt: stamp }));
});

test('unverified services never call providers and non-driving modes never query traffic', async () => {
  let calls = 0;
  const provider = { around: async () => { calls += 1; throw new Error('should not call'); } };
  const manager = createContextLayerManager({ trafficProvider: provider,
    trafficEnabled: false, trafficRequestLimit: 1 });
  const driving = await manager.load({ mode: 'driving', origin });
  const walking = await manager.load({ mode: 'walking', origin });
  assert.equal(driving.traffic.status, 'permission_unverified');
  assert.equal(walking.traffic.status, 'not_applicable');
  assert.equal(calls, 0);
});

test('traffic expires to unknown and cannot affect the score evidence', async () => {
  let now = Date.parse(stamp);
  const manager = createContextLayerManager({ now: () => now, trafficEnabled: true,
    trafficRequestLimit: 1, trafficProvider: { around: async () => parseTrafficAround({
      evaluation: { status: 3 }, road_traffic: [],
    }, { retrievedAt: stamp }) } });
  const result = await manager.load({ mode: 'driving', origin });
  assert.equal(result.traffic.status, 'available');
  now += 121000;
  const stale = manager.freshen(result);
  assert.equal(stale.traffic.status, 'stale');
  assert.equal(stale.traffic.geojson.features.length, 0);
  assert.equal(result.traffic.status, 'available');
  const next = await manager.load({ mode: 'driving', origin });
  assert.equal(next.traffic.status, 'budget_exhausted');
});

test('AOI requires matching UID and valid closed BD-09LL polygon', async () => {
  const geometry = { type: 'Polygon', coordinates: [[
    [120.15, 30.28], [120.16, 30.28], [120.16, 30.29], [120.15, 30.28],
  ]] };
  assert.equal(normalizeAoiBoundary({ uid: 'poi-1', coordinateSystem: 'BD-09LL', geometry },
    'poi-1').status, 'available');
  assert.throws(() => normalizeAoiBoundary({ uid: 'wrong', coordinateSystem: 'BD-09LL', geometry },
    'poi-1'));
  const manager = createContextLayerManager({ aoiEnabled: true, aoiRequestLimit: 1,
    aoiProvider: { getBoundary: async () => ({ uid: 'poi-1', coordinateSystem: 'BD-09LL', geometry }) } });
  assert.equal((await manager.load({ mode: 'walking', origin })).aoi.status, 'available');
  assert.equal((await manager.load({ mode: 'walking', origin: { ...origin, uid: null } })).aoi.status, 'no_uid');
});

test('traffic event empty, failure and permission states are distinct', async () => {
  const empty = normalizeTrafficEvents({ coordinateSystem: 'BD-09LL', events: [] },
    { retrievedAt: stamp });
  assert.equal(empty.status, 'empty');
  assert.throws(() => normalizeTrafficEvents({ coordinateSystem: 'WGS84', events: [] },
    { retrievedAt: stamp }));
  const manager = createContextLayerManager({ eventsEnabled: true, eventsRequestLimit: 2,
    eventsProvider: { getEvents: async () => { throw Object.assign(new Error('denied'),
      { code: 'permission_denied' }); } } });
  assert.deepEqual((await manager.load({ mode: 'driving', origin })).events,
    { status: 'failed', code: 'permission_denied' });
  assert.equal((await manager.load({ mode: 'walking', origin })).events.status, 'not_applicable');
});
