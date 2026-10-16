import test from 'node:test';
import assert from 'node:assert/strict';
import { FACILITY_CATEGORY_IDS } from './facility-categories.mjs';
import { createLegacyFacilityAnalysis as createFacilityAnalysis } from './facility-analysis.mjs';
import { evaluateFacilityAccess } from './facility-coverage.mjs';

const origin = { id: 'community-poi', uid: 'community-uid', location: { lat: 30.288902, lng: 120.150993 } };
const candidate = (uid, latOffset = 0.001) => ({
  uid, name: uid, location: { lat: origin.location.lat + latOffset, lng: origin.location.lng },
});
const official = {
  geometrySource: 'baidu_isochrone', coordinateSystem: 'BD-09LL',
  geojson: { type: 'FeatureCollection', features: [{
    type: 'Feature', properties: { geometrySource: 'baidu_isochrone' },
    geometry: { type: 'Polygon', coordinates: [[
      [120.15, 30.288], [120.152, 30.288], [120.152, 30.29],
      [120.15, 30.29], [120.15, 30.288],
    ]] },
  }] },
};

test('all eight classes carry searchable and route evidence statuses without a POI-count score', async () => {
  let calls = 0;
  const service = createFacilityAnalysis({
    placeProvider: { searchAround: async ({ categoryId }) => {
      const number = FACILITY_CATEGORY_IDS.indexOf(categoryId) + 1;
      if (categoryId === 'commerce') return { status: 'partial', searchComplete: false, truncated: true,
        candidates: [], pages: [{ pageNum: 0 }], errors: [{ code: 'page_limit_reached' }] };
      if (categoryId === 'parks') return { status: 'complete', searchComplete: true, truncated: false,
        candidates: [], pages: [{ pageNum: 0 }], errors: [] };
      return { status: 'complete', searchComplete: true, truncated: false,
        candidates: [candidate(categoryId, number / 10000)], pages: [{ pageNum: 0 }], errors: [] };
    } },
    routeProvider: { route: async (_from, to) => {
      calls++;
      const number = Math.round((to.lat - origin.location.lat) * 10000);
      if (number === 4) return { routeStatus: 'timeout', durationSeconds: null };
      return { routeStatus: 'ok', durationSeconds: number === 2 ? 901 : 900,
        distanceMeters: 500, source: 'direction_lite' };
    } },
  });
  const result = await service.analyze({ origin });
  assert.equal(result.categories.length, 8);
  assert.equal(result.status, 'partial');
  assert.equal(result.categories[0].coverageStatus, 'covered');
  assert.equal(result.categories[1].coverageStatus, 'over_threshold');
  assert.equal(result.categories[2].coverageStatus, 'unknown_search');
  assert.equal(result.categories[3].coverageStatus, 'unknown_route');
  assert.equal(result.categories[6].coverageStatus, 'unknown_route');
  assert.equal(result.categories[0].shortestRouteSeconds, 900);
  assert.equal(result.categories[1].shortestRouteSeconds, 901);
  assert.equal(result.categories[0].routes[0].source, 'direction_lite');
  assert.equal(result.categories[0].evidenceIds.length, 1);
  assert.equal(result.categories[2].searchTruncated, true);
  assert.equal(calls, 6);
  assert.equal('score' in result, false);
});

test('official outside POI and sampled cells cannot establish or deny coverage without a route', async () => {
  const outside = { ...candidate('outer', 0.03), naviLocation: { lat: origin.location.lat + 0.02, lng: origin.location.lng } };
  let calls = 0;
  const placeProvider = { searchAround: async () => ({
    status: 'complete', searchComplete: true, truncated: false,
    candidates: [outside], pages: [{ pageNum: 0 }], errors: [],
  }) };
  const routeProvider = { route: async (_from, to) => {
    calls++;
    assert.deepEqual(to, outside.naviLocation);
    return { routeStatus: 'ok', durationSeconds: 900, distanceMeters: 2000 };
  } };
  const service = createFacilityAnalysis({ placeProvider, routeProvider });
  const officialResult = await service.analyze({ origin, categoryIds: ['medical'], geometry: official });
  assert.equal(officialResult.categories[0].geometryPreselection.outsideDeferredCount, 1);
  assert.equal(officialResult.categories[0].coverageStatus, 'covered');
  const sampled = await service.analyze({ origin, categoryIds: ['medical'],
    geometry: { ...official, geometrySource: 'walking_sampling_fallback' } });
  assert.equal(sampled.categories[0].geometryPreselection.outsideDeferredCount, 0);
  assert.equal(sampled.categories[0].coverageStatus, 'covered');
  assert.equal(calls, 2);
  const failed = createFacilityAnalysis({ placeProvider, routeProvider: {
    route: async () => ({ routeStatus: 'timeout', durationSeconds: null }),
  } });
  assert.equal((await failed.analyze({ origin, categoryIds: ['medical'], geometry: official }))
    .categories[0].coverageStatus, 'unknown_route');
});

test('partial search cannot prove 901-second absence, while one valid 900-second witness confirms coverage', async () => {
  const incomplete = { searchComplete: false, status: 'partial', truncated: true,
    candidates: [candidate('one')], pages: [], errors: [{ code: 'request_budget_exhausted' }] };
  const make = (seconds) => createFacilityAnalysis({
    placeProvider: { searchAround: async () => incomplete },
    routeProvider: { route: async () => ({ routeStatus: 'ok', durationSeconds: seconds, distanceMeters: 700 }) },
  });
  assert.equal((await make(901).analyze({ origin, categoryIds: ['medical'] })).categories[0].coverageStatus, 'unknown_search');
  assert.equal((await make(900).analyze({ origin, categoryIds: ['medical'] })).categories[0].coverageStatus, 'covered');
});

test('verified batch route evidence keeps shortest seconds and each evidence ID', async () => {
  let singles = 0;
  const result = await evaluateFacilityAccess({
    demandPoint: origin, categoryId: 'medical',
    facilities: [candidate('a', 0.001), candidate('b', 0.002)], searchComplete: true,
    provider: {
      canBatch: () => true,
      routeMany: async () => [
        { routeStatus: 'ok', durationSeconds: 901, distanceMeters: 600, source: 'route_matrix' },
        { routeStatus: 'ok', durationSeconds: 900, distanceMeters: 700, source: 'route_matrix' },
      ],
      route: async () => { singles++; return { routeStatus: 'no_route' }; },
    },
  });
  assert.equal(singles, 0);
  assert.equal(result.coverageStatus, 'covered');
  assert.equal(result.shortestRouteSeconds, 900);
  assert.equal(result.candidatesRouted, 2);
  assert.equal(result.evidenceIds.length, 2);
  assert.equal(result.routes[1].source, 'route_matrix');
});
