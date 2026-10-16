import test from 'node:test';
import assert from 'node:assert/strict';
import { runWalkingValidation, REAL_VALIDATION_CATEGORY_IDS } from './walking-validation.mjs';
import { WalkingCostCache } from './travel-cost-analysis.mjs';

const center = { lat: 30.288902, lng: 120.150993 };
const categories = Object.fromEntries(REAL_VALIDATION_CATEGORY_IDS.map((id) => [id, {
  label: id,
  query: id,
}]));

function mockFetch({ duration = 900, routeFailureAt = null } = {}) {
  let routeCalls = 0;
  let activeRoutes = 0;
  let maxActiveRoutes = 0;
  const calls = [];
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    calls.push(url);
    assert.equal(options.signal instanceof AbortSignal, true);
    if (url.pathname === '/place/v3/around') {
      const category = url.searchParams.get('query');
      const index = REAL_VALIDATION_CATEGORY_IDS.indexOf(category);
      return Response.json({
        status: 0,
        results: [{
          uid: `uid-${category}`,
          name: `${category} facility`,
          location: { lat: center.lat + (index + 1) * 0.0001, lng: center.lng },
        }],
      });
    }
    assert.equal(url.pathname, '/direction/v2/walking');
    routeCalls += 1;
    activeRoutes += 1;
    maxActiveRoutes = Math.max(maxActiveRoutes, activeRoutes);
    assert.equal(url.searchParams.get('coord_type'), 'bd09ll');
    assert.equal(url.searchParams.get('ret_coordtype'), 'bd09ll');
    assert.equal(url.searchParams.get('origin'), '30.288902,120.150993');
    assert.ok(url.searchParams.has('destination_uid'));
    assert.equal(url.searchParams.get('ak'), 'test-secret');
    await new Promise((resolve) => setTimeout(resolve, 3));
    activeRoutes -= 1;
    if (routeFailureAt === routeCalls) return Response.json({ status: 1 });
    return Response.json({ status: 0, result: { routes: [{ duration, distance: 1250 }] } });
  };
  return { fetchImpl, calls, get routeCalls() { return routeCalls; }, get maxActiveRoutes() { return maxActiveRoutes; } };
}

test('validates eight real-target records, BD-09LL parameters, route fields and analysis_run counters', async () => {
  const mock = mockFetch({ duration: 900 });
  const result = await runWalkingValidation({
    center, categories, serverAk: 'test-secret', fetchImpl: mock.fetchImpl,
    retrievedAt: '2026-09-25T00:00:00.000Z',
    cache: new WalkingCostCache(),
    budget: { networkRequests: 0 },
  });
  const run = result.analysis_run;
  assert.equal(result.coordinateSystem, 'BD-09LL');
  assert.equal(run.geometry, null);
  assert.equal(run.apiStats.attempted, 8);
  assert.equal(run.apiStats.succeeded, 8);
  assert.equal(run.apiStats.failed, 0);
  assert.equal(run.apiStats.maxConcurrent, 2);
  assert.equal(run.apiStats.retryCount, 0);
  assert.equal(run.apiStats.coveredCount, 8);
  assert.ok(run.travelCosts.every((record) => record.distanceMeters === 1250));
  assert.ok(run.travelCosts.every((record) => record.coverageStatus === 'covered'));
  assert.ok(run.travelCosts.every((record) => record.httpStatus === 200 && record.apiStatus === 0 && record.routeExists));
  assert.equal(mock.routeCalls, 8);
  assert.ok(mock.maxActiveRoutes <= 2);
  assert.equal(JSON.stringify(result).includes('test-secret'), false);
});

test('901 seconds is over threshold and missing routes remain unknown with reference-only distance', async () => {
  const mock = mockFetch({ duration: 901 });
  const cache = new WalkingCostCache();
  const result = await runWalkingValidation({
    center, categories, serverAk: 'test-secret', fetchImpl: async (input, options) => {
      const url = new URL(input);
      if (url.pathname === '/direction/v2/walking') {
        const routeIndex = mock.calls.filter((call) => call.pathname === '/direction/v2/walking').length + 1;
        if (routeIndex === 1) {
          mock.calls.push(url);
          return Response.json({ status: 0, result: { routes: [] } });
        }
      }
      return mock.fetchImpl(input, options);
    }, cache, budget: { networkRequests: 0 },
  });
  const records = result.analysis_run.travelCosts;
  assert.equal(records[0].routeExists, false);
  assert.equal(records[0].coverageStatus, 'unknown');
  assert.equal(records[0].straightLineSource, 'reference_only');
  assert.equal(records[1].coverageStatus, 'over_threshold');
  assert.equal(records[0].durationSeconds, null);
});

