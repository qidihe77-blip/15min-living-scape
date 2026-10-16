import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessKilometerGap, dedupeFacilityCandidates, evaluateFacilityAccess, evaluateSpecialtyKilometerGap,
  straightDistanceMeters, summarizeDemandCoverage,
} from './facility-coverage.mjs';

const origin = { id: 'door-1', location: { lat: 30.288902, lng: 120.150993 } };
const facility = (uid, northMeters) => ({
  uid, name: uid, location: {
    lat: origin.location.lat + northMeters / (2 * Math.PI * 6_371_000 / 360),
    lng: origin.location.lng,
  },
});

test('UID deduplication is auditable and missing UID candidates are retained for review', () => {
  const result = dedupeFacilityCandidates([
    facility('u1', 200), facility('u1', 300),
    { ...facility('temp', 100), uid: null },
    { ...facility('temp', 100), uid: null },
    { uid: 'invalid', location: { lat: 999, lng: 0 } },
  ]);
  assert.equal(result.candidates.length, 3);
  assert.deepEqual(result.duplicateUids, ['u1']);
  assert.equal(result.invalidCount, 1);
});

test('one-kilometer absence remains independent of walking duration and unknown search', () => {
  assert.equal(assessKilometerGap({ origin: origin.location, facilities: [facility('near', 999)], searchComplete: true }).noFacilityWithinOneKilometer, false);
  assert.equal(assessKilometerGap({ origin: origin.location, facilities: [facility('far', 1001)], searchComplete: true, searchRadiusMeters: 1000 }).noFacilityWithinOneKilometer, true);
  assert.equal(assessKilometerGap({ origin: origin.location, facilities: [], searchComplete: false }).noFacilityWithinOneKilometer, null);
  assert.equal(assessKilometerGap({ origin: origin.location, facilities: [], searchComplete: true, searchRadiusMeters: 900 }).noFacilityWithinOneKilometer, null);
  assert.ok(straightDistanceMeters(origin.location, facility('near', 999).location) < 1000);
});

test('checks a second candidate after straight-line nearest takes 901 seconds', async () => {
  const calls = [];
  const provider = { route: async (_a, destination) => {
    calls.push(destination.lat);
    return { routeStatus: 'ok', durationSeconds: calls.length === 1 ? 901 : 900, distanceMeters: 1000 };
  } };
  const result = await evaluateFacilityAccess({
    demandPoint: origin, categoryId: 'medical',
    facilities: [facility('near', 100), facility('far', 200)],
    searchComplete: true, provider,
  });
  assert.equal(result.coverageStatus, 'covered');
  assert.equal(result.coveredByUid, 'far');
  assert.equal(result.shortestWalkingSeconds, 900);
  assert.equal(calls.length, 2);
  assert.equal(result.categoryMappingVersion, 'facility-categories-v2');
});

test('901 seconds is confirmed outside only when every candidate route and search are complete', async () => {
  const provider = { route: async () => ({ routeStatus: 'ok', durationSeconds: 901, distanceMeters: 1200 }) };
  const complete = await evaluateFacilityAccess({
    demandPoint: origin, categoryId: 'commerce', facilities: [facility('m', 200)],
    searchComplete: true, provider,
  });
  assert.equal(complete.coverageStatus, 'over_threshold');
  const incomplete = await evaluateFacilityAccess({
    demandPoint: origin, categoryId: 'commerce', facilities: [facility('m', 200)],
    searchComplete: false, provider,
  });
  assert.equal(incomplete.coverageStatus, 'unknown_search');
});

test('failure, candidate cap and zero candidates remain unknown rather than a false blind spot', async () => {
  const provider = { route: async () => ({ routeStatus: 'timeout', durationSeconds: null }) };
  const failed = await evaluateFacilityAccess({
    demandPoint: origin, categoryId: 'education',
    facilities: [facility('school', 300)], searchComplete: true, provider,
  });
  assert.equal(failed.coverageStatus, 'unknown_route');
  assert.equal(failed.shortestWalkingSeconds, null);
  const capped = await evaluateFacilityAccess({
    demandPoint: origin, categoryId: 'education',
    facilities: [facility('s1', 300), facility('s2', 500)],
    searchComplete: true, maxRouteCandidates: 1,
    provider: { route: async () => ({ routeStatus: 'ok', durationSeconds: 1000, distanceMeters: 1100 }) },
  });
  assert.equal(capped.coverageStatus, 'unknown_route');
  const empty = await evaluateFacilityAccess({
    demandPoint: origin, categoryId: 'education', facilities: [], searchRadiusMeters: 1000,
    searchComplete: true, provider,
  });
  assert.equal(empty.coverageStatus, 'unknown_route');
  assert.equal(empty.categoryMappingVersion, 'facility-categories-v2');
});

test('invalid route duration cannot become a coverage witness', async () => {
  const result = await evaluateFacilityAccess({
    demandPoint: origin, categoryId: 'commerce', facilities: [facility('m', 100)],
    searchComplete: true, searchRadiusMeters: 1000,
    provider: { route: async () => ({ routeStatus: 'ok', durationSeconds: -1, distanceMeters: 0 }) },
  });
  assert.equal(result.coverageStatus, 'unknown_route');
  assert.equal(result.routes[0].routeStatus, 'invalid_route');
  assert.equal(result.shortestWalkingSeconds, null);
});
test('coverage lower and upper bounds keep unknown points in the denominator', () => {
  const summary = summarizeDemandCoverage([
    { coverageStatus: 'covered' }, { coverageStatus: 'over_threshold' },
    { coverageStatus: 'unknown_route' }, { coverageStatus: 'unknown_search' },
    { coverageStatus: 'not_applicable' },
  ]);
  assert.equal(summary.denominator, 4);
  assert.equal(summary.confirmedLowerBound, 0.25);
  assert.equal(summary.potentialUpperBound, 0.75);
  assert.equal(summary.unknownShare, 0.5);
});