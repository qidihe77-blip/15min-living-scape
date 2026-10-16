import test from 'node:test';
import assert from 'node:assert/strict';
import { BaiduApiError } from './baidu-client.mjs';
import { createBaiduRouteProvider, parseBaiduStepGeometry } from './baidu-route.mjs';
import { createWalkingProvider } from './walking-provider.mjs';

const origin = { lat: 30.288902, lng: 120.150993, uid: 'origin-uid' };
const destination = { lat: 30.29, lng: 120.151, uid: 'destination-uid' };
const ok = (duration = 900) => ({ status: 0, result: { routes: [{ duration, distance: 600 }] } });
function clientFrom(reply) {
  const calls = [];
  return { calls, client: { requestJson: async (input) => {
    calls.push(input);
    return { data: await reply(input), meta: { retrievedAt: '2026-09-29T00:00:00Z', cached: false } };
  } } };
}

test('Direction Lite uses mode endpoints, lat/lng order and UID; 900/901 remain exact seconds', async () => {
  const { client, calls } = clientFrom(({ path }) => ok(path.endsWith('walking') ? 900 : 901));
  const provider = createBaiduRouteProvider({ client, liteRequestLimit: 3 });
  const walking = await provider.route(origin, destination);
  const cycling = await provider.route(origin, destination, { mode: 'cycling' });
  const driving = await provider.route(origin, destination, { mode: 'driving' });
  assert.deepEqual(calls.map((call) => call.path), [
    '/directionlite/v1/walking', '/directionlite/v1/riding', '/directionlite/v1/driving',
  ]);
  assert.equal(calls[0].params.origin, '30.288902,120.150993');
  assert.equal(calls[0].params.destination, '30.290000,120.151000');
  assert.equal(calls[0].params.origin_uid, 'origin-uid');
  assert.equal(calls[0].params.destination_uid, 'destination-uid');
  assert.equal(walking.durationSeconds, 900);
  assert.equal(cycling.durationSeconds, 901);
  assert.equal(driving.durationSeconds, 901);
  assert.equal((await provider.route(origin, destination)).cached, true);
  assert.equal((await provider.route(origin, { ...destination, uid: 'another-uid' })).routeStatus, 'route_request_limit_reached');
  assert.equal(calls.length, 3);
});

test('Lite no route, 429 and malformed duration remain unknown', async () => {
  const provider = createBaiduRouteProvider({
    client: { requestJson: async () => { throw new BaiduApiError('rate_limited', { service: 'direction_lite' }); } },
  });
  assert.equal((await provider.route(origin, destination)).routeStatus, 'rate_limited');
  const noRoute = createBaiduRouteProvider({ client: { requestJson: async () => {
    throw new BaiduApiError('provider_error', { service: 'direction_lite', apiStatus: 7 });
  } } });
  assert.equal((await noRoute.route(origin, destination)).routeStatus, 'no_route');
  const malformed = createBaiduRouteProvider({ client: { requestJson: async () => ({
    data: ok(-1), meta: { retrievedAt: '2026-09-29T00:00:00Z' },
  }) } });
  assert.equal((await malformed.route(origin, destination)).routeStatus, 'invalid_response');
});

test('Matrix is disabled until verified; output budget counts origin-destination products', async () => {
  const { client, calls } = clientFrom(() => ({ status: 0, result: [
    { duration: { value: 900 }, distance: { value: 600 } },
    { duration: { value: 901 }, distance: { value: 700 } },
    { duration: { value: 0 }, distance: { value: 0 } },
    { duration: { value: 800 }, distance: { value: 600 } },
  ] }));
  const blocked = createBaiduRouteProvider({ client, matrixEnabled: true, matrixOutputLimit: 4, matrixOutputQps: 4 });
  assert.equal((await blocked.routeMatrix({ origins: [origin], destinations: [destination] }))[0].routeStatus, 'matrix_unverified');
  assert.equal(calls.length, 0);
  const provider = createBaiduRouteProvider({ client, matrixEnabled: true, matrixVerified: true, matrixOutputLimit: 4, matrixOutputQps: 4 });
  const origins = [origin, { lat: 30.29, lng: 120.15 }];
  const targets = [destination, { lat: 30.3, lng: 120.16 }];
  const routes = await provider.routeMatrix({ origins, destinations: targets });
  assert.equal(calls[0].path, '/routematrix/v2/walking');
  assert.equal(calls[0].params.origins, '30.288902,120.150993;origin-uid|30.290000,120.150000');
  assert.equal(routes[0].durationSeconds, 900);
  assert.equal(routes[1].durationSeconds, 901);
  assert.equal(routes[2].routeStatus, 'no_route');
  assert.equal(provider.stats().matrixOutputRoutes, 4);
  assert.equal(provider.stats().matrixRequests, 1);
  assert.equal((await provider.routeMatrix({ origins, destinations: targets }))[0].routeStatus, 'route_request_limit_reached');
  assert.equal(calls.length, 1);
});

test('Matrix failure falls back to bounded Lite routes without losing order', async () => {
  const { client, calls } = clientFrom(({ service }) => {
    if (service === 'route_matrix') throw new BaiduApiError('rate_limited', { service });
    return ok(900);
  });
  const provider = createBaiduRouteProvider({
    client, matrixEnabled: true, matrixVerified: true, matrixOutputLimit: 2, matrixOutputQps: 2, liteRequestLimit: 1,
  });
  const routes = await provider.routeMany({ origin, destinations: [destination, { lat: 30.3, lng: 120.16 }] });
  assert.deepEqual(routes.map((route) => route.routeStatus), ['ok', 'route_request_limit_reached']);
  assert.equal(provider.stats().matrixOutputRoutes, 2);
  assert.equal(provider.stats().liteRequests, 1);
  assert.deepEqual(calls.map((call) => call.service), ['route_matrix', 'direction_lite']);
});

