import test from 'node:test';
import assert from 'node:assert/strict';
import { createValidationTransport, safeResponse, selectHoldoutPoints, proxySupportAt,
  evaluateHoldout, runWenjinValidation, renderValidationMarkdown } from './real-world-validation.mjs';
import { FACILITY_CATEGORIES, classifyFacilityCandidate } from './facility-categories.mjs';
import { buildIsochrone } from './isochrone.mjs';

const center = { lat: 30.288902, lng: 120.150993 };
const url = 'https://api.map.baidu.com/place/v3/around?ak=test-key&query=医院&location=30.288902,120.150993';
const response = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json' },
});

test('validation transport serializes requests, spaces starts and enforces its hard cap', async () => {
  let time = 0, active = 0, peak = 0;
  const starts = [], records = [];
  const gate = createValidationTransport({ limits: { place: 2 }, minIntervalMs: 1100,
    now: () => time, wait: async (ms) => { time += ms; }, onEvidence: async (record) => records.push(record),
    fetchImpl: async () => { active++; peak = Math.max(peak, active); starts.push(time);
      await Promise.resolve(); active--; return response({ status: 0, total: 0, results: [] }); } });
  const results = await Promise.allSettled([gate.fetch(url), gate.fetch(url), gate.fetch(url)]);
  assert.equal(peak, 1);
  assert.deepEqual(starts, [0, 1100]);
  assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'fulfilled', 'rejected']);
  assert.equal(gate.stats().totalRequests, 2);
  assert.equal(records.length, 2);
  assert.equal(JSON.stringify(records).includes('test-key'), false);
  assert.equal(records[0].params.ak, undefined);
});

test('permission or rate failures halt all later services, including queued requests', async () => {
  for (const [apiStatus, httpStatus, expected] of [[201, 200, 'permission_denied'], [210, 200, 'permission_denied'],
    [0, 429, 'rate_limited'], [302, 200, 'quota_exhausted']]) {
    let calls = 0;
    const gate = createValidationTransport({ minIntervalMs: 0,
      fetchImpl: async () => { calls++; return response({ status: apiStatus }, httpStatus); } });
    await Promise.allSettled([gate.fetch(url), gate.fetch('https://api.map.baidu.com/direction/v2/walking?ak=test-key')]);
    assert.equal(calls, 1);
    assert.equal(gate.stats().stoppedReason, expected);
  }
});

test('evidence whitelist omits messages, keys, contacts and external URLs, keeps top-level classification', () => {
  const record = safeResponse({ status: 0, ak: 'secret', message: 'secret', results: [{
    name: '公共图书馆', uid: 'library-1', location: center, address: '文二路', classified_poi_tag: '文化传媒;图书馆',
    telephone: '123456', detail_info: { detail_url: 'https://example.invalid/?ak=secret' },
  }] });
  const text = JSON.stringify(record);
  for (const forbidden of ['secret', '123456', 'example.invalid']) assert.equal(text.includes(forbidden), false);
  assert.equal(record.results[0].rawCategory, '文化传媒;图书馆');
});

async function sampling() {
  return buildIsochrone({ center, maxRouteCalls: 24, provider: { route: async (_from, point) => ({
    routeStatus: 'ok', durationSeconds: Math.round(point.offsetMeters * 1.5), distanceMeters: point.offsetMeters * 1.4,
  }) } });
}

test('independent holdouts differ from every sampling coordinate and retain unsupported points as unknown', async () => {
  const result = await sampling();
  const holds = selectHoldoutPoints(result);
  const key = (p) => p.lat.toFixed(6) + ',' + p.lng.toFixed(6);
  const sampled = new Set(result.samples.map(key));
  assert.equal(holds.length, 12);
  assert.equal(new Set(holds.map(key)).size, 12);
  assert.equal(holds.some((p) => sampled.has(key(p))), false);
  assert.equal(holds.filter((p) => p.group === 'sample_cell_neighborhood').length, 8);
  assert.equal(proxySupportAt(result, { lat: 31, lng: 121 }).status, 'unknown');
  assert.equal(evaluateHoldout(result, holds[0], { routeStatus: 'no_route' }).observedStatus, 'unknown');
});