test('walking permission or service error stops further walking requests and keeps outcomes unknown', async () => {
  const mock = mockFetch({ routeFailureAt: 1 });
  const result = await runWalkingValidation({
    center, categories, serverAk: 'test-secret', fetchImpl: mock.fetchImpl,
    cache: new WalkingCostCache(), budget: { networkRequests: 0 },
  });
  assert.equal(mock.routeCalls, 1);
  assert.equal(result.status, 'partial');
  assert.ok(result.analysis_run.travelCosts.every((record) => record.coverageStatus === 'unknown'));
  assert.ok(result.warnings.some((warning) => warning.includes('停止后续真实路线请求')));
});

test('successful route cache hits avoid a second upstream walking request', async () => {
  const cache = new WalkingCostCache();
  const budget = { networkRequests: 0 };
  const mockFirst = mockFetch();
  const first = await runWalkingValidation({
    center, categories, serverAk: 'test-secret', fetchImpl: mockFirst.fetchImpl, cache, budget,
  });
  const mockSecond = mockFetch();
  const second = await runWalkingValidation({
    center, categories, serverAk: 'test-secret', fetchImpl: mockSecond.fetchImpl, cache, budget,
  });
  assert.equal(mockFirst.routeCalls, 8);
  assert.equal(mockSecond.routeCalls, 0);
  assert.equal(second.analysis_run.apiStats.cacheHits, 8);
  assert.equal(second.analysis_run.apiStats.attempted, 0);
  assert.equal(second.analysis_run.apiStats.succeeded, 8);
  assert.equal(budget.networkRequests, 8);
  assert.equal(first.analysis_run.travelCosts[0].cached, false);
  assert.equal(second.analysis_run.travelCosts[0].cached, true);
});

test('process budget never permits more than ten real walking requests', async () => {
  const budget = { networkRequests: 0 };
  const uncached = { get: () => null, set: () => {} };
  const mock = mockFetch();
  const first = await runWalkingValidation({
    center, categories, serverAk: 'test-secret', fetchImpl: mock.fetchImpl,
    cache: uncached, budget,
  });
  const second = await runWalkingValidation({
    center, categories, serverAk: 'test-secret', fetchImpl: mock.fetchImpl,
    cache: uncached, budget,
  });
  assert.equal(first.analysis_run.apiStats.networkRequests, 8);
  assert.equal(second.analysis_run.apiStats.networkRequests, 2);
  assert.equal(budget.networkRequests, 10);
  assert.equal(mock.routeCalls, 10);
  assert.equal(second.analysis_run.apiStats.routeRequestsPlanned, 8);
  assert.ok(second.analysis_run.travelCosts.filter((record) => record.routeExists).length <= 2);
  assert.ok(second.analysis_run.travelCosts.some((record) => record.failureReason === 'route_request_limit_reached'));
});

test('uses provider POI result order without ranking targets by straight-line distance', async () => {
  const mock = mockFetch();
  let firstCategoryRouteDestination = null;
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    if (url.pathname === '/place/v3/around' && url.searchParams.get('query') === 'medical') {
      return Response.json({
        status: 0,
        results: [
          { uid: 'provider-first', name: 'First from provider', location: { lat: center.lat + 0.001, lng: center.lng } },
          { uid: 'geometrically-closer', name: 'Second from provider', location: { lat: center.lat + 0.0001, lng: center.lng } },
        ],
      });
    }
    if (url.pathname === '/direction/v2/walking' && url.searchParams.get('destination_uid') === 'provider-first') {
      firstCategoryRouteDestination = url.searchParams.get('destination');
      return Response.json({ status: 0, result: { routes: [{ duration: 300, distance: 500 }] } });
    }
    return mock.fetchImpl(input, options);
  };
  const result = await runWalkingValidation({
    center, categories, serverAk: 'test-secret', fetchImpl,
    cache: new WalkingCostCache(), budget: { networkRequests: 0 },
  });
  assert.equal(result.analysis_run.travelCosts[0].placeName, 'First from provider');
  assert.equal(firstCategoryRouteDestination, `${(center.lat + 0.001).toFixed(6)},${center.lng.toFixed(6)}`);
});
