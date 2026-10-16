import test from 'node:test';
import assert from 'node:assert/strict';
import { createLegacyFacilityJobManager as createFacilityJobManager,
  createFacilityJobManager as createV3Manager, validateFacilityV3Input } from './facility-job.mjs';
import { FACILITY_GROUP_IDS } from './facility-categories.mjs';
import { renderFacilityReportHtml } from './report.mjs';
import { createContextLayerManager } from './context-layers.mjs';

const point = { lat: 30.288902, lng: 120.150993 };
const request = (overrides = {}) => ({
  version: 2,
  origin: { id: 'origin-1', source: 'baidu_poi', name: '测试社区', location: point },
  categoryIds: ['medical', 'education'], priorities: { medical: 1, education: 1 },
  mode: 'walking', minutes: 15, confirmRealWalkingSampling: false,
  ...overrides,
});

async function done(manager, id) {
  for (let i = 0; i < 100; i += 1) {
    const job = manager.get(id);
    if (['complete', 'partial', 'failed', 'cancelled'].includes(job?.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('Test job did not finish.');
}

function mocks() {
  let places = 0;
  let routes = 0;
  const placeProvider = { searchAround: async ({ categoryId }) => {
    places += 1;
    return { status: 'complete', searchComplete: true, truncated: false,
      candidates: [{ uid: categoryId, name: categoryId,
        location: { lat: point.lat + 0.001, lng: point.lng } }],
      pages: [{ pageNum: 0, total: 1 }], errors: [],
      requestStats: { logicalRequests: 1 } };
  } };
  const routeProvider = { route: async (_from, _to, options) => {
    routes += 1;
    return { routeStatus: 'ok', durationSeconds: options.destinationUid === 'medical' ? 900 : 901,
      distanceMeters: 600, source: 'direction_lite' };
  } };
  return { placeProvider, routeProvider, counts: () => ({ places, routes }) };
}

test('version 2 task returns route-backed score and rescores the same evidence without upstream calls', async () => {
  const providers = mocks();
  const manager = createFacilityJobManager(providers);
  const created = manager.create(request());
  assert.match(created.analysisId, /^fa-/);
  assert.equal(created.status, 'queued');
  const job = await done(manager, created.analysisId);
  assert.equal(job.status, 'complete');
  assert.equal(job.geometrySource, 'none');
  assert.equal(job.score.S_low, 50);
  assert.equal(job.score.S_high, 50);
  assert.equal(job.analysis.categories[0].coverageStatus, 'covered');
  assert.equal(job.analysis.categories[1].coverageStatus, 'over_threshold');
  assert.equal(job.analysis.categories[0].poiMarkers.length, 1);
  assert.deepEqual(providers.counts(), { places: 2, routes: 2 });
  const changed = manager.rescore(created.analysisId, {
    evidenceFingerprint: job.score.evidenceFingerprint,
    selectedCategoryIds: ['medical', 'education'],
    priorities: { medical: 4, education: 1 },
  });
  assert.equal(changed.S_low, 80);
  assert.equal(changed.evidenceFingerprint, job.score.evidenceFingerprint);
  assert.deepEqual(providers.counts(), { places: 2, routes: 2 });
  assert.throws(() => manager.rescore(created.analysisId, {
    evidenceFingerprint: 'old', priorities: { medical: 1 },
  }), /snapshot has changed/);
  assert.throws(() => manager.rescore(created.analysisId, {
    evidenceFingerprint: changed.evidenceFingerprint,
    selectedCategoryIds: ['parks'], priorities: { parks: 1 },
  }), /already present/);
  assert.equal(manager.metrics(created.analysisId).score.S_low, 80);
  assert.equal(manager.geojson(created.analysisId).properties.geometryStatus, 'unknown');
});

test('report uses the same analysis and score and escapes untrusted origin names', async () => {
  const providers = mocks();
  const manager = createFacilityJobManager(providers);
  const id = manager.create(request({ origin: { id: 'origin-1', source: 'map_click',
    name: '<script>alert(1)</script>', location: point } })).analysisId;
  await done(manager, id);
  const report = manager.report(id);
  assert.equal(report.analysisId, id);
  assert.equal(report.score.S_low, manager.get(id).score.S_low);
  assert.equal(report.categories[0].evidenceIds.length, 1);
  assert.equal(report.scope, 'origin_point_only');
  const html = renderFacilityReportHtml(report);
  assert.match(html, /&lt;script&gt;alert/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /证据指纹/);
  assert.match(html, /地点检索逻辑请求/);
  assert.match(html, /归一化/);
});

test('driving traffic context reaches JSON and print report without changing route-backed score', async () => {
  let trafficCalls = 0;
  const contextManager = createContextLayerManager({ trafficEnabled: true, trafficRequestLimit: 1,
    trafficProvider: { around: async () => {
      trafficCalls += 1;
      return { status: 'available', evaluationLabel: '缓行', retrievedAt: '2026-09-30T00:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z', geojson: { type: 'FeatureCollection', features: [] } };
    } } });
  const providers = mocks();
  const manager = createFacilityJobManager({ ...providers, contextManager });
  const id = manager.create(request({ mode: 'driving' })).analysisId;
  const job = await done(manager, id);
  assert.equal(job.status, 'complete');
  assert.equal(job.score.S_low, 50);
  assert.equal(job.context.traffic.evaluationLabel, '缓行');
  assert.equal(manager.metrics(id).context.traffic.status, 'available');
  assert.equal(manager.report(id).traffic.status, 'available');
  assert.match(renderFacilityReportHtml(manager.report(id)), /驾车路况/);
  const fingerprint = job.score.evidenceFingerprint;
  manager.rescore(id, { evidenceFingerprint: fingerprint,
    selectedCategoryIds: ['medical', 'education'], priorities: { medical: 4, education: 1 } });
  assert.equal(trafficCalls, 1);
  assert.equal(manager.get(id).score.S_low, 80);
});

test('official is gated by verified entitlement and a failed official call can use confirmed sampling', async () => {
  const providers = mocks();
  let officialCalls = 0;
  let samplingCalls = 0;
  const officialProvider = { getIsochrone: async () => { officialCalls += 1; throw new Error('not available'); } };
  const samplingRunner = async ({ budget, maxRouteCalls }) => {
    samplingCalls += 1;
    assert.equal(maxRouteCalls, 24);
    budget.networkRequests += 2;
    return { geometrySource: 'walking_sampling_fallback', geometryStatus: 'sampled_approximation',
      sampleMetrics: { attemptedRouteCalls: 2, unknownShare: 0.5 },
      geojson: { type: 'FeatureCollection', features: [] } };
  };
  const unverified = createFacilityJobManager({ ...providers, officialProvider,
    officialEnabled: true, officialEntitlementVerified: false, officialRequestLimit: 2,
    walkingSamplingEnabled: true, samplingRunner });
  const noConsentId = unverified.create(request()).analysisId;
  const noConsent = await done(unverified, noConsentId);
  assert.equal(noConsent.geometrySource, 'none');
  assert.equal(officialCalls, 0);
  assert.equal(samplingCalls, 0);
  const verified = createFacilityJobManager({ ...providers, officialProvider,
    officialEnabled: true, officialEntitlementVerified: true, officialRequestLimit: 1,
    walkingSamplingEnabled: true, samplingRunner });
  const id = verified.create(request({ confirmRealWalkingSampling: true })).analysisId;
  const job = await done(verified, id);
  assert.equal(officialCalls, 1);
  assert.equal(samplingCalls, 1);
  assert.equal(job.geometrySource, 'walking_sampling_fallback');
  assert.equal(job.requestStats.officialRequests, 1);
  assert.equal(job.requestStats.samplingRequests, 2);
  assert.equal(verified.geojson(id).type, 'FeatureCollection');
});

test('request budgets and partial search keep missing evidence unknown', async () => {
  const providers = mocks();
  const manager = createFacilityJobManager({ ...providers,
    placeRequestLimit: 1, routeDecisionLimit: 1 });
  const id = manager.create(request()).analysisId;
  const job = await done(manager, id);
  assert.equal(job.status, 'partial');
  assert.equal(job.analysis.categories[0].coverageStatus, 'covered');
  assert.equal(job.analysis.categories[1].coverageStatus, 'unknown_search');
  assert.equal(job.score.S_low, 50);
  assert.equal(job.score.S_high, 100);
  assert.deepEqual(providers.counts(), { places: 1, routes: 1 });
});

test('queued task can be cancelled without sending Place or route requests', async () => {
  const providers = mocks();
  const manager = createFacilityJobManager(providers);
  const id = manager.create(request()).analysisId;
  assert.equal(manager.cancel(id).status, 'cancelled');
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(manager.get(id).status, 'cancelled');
  assert.deepEqual(providers.counts(), { places: 0, routes: 0 });
});

test('rejects invalid categories, all zero weights and absent sampling consent type', () => {
  const manager = createFacilityJobManager(mocks());
  assert.throws(() => manager.create(request({ categoryIds: ['medical', 'medical'] })), /Invalid version 2/);
  assert.throws(() => manager.create(request({ priorities: { medical: 0, education: 0 } })), /positive priority/);
  assert.throws(() => manager.create(request({ confirmRealWalkingSampling: 'true' })), /boolean/);
  assert.throws(() => manager.create(request({ mode: 'flying' })), /Invalid version 2/);
});

test('quota exhaustion halts later facility route requests and keeps them unknown', async () => {
  const providers = mocks();
  let routeCalls = 0;
  providers.routeProvider.route = async () => {
    routeCalls += 1;
    return { routeStatus: 'quota_exhausted', durationSeconds: null };
  };
  const manager = createFacilityJobManager(providers);
  const job = await done(manager, manager.create(request()).analysisId);
  assert.equal(routeCalls, 1);
  assert.equal(job.status, 'partial');
  assert.equal(job.score.S_low, 0);
  assert.equal(job.score.S_high, 100);
  assert.equal(job.requestStats.routeDecisions, 1);
});
test('20-minute walking analysis never labels a 15-minute sampling grid as its range', async () => {
  const providers = mocks();
  let samplingCalls = 0;
  const manager = createFacilityJobManager({ ...providers, walkingSamplingEnabled: true,
    samplingRunner: async () => { samplingCalls += 1; throw new Error('should not run'); } });
  const job = await done(manager, manager.create(request({
    minutes: 20, confirmRealWalkingSampling: true,
  })).analysisId);
  assert.equal(samplingCalls, 0);
  assert.equal(job.geometrySource, 'none');
  assert.equal(job.geometryStatus, 'unknown');
  assert.equal(job.analysis.thresholdSeconds, 1200);
});
test('running task cancellation aborts its active search before any route request', async () => {
  let searchSignal;
  let routeCalls = 0;
  const manager = createFacilityJobManager({
    placeProvider: { searchAround: ({ signal }) => {
      searchSignal = signal;
      return new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve({
          status: 'failed', searchComplete: false, truncated: true,
          candidates: [], pages: [], errors: [{ code: 'cancelled' }],
          requestStats: { logicalRequests: 1 },
        }), { once: true });
      });
    } },
    routeProvider: { route: async () => { routeCalls += 1; return { routeStatus: 'ok', durationSeconds: 500 }; } },
  });
  const id = manager.create(request()).analysisId;
  for (let i = 0; i < 50 && manager.get(id).status !== 'running'; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(manager.get(id).status, 'running');
  assert.equal(manager.cancel(id).cancelRequested, true);
  const job = await done(manager, id);
  assert.equal(job.status, 'cancelled');
  assert.equal(searchSignal.aborted, true);
  assert.equal(routeCalls, 0);
  assert.equal(manager.report(id), null);
  assert.equal(manager.geojson(id), null);
});
test('empty official geometry falls back only when sampling was confirmed', async () => {
  const providers = mocks();
  let samplingCalls = 0;
  const options = { ...providers,
    officialProvider: { getIsochrone: async () => null },
    officialEnabled: true, officialEntitlementVerified: true, officialRequestLimit: 2,
    walkingSamplingEnabled: true,
    samplingRunner: async ({ budget }) => {
      samplingCalls += 1;
      budget.networkRequests += 1;
      return { geometrySource: 'walking_sampling_fallback', geometryStatus: 'unknown',
        sampleMetrics: { attemptedRouteCalls: 1, unknownShare: 1 },
        geojson: { type: 'FeatureCollection', features: [] } };
    },
  };
  const manager = createFacilityJobManager(options);
  const unconfirmed = await done(manager, manager.create(request()).analysisId);
  assert.equal(unconfirmed.geometrySource, 'none');
  assert.equal(samplingCalls, 0);
  const confirmed = await done(manager, manager.create(request({
    confirmRealWalkingSampling: true,
  })).analysisId);
  assert.equal(confirmed.geometrySource, 'walking_sampling_fallback');
  assert.equal(samplingCalls, 1);
  assert.equal(confirmed.requestStats.officialRequests, 1);
});

const v3Request = (overrides = {}) => ({ ...request(), version: 3,
  categoryMappingVersion: 'facility-categories-v3', categoryIds: [...FACILITY_GROUP_IDS],
  priorities: Object.fromEntries(FACILITY_GROUP_IDS.map((id) => [id, 1])), ...overrides });

test('v3 input accepts all-zero priorities and normalizes the six groups while rejecting v2 and view filters', () => {
  const body = v3Request({ categoryIds: [...FACILITY_GROUP_IDS].reverse(),
    priorities: Object.fromEntries(FACILITY_GROUP_IDS.map((id) => [id, 0])) });
  const input = validateFacilityV3Input(body);
  assert.deepEqual(input.categoryIds, FACILITY_GROUP_IDS);
  assert.equal(input.subtypeScope, 'all');
  for (const invalid of [request(), v3Request({ mode: 'driving' }), v3Request({ minutes: 20 }),
    v3Request({ categoryIds: ['medical'] }), v3Request({ activeCategoryId: 'medical' }),
    v3Request({ categoryMappingVersion: 'facility-categories-v2' }), v3Request({ priorities: { medical: 7 } })]) {
    assert.throws(() => validateFacilityV3Input(invalid));
  }
  assert.equal(validateFacilityV3Input(v3Request({ priorities: { medical: 6 } })).priorities.medical,6);
});

test('v3 job retains 25 slots and permits zero-weight analysis without applying the legacy scoring formula', async () => {
  let places = 0, routes = 0;
  const manager = createV3Manager({
    placeProvider: { searchAround: async ({ subtypeId }) => {
      places++;
      return { status: 'complete', searchComplete: true, candidates: subtypeId === 'pharmacy'
        ? [{ uid: 'pharmacy', name: '民生药店', location: point }] : [],
      requestStats: { logicalRequests: 1 } };
    } },
    routeProvider: { route: async () => { routes++; return { routeStatus: 'ok', durationSeconds: 900,
      distanceMeters: 100, source: 'fixture' }; } },
  });
  const id = manager.create(v3Request({ priorities: Object.fromEntries(FACILITY_GROUP_IDS.map((key) => [key, 0])) })).analysisId;
  const job = await done(manager, id);
  assert.equal(job.version, 3);
  assert.equal(job.status, 'complete');
  assert.equal(job.analysis.categories.flatMap((group) => group.subtypeResults).length, 25);
  assert.equal(job.score.scoreStatus, 'not_requested');
  assert.equal(job.score.S_low, null);
  assert.equal(places, 25);
  assert.equal(routes, 1);
  const fingerprint = job.score.evidenceFingerprint;
  const changed = manager.rescore(id, { evidenceFingerprint: fingerprint, priorities: { medical: 5 } });
  assert.equal(changed.scoreStatus, 'scored');
  assert.equal(changed.evidenceFingerprint, fingerprint);
  assert.equal(places, 25);
  assert.equal(routes, 1);
  assert.throws(() => manager.rescore(id, { evidenceFingerprint: fingerprint,
    selectedCategoryIds: ['medical'], priorities: { medical: 1 } }), /denominator/);
  const report = manager.report(id);
  assert.equal(report.reportStatus, 'available');
  assert.equal(report.reportVersion, 'facility-report-v3');
  assert.equal(report.categories.flatMap((group) => group.subtypeResults).length, 25);
  job.analysis.categories[0].label = 'changed public copy';
  assert.equal(manager.get(id).analysis.categories[0].label, '教育');
});

test('v3 zero budgets and missing premium permissions leave every subtype unknown with zero provider calls', async () => {
  let calls = 0;
  const manager = createV3Manager({ placeRequestLimit: 0, routeDecisionLimit: 0,
    placeProvider: { searchAround: async () => { calls++; throw new Error('no call'); } },
    routeProvider: { route: async () => { calls++; throw new Error('no call'); } },
    officialProvider: { getIsochrone: async () => { calls++; throw new Error('no call'); } },
    officialEnabled: true, officialEntitlementVerified: false, officialRequestLimit: 1,
  });
  const job = await done(manager, manager.create(v3Request()).analysisId);
  assert.equal(job.status, 'partial');
  assert.ok(job.analysis.categories.flatMap((group) => group.subtypeResults).every((row) => row.accessStatus === 'unknown'));
  assert.equal(job.requestStats.placeRequests, 0);
  assert.equal(job.requestStats.routeDecisions, 0);
  assert.equal(job.requestStats.officialRequests, 0);
  assert.equal(calls, 0);
});

test('v3 cancellation discards running search results before route evaluation', async () => {
  let entered = false, routeCalls = 0;
  const manager = createV3Manager({ placeProvider: { searchAround: ({ signal }) => {
    entered = true;
    return new Promise((resolve) => signal.addEventListener('abort', () => resolve({
      status: 'failed', searchComplete: false, candidates: [], errors: [{ code: 'cancelled' }],
      requestStats: { logicalRequests: 1 },
    }), { once: true }));
  } }, routeProvider: { route: async () => { routeCalls++; return {}; } } });
  const id = manager.create(v3Request()).analysisId;
  for (let i = 0; i < 50 && !entered; i++) await new Promise((resolve) => setTimeout(resolve, 2));
  manager.cancel(id);
  assert.equal((await done(manager, id)).status, 'cancelled');
  assert.equal(routeCalls, 0);
  assert.equal(manager.report(id), null);
});