test('independent route truth uses an inclusive 900-second threshold and never invents an unknown prediction', async () => {
  const result = await sampling();
  const point = { id: 'far', lat: 31, lng: 121 };
  const low = evaluateHoldout(result, point, { routeStatus: 'ok', durationSeconds: 900 });
  const high = evaluateHoldout(result, point, { routeStatus: 'ok', durationSeconds: 901 });
  assert.equal(low.observedStatus, 'covered');
  assert.equal(high.observedStatus, 'over_threshold');
  assert.equal(low.comparable, false);
  assert.equal(low.agrees, null);
});

test('C16 pipeline records all three POI routes per class and rescores without additional route calls', async () => {
  let facilityCalls = 0, samplingCalls = 0;
  const run = await runWenjinValidation({ reference: { standardName: '西溪街道文锦社区', center }, sampleCalls: 24,
    client: { requestJson: async () => ({ data: { status: 0, results: [{ uid: 'wenjin', name: '西溪街道文锦社区', location: center }] },
      meta: { retrievedAt: '2026-10-02T00:00:00Z' } }) },
    placeProvider: { searchAround: async ({ categoryId, radiusMeters }) => ({
      candidates: [1, 2, 3].map((i) => ({ uid: categoryId + '-' + i, name: categoryId + i,
        location: { lat: center.lat + i * .001, lng: center.lng }, categoryId, rawCategory: '样例分类',
        classification: classifyFacilityCandidate({ categoryId, name: categoryId + i }) })),
      candidatesFound: 3, radiusMeters, status: 'partial', searchComplete: false, truncated: true, pages: [], errors: [],
    }) },
    routeProvider: { route: async () => { facilityCalls++; return { routeStatus: 'ok', durationSeconds: 600, distanceMeters: 700 }; } },
    samplingProvider: { route: async (_from, point) => { samplingCalls++;
      return { routeStatus: 'ok', durationSeconds: Math.round((point.offsetMeters ?? 600) * 1.5), distanceMeters: 700 }; } },
    stats: () => ({ counts: {}, limits: {}, stoppedReason: null }),
  });
  assert.equal(run.status, 'complete');
  assert.equal(run.categories.length, FACILITY_CATEGORIES.length);
  assert.equal(run.facilityRoutes.length, 24);
  assert.equal(facilityCalls, 24);
  assert.equal(samplingCalls, run.sampling.sampleMetrics.attemptedRouteCalls + 12);
  assert.equal(run.holdouts.length, 12);
  assert.equal(run.score.S_low, 100);
  assert.equal(run.optionalServices.isochrone.status, 'permission_unverified');
  assert.match(renderValidationMarkdown(run), /不能称全社区算法准确率/);
});

test('C16 permission failure produces partial evidence with all eight classes unknown and no route calls', async () => {
  let calls = 0;
  const run = await runWenjinValidation({ reference: { standardName: '西溪街道文锦社区', center },
    client: { requestJson: async () => { throw { code: 'permission_denied', apiStatus: 201 }; } },
    placeProvider: { searchAround: async () => { calls++; } },
    routeProvider: { route: async () => { calls++; } }, samplingProvider: { route: async () => { calls++; } },
    stats: () => ({ stoppedReason: 'permission_denied', counts: { place: 1 }, limits: { place: 48 } }),
  });
  assert.equal(calls, 0);
  assert.equal(run.status, 'partial');
  assert.equal(run.acceptance.atLeastThreePoisEach, false);
  assert.equal(run.holdoutMetrics.valid, 0);
  assert.deepEqual([run.score.S_low, run.score.S_high], [0, 100]);
});
