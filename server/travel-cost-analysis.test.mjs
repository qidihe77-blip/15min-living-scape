import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessWalkingCost,
  createAnalysisRun,
  generateBoundedRuleGrid,
  PHASE4_CONFIG,
  WalkingCostCache,
} from './travel-cost-analysis.mjs';

const center = { lat: 30.288902, lng: 120.150993 };

test('generates a capped, reproducible BD-09LL rule grid without claiming a community boundary', () => {
  const first = generateBoundedRuleGrid(center);
  const second = generateBoundedRuleGrid(center);
  assert.equal(first.length, 81);
  assert.deepEqual(first, second);
  assert.ok(first.every((point) => point.offsetMeters <= PHASE4_CONFIG.gridRadiusMeters));
  assert.ok(first.every((point) => point.coordinateSystem === 'BD-09LL'));
  assert.throws(() => generateBoundedRuleGrid(center, { maxPoints: 80 }), /exceeding/);
});

test('900 seconds is covered and 901 seconds is over threshold', () => {
  assert.equal(assessWalkingCost({ routeStatus: 'ok', durationSeconds: 900 }).coverageStatus, 'covered');
  assert.equal(assessWalkingCost({ routeStatus: 'ok', durationSeconds: 901 }).coverageStatus, 'over_threshold');
});

test('route failures remain unknown and straight-line fallback is explicitly non-decisional', () => {
  const result = assessWalkingCost({ routeStatus: 'timeout', durationSeconds: 400, straightLineDistanceMeters: 520 });
  assert.equal(result.coverageStatus, 'unknown');
  assert.equal(result.durationSeconds, null);
  assert.equal(result.straightLineFallback.status, 'reference_only');
  assert.match(result.straightLineFallback.label, /不参与15分钟覆盖判定/);

  const run = createAnalysisRun({
    center,
    grid: [],
    categories: ['medical'],
    retrievedAt: '2026-09-24T12:00:00.000Z',
    costRecords: [{ routeStatus: 'timeout', durationSeconds: 400 }],
  });
  assert.equal(run.geometry, null);
  assert.equal(run.travelCosts[0].coverageStatus, 'unknown');
  assert.ok(run.warnings.some((warning) => warning.includes('不插值补造')));
});

test('analysis_run fingerprint permits deterministic replay from recorded inputs', () => {
  const input = {
    center,
    grid: [{ gridId: 'g-001', lat: center.lat, lng: center.lng }],
    categories: ['medical', 'education'],
    retrievedAt: '2026-09-24T12:00:00.000Z',
    costRecords: [
      { gridId: 'g-001', category: 'medical', routeStatus: 'ok', durationSeconds: 900 },
      { gridId: 'g-001', category: 'education', routeStatus: 'ok', durationSeconds: 901 },
    ],
  };
  const first = createAnalysisRun(input);
  const replay = createAnalysisRun(structuredClone(input));
  assert.equal(first.analysisRunId, replay.analysisRunId);
  assert.equal(first.inputFingerprint, replay.inputFingerprint);
  assert.deepEqual(first.travelCosts.map((record) => record.coverageStatus), ['covered', 'over_threshold']);
});

test('cache stores successful route costs only, expires entries, and separates category keys', () => {
  const cache = new WalkingCostCache({ ttlSeconds: 10, maxEntries: 2 });
  const request = { origin: center, destination: { lat: 30.29, lng: 120.151 }, category: 'medical' };
  const value = { routeStatus: 'ok', durationSeconds: 300 };
  cache.set(request, value, 1000);
  assert.deepEqual(cache.get(request, 2000), value);
  assert.equal(cache.get({ ...request, category: 'education' }, 2000), null);
  assert.equal(cache.get(request, 11_001), null);
  cache.set(request, { routeStatus: 'no_route', durationSeconds: null }, 20_000);
  assert.equal(cache.get(request, 20_001), null);
});
