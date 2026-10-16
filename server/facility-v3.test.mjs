import test from 'node:test';
import assert from 'node:assert/strict';
import { createFacilityAnalysis } from './facility-analysis.mjs';
import { FACILITY_GROUP_IDS } from './facility-categories.mjs';
import { evaluateSubtypeAccess, mergeFacilityCandidatesV3 } from './nearest-facility.mjs';

const origin = { id: 'fixture-origin', uid: 'origin-uid', location: { lat: 30.288902, lng: 120.150993 } };
const poi = (uid, name = '社区药店', offset = 0.001, extra = {}) => ({ uid, name,
  location: { lat: origin.location.lat + offset, lng: origin.location.lng }, ...extra });
const good = (durationSeconds = 900, distanceMeters = 600) => ({ mode: 'walking', routeStatus: 'ok',
  durationSeconds, distanceMeters, coordinateSystem: 'BD-09LL', source: 'fixture', retrievedAt: '2026-10-05T00:00:00Z' });
const search = (candidates = [], overrides = {}) => ({ status: 'complete', searchComplete: true,
  candidates, pages: [{ pageNum: 0 }], errors: [], ...overrides });
const evaluate = (options = {}) => evaluateSubtypeAccess({ demandPoint: origin, subtypeId: 'pharmacy',
  searchComplete: true, provider: { route: async () => good() }, ...options });

test('nearest uses walking meters among confirmed <=900-second candidates and does not stop at first reachable', async () => {
  const calls = [];
  const result = await evaluate({ facilities: [poi('near-straight', '药店A', 0.001), poi('near-road', '药店B', 0.002)],
    maxRouteCandidates: 3, provider: { route: async (_from, _to, options) => {
      calls.push(options.destinationUid);
      return options.destinationUid === 'near-straight' ? good(500, 1100) : good(850, 400);
    } } });
  assert.equal(calls.length, 2);
  assert.equal(result.nearestReachable.uid, 'near-road');
  assert.equal(result.nearestReachable.distanceMeters, 400);
  assert.equal(result.nearestReachable.durationSeconds, 850);
  assert.equal(result.nearestStatus, 'nearest_in_declared_search');
  assert.equal(result.reachableCountLowerBound, 2);
});

test('nearest ties use duration then UID and 901 seconds never joins eligible candidates', async () => {
  const result = await evaluate({ facilities: [poi('z'), poi('b'), poi('a')], maxRouteCandidates: 3,
    provider: { route: async (_from, _to, options) => good(options.destinationUid === 'z' ? 901 : 900, 400) } });
  assert.equal(result.nearestReachable.uid, 'a');
  assert.equal(result.reachableCountLowerBound, 2);
  assert.equal(result.candidatesRouted, 3);
});

test('pending classification is never routed; complete empty searches are declared-window absence and incomplete searches unknown', async () => {
  let calls = 0;
  const pending = await evaluate({ facilities: [poi('unknown', '仁心')], provider: { route: async () => { calls++; return good(); } } });
  assert.equal(pending.accessStatus, 'unknown');
  assert.ok(pending.unknownReasons.includes('classification_pending'));
  assert.equal(calls, 0);
  assert.equal((await evaluate()).accessStatus, 'no_reachable_in_declared_search');
  assert.equal((await evaluate({ searchComplete: false })).accessStatus, 'unknown');
  const failed = await evaluate({ facilities: [poi('failed')], provider: { route: async () => ({ routeStatus: 'timeout' }) } });
  assert.equal(failed.accessStatus, 'unknown');
  assert.equal(failed.nearestReachable, null);
});

test('partial searches and candidate caps allow witnesses but never complete nearest claims', async () => {
  for (const extra of [{ searchComplete: false }, { facilities: [poi('first'), poi('unrouted')] }]) {
    const result = await evaluate({ facilities: [poi('first')], ...extra });
    assert.equal(result.accessStatus, 'reachable');
    assert.equal(result.nearestStatus, 'nearest_verified_partial');
  }
  const over = await evaluate({ facilities: [poi('late')], provider: { route: async () => good(901) } });
  assert.equal(over.accessStatus, 'no_reachable_in_declared_search');
});

test('invalid distance or mismatched route endpoint cannot become a reachable witness', async () => {
  for (const route of [{ ...good(), distanceMeters: null }, { ...good(), distanceMeters: -1 },
    { ...good(), mode: 'driving' }, { ...good(), requestedDestination: { location: origin.location, uid: 'wrong' } }]) {
    const result = await evaluate({ facilities: [poi('target')], provider: { route: async () => route } });
    assert.equal(result.accessStatus, 'unknown');
    assert.equal(result.routes[0].routeStatus, 'invalid_route');
  }
});

test('v3 candidate merge keeps UID membership evidence and conservative anonymous identities', () => {
  const result = mergeFacilityCandidatesV3([poi('same', '小学部'), poi('same', '初中部'),
    poi('other', '小学部'), poi(null, '门店A'), poi(null, '门店A'), poi(null, '门店B')]);
  assert.equal(result.candidates.length, 4);
  assert.equal(result.candidates[0].classificationEvidence.length, 2);
  assert.deepEqual(result.duplicateUids, ['same']);
  assert.equal(result.candidates[2].identityStatus, 'missing_uid_low_confidence');
});

test('six-group analysis emits all 25 slots, preserves a one-of-four medical result and excludes base-map counts', async () => {
  const queried = [];
  const analysis = await createFacilityAnalysis({ placeProvider: { searchAround: async ({ subtypeId }) => {
    queried.push(subtypeId);
    return search(subtypeId === 'pharmacy' ? [poi('p')] : []);
  } }, routeProvider: { route: async () => good() } }).analyze({ origin, region: '上海市' });
  assert.deepEqual(analysis.categories.map((row) => row.categoryId), FACILITY_GROUP_IDS);
  assert.equal(queried.length, 25);
  assert.equal(analysis.categories.flatMap((row) => row.subtypeResults).length, 25);
  assert.equal(analysis.categoryMappingVersion, 'facility-categories-v3');
  assert.equal(analysis.region, '上海市');
  assert.equal(analysis.categories[1].reachableSubtypeCount, 1);
  assert.equal(analysis.categories[1].totalSubtypeCount, 4);
  assert.equal(analysis.categories[1].allSubtypesReachable, false);
  assert.equal(analysis.categories[1].nearestReachableAnySubtype.subtypeId, 'pharmacy');
  assert.equal(analysis.uniqueUidCount, 1);
  assert.equal('score' in analysis, false);
});

test('same UID in primary and junior school queries produces one marker and one route, with separate subtype evidence', async () => {
  let calls = 0;
  const analysis = await createFacilityAnalysis({ placeProvider: { searchAround: async ({ subtypeId }) => search(
    subtypeId === 'primary_school' ? [poi('school', '实验学校小学部')]
      : subtypeId === 'junior_school' ? [poi('school', '实验学校初中部')] : []) },
  routeProvider: { route: async () => { calls++; return good(); } } }).analyze({ origin });
  const education = analysis.categories[0];
  assert.equal(calls, 1);
  assert.equal(education.reachableSubtypeCount, 2);
  assert.equal(education.uniqueUidCount, 1);
  assert.equal(education.reachableCountLowerBound, 1);
  assert.equal(analysis.poiMarkers.length, 1);
  assert.deepEqual(analysis.poiMarkers[0].subtypeIds, ['primary_school', 'junior_school']);
  const results = education.subtypeResults.filter((row) => row.accessStatus === 'reachable');
  assert.equal(results[0].evidenceIds[0], results[1].evidenceIds[0]);
});

test('different entrances do not reuse costs and missing pages, failed classification or invalid candidates stay unknown', async () => {
  let calls = 0;
  const memo = new Map();
  const provider = { route: async () => { calls++; return good(); } };
  await evaluate({ facilities: [poi('same', '药店', 0.001)], provider, routeMemo: memo });
  await evaluate({ facilities: [poi('same', '药店', 0.002)], provider, routeMemo: memo });
  assert.equal(calls, 2);
  const analysis = await createFacilityAnalysis({ placeProvider: { searchAround: async ({ subtypeId }) =>
    subtypeId === 'pharmacy' ? search([poi('bad', '药店', 0, { location: { lat: 999, lng: 120 } })])
      : subtypeId === 'primary_school' ? search([poi('school', '九年一贯制学校')])
        : search([], { status: 'partial', searchComplete: false }) }, routeProvider: provider }).analyze({ origin });
  assert.equal(analysis.status, 'partial');
  assert.equal(analysis.categories[1].subtypeResults.find((row) => row.subtypeId === 'pharmacy').accessStatus, 'unknown');
  assert.equal(analysis.categories[0].subtypeResults.find((row) => row.subtypeId === 'primary_school').accessStatus, 'unknown');
});

test('v3 analysis refuses a display subset, another mode or another time threshold', async () => {
  const analysis = createFacilityAnalysis({ placeProvider: { searchAround: async () => search() },
    routeProvider: { route: async () => good() } });
  for (const invalid of [{ categoryIds: ['medical'] }, { mode: 'cycling' }, { minutes: 20 }, { subtypeScope: 'pharmacy' }]) {
    await assert.rejects(() => analysis.analyze({ origin, ...invalid }), /all six groups/);
  }
});