test('Matrix local QPS gate uses output route count, then resets after a second', async () => {
  let clock = 1000;
  const { client, calls } = clientFrom(() => ({ status: 0, result: [
    { duration: { value: 900 }, distance: { value: 600 } },
    { duration: { value: 901 }, distance: { value: 700 } },
  ] }));
  const provider = createBaiduRouteProvider({
    client, matrixEnabled: true, matrixVerified: true,
    matrixOutputLimit: 6, matrixOutputQps: 3, now: () => clock,
  });
  const targets = [destination, { lat: 30.3, lng: 120.16 }];
  assert.equal((await provider.routeMatrix({ origins: [origin], destinations: targets }))[0].routeStatus, 'ok');
  assert.equal((await provider.routeMatrix({ origins: [origin], destinations: targets }))[0].routeStatus, 'matrix_local_rate_limited');
  assert.equal(provider.stats().matrixOutputRoutes, 2);
  assert.equal(calls.length, 1);
  clock = 2001;
  assert.equal((await provider.routeMatrix({ origins: [origin], destinations: targets }))[0].routeStatus, 'ok');
  assert.equal(provider.stats().matrixOutputRoutes, 4);
  assert.equal(calls.length, 2);
});

test('Lite details parse BD-09LL provider paths and bind costs, UIDs and geometry to one response', async () => {
  const { client, calls } = clientFrom(() => ({ status: 0, result: { routes: [{ duration: 901, distance: 800,
    steps: [{ path: '120.150993,30.288902;120.151,30.289' },
      { path: '120.151,30.289;120.151,30.290000;' }] }] } }));
  const provider = createBaiduRouteProvider({ client });
  const route = await provider.route(origin, destination, { includeGeometry: true });
  assert.equal(calls[0].params.steps_info, '1');
  assert.equal(route.durationSeconds, 901);
  assert.equal(route.geometryStatus, 'provider_path');
  assert.deepEqual(route.geometry, { type: 'LineString', coordinates: [
    [120.150993, 30.288902], [120.151, 30.289], [120.151, 30.29],
  ] });
  assert.equal(route.requestedDestination.uid, 'destination-uid');
  assert.deepEqual(route.requestedDestination.location, { lat: 30.29, lng: 120.151 });
  assert.match(route.evidenceId, /^route-/);
  assert.equal((await provider.route(origin, destination)).geometryStatus, 'provider_path');
  assert.equal(calls.length, 1);
});

test('path validation leaves holes and missing segments unconnected and never replaces invalid geometry with a straight line', () => {
  assert.equal(parseBaiduStepGeometry([{ path: '999,30;120,31' }]).geometry, null);
  assert.equal(parseBaiduStepGeometry([{ path: '120,30;;120,31' }]).geometry, null);
  assert.equal(parseBaiduStepGeometry([{ path: '120,30;120,31' }, {}]).geometryStatus, 'missing_path');
  const gaps = parseBaiduStepGeometry([{ path: '120,30;120,31' }, { path: '121,31;121,32' }]);
  assert.equal(gaps.geometry.type, 'MultiLineString');
  assert.deepEqual(gaps.geometry.coordinates, [[[120, 30], [120, 31]], [[121, 31], [121, 32]]]);
});

test('route cache keys separate UIDs, entrances and geometry requests; detail costs replace earlier Matrix evidence', async () => {
  let clock = 1000;
  const { client, calls } = clientFrom(({ service, params }) => service === 'route_matrix'
    ? { status: 0, result: [{ duration: { value: 900 }, distance: { value: 600 } }] }
    : { status: 0, result: { routes: [{ duration: params.steps_info ? 901 : 900, distance: 650,
      steps: [{ path: '120.150993,30.288902;120.151,30.29' }] }] } });
  const provider = createBaiduRouteProvider({ client, now: () => clock, matrixEnabled: true,
    matrixVerified: true, matrixOutputLimit: 1, matrixOutputQps: 1 });
  await provider.routeMatrix({ origins: [origin], destinations: [destination] });
  const cached = await provider.route(origin, destination);
  assert.equal(cached.source, 'route_matrix');
  assert.equal(cached.geometry, null);
  const detail = await provider.route(origin, destination, { includeGeometry: true });
  assert.equal(detail.source, 'direction_lite');
  assert.equal(detail.durationSeconds, 901);
  assert.equal((await provider.route(origin, destination)).durationSeconds, 901);
  await provider.route(origin, { ...destination, lat: destination.lat + 0.001 });
  await provider.route(origin, { ...destination, uid: 'second-shop' });
  assert.equal(calls.length, 4);
  clock += 300001;
  await provider.route(origin, destination);
  assert.equal(calls.length, 5);
});

test('walking sampler passes UIDs and keeps different entrance or UID costs apart', async () => {
  const calls = [];
  const provider = createWalkingProvider({ serverAk: 'offline-test-key', maxRequests: 4,
    fetchImpl: async (input) => { calls.push(new URL(input)); return Response.json(ok()); } });
  await provider.route(origin, destination);
  assert.equal(calls[0].searchParams.get('origin_uid'), 'origin-uid');
  assert.equal(calls[0].searchParams.get('destination_uid'), 'destination-uid');
  assert.equal((await provider.route(origin, destination)).cached, true);
  await provider.route(origin, { ...destination, lat: destination.lat + 0.001 });
  await provider.route(origin, { ...destination, uid: 'other-uid' });
  assert.equal(calls.length, 3);
});
