import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalkingProvider } from './walking-provider.mjs';
import { buildIsochrone } from './isochrone.mjs';
import { createAnalysisManager } from './analysis-job.mjs';
import { WalkingCostCache } from './travel-cost-analysis.mjs';

const center = { lat: 30.288902, lng: 120.150993 };
const target = { lat: 30.29, lng: 120.151 };
function response(duration) {
  return Response.json({ status: 0, result: { routes: [{ duration, distance: 1000 }] } });
}

test('walking provider preserves BD-09 order, cache and capped budget without exposing AK', async () => {
  let calls = 0;
  const provider = createWalkingProvider({
    serverAk: 'test-secret', cache: new WalkingCostCache(), maxRequests: 1,
    fetchImpl: async (input, options) => {
      calls++;
      assert.ok(options.signal instanceof AbortSignal);
      const url = new URL(input);
      assert.equal(url.searchParams.get('origin'), '30.288902,120.150993');
      assert.equal(url.searchParams.get('destination'), '30.290000,120.151000');
      assert.equal(url.searchParams.get('coord_type'), 'bd09ll');
      return response(900);
    },
  });
  assert.equal((await provider.route(center, target)).durationSeconds, 900);
  assert.equal((await provider.route(center, target)).cached, true);
  assert.equal((await provider.route(center, { lat: 30.291, lng: 120.152 })).routeStatus, 'route_request_limit_reached');
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(provider.stats()).includes('test-secret'), false);
});

test('isochrone refines mixed 900/901 boundary but does not interpolate it as confirmed coverage', async () => {
  let calls = 0;
  const provider = { route: async (_origin, destination) => {
    calls++;
    return { routeStatus: 'ok', durationSeconds: destination.lng > center.lng ? 901 : 900, distanceMeters: 1000 };
  } };
  const result = await buildIsochrone({ center, provider, radiusMeters: 300, spacingMeters: 300, maxRefinementPoints: 2 });
  assert.equal(result.geometrySource, 'walking_sampling_fallback');
  assert.ok(result.geojson.features.every((feature) => feature.properties.geometrySource === 'walking_sampling_fallback'));
  assert.equal(result.counts.coarse, 5);
  assert.ok(result.counts.overThreshold >= 1);
  assert.ok(result.counts.covered >= 4);
  assert.ok(result.counts.uncertainEdges > 0);
  assert.ok(result.geojson.features.some((f) => f.properties.featureType === 'uncertain_boundary' && f.properties.coverageStatus === 'unknown'));
  assert.ok(result.geojson.features.filter((f) => f.properties.featureType.endsWith('sample_cell')).every((f) => f.properties.geometryConfidence === 'visual_proxy_at_sample_only'));
  assert.ok(calls <= 6);
});

test('route failures and exhausted budget remain unknown in GeoJSON', async () => {
  const provider = { route: async () => ({ routeStatus: 'route_request_limit_reached', durationSeconds: null }) };
  const result = await buildIsochrone({ center, provider, radiusMeters: 300, spacingMeters: 300, maxRefinementPoints: 0 });
  assert.equal(result.counts.unknown, 4);
  assert.equal(result.geojson.features[0].properties.featureType, 'unsampled_study_disk');
  assert.equal(result.counts.overThreshold, 0);
  assert.equal(result.geometryStatus, 'unknown');
  assert.equal(result.geojson.features.length, 1);
  assert.ok(result.samples.some((sample) => sample.routeStatus === 'route_request_limit_reached' && sample.coverageStatus === 'unknown'));
});

test('analysis manager exposes progress and sample metrics without claiming facility coverage', async () => {
  const manager = createAnalysisManager({
    serverAk: 'test-secret', jobRequestLimit: 2, processRequestLimit: 2,
    fetchImpl: async () => response(901),
  });
  assert.throws(() => manager.create({ center }), /confirmation/i);
  const job = manager.create({ center, confirmRealWalkingSampling: true });
  for (let attempt = 0; attempt < 100 && ['queued', 'running'].includes(manager.get(job.analysisId).status); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  const final = manager.get(job.analysisId);
  assert.equal(final.status, 'partial');
  assert.equal(final.geometrySource, 'walking_sampling_fallback');
  assert.equal(manager.metrics(job.analysisId).geometrySource, 'walking_sampling_fallback');
  assert.equal(final.requestStats.jobNetworkRequests, 2);
  assert.equal(final.counts.unknown, 78);
  assert.equal(manager.geojson(job.analysisId).type, 'FeatureCollection');
  assert.equal(manager.metrics(job.analysisId).scope, 'center_point_isochrone_only');
  assert.equal(JSON.stringify(final).includes('test-secret'), false);
});
test('directional sampling covers different sectors before spending the budget on distant points', async () => {
  let calls = 0;
  const provider = { route: async () => {
    calls++;
    return { routeStatus: 'ok', durationSeconds: 700, distanceMeters: 300 };
  } };
  const result = await buildIsochrone({ center, provider, maxRouteCalls: 8, maxRefinementPoints: 0 });
  const routed = result.samples.filter((sample) => sample.decisionSource === 'baidu_walking_duration');
  assert.equal(calls, 8);
  assert.equal(new Set(routed.map((sample) => sample.sector)).size, 8);
  assert.equal(result.counts.unsampled, 72);
  assert.equal(result.sampleMetrics.attemptedRouteCalls, 8);
  assert.equal(result.sampleMetrics.errorBoundStatus, 'not_statistically_estimated');
});

test('429 and anomalous detour retain unknown status and do not create continuous polygon', async () => {
  let calls = 0;
  const rateLimited = await buildIsochrone({
    center, maxRouteCalls: 24,
    provider: { route: async () => {
      calls++;
      return { routeStatus: 'route_request_limit_reached', durationSeconds: null };
    } },
  });
  assert.ok(calls <= 2);
  assert.equal(rateLimited.geometryStatus, 'unknown');
  assert.equal(rateLimited.geojson.features.length, 1);
  assert.equal(rateLimited.sampleMetrics.stoppedReason, 'route_request_limit_reached');

  const detour = await buildIsochrone({
    center, radiusMeters: 300, spacingMeters: 300, maxRefinementPoints: 0,
    provider: { route: async (_origin, destination) => ({
      routeStatus: 'ok', durationSeconds: 700,
      distanceMeters: destination.lat > center.lat ? 1600 : 300,
    }) },
  });
  assert.ok(detour.samples.some((sample) => sample.routeStatus === 'route_anomalous_detour' && sample.coverageStatus === 'unknown'));
  assert.equal(detour.geometryStatus, 'unknown');
  assert.equal(detour.geojson.features.length, 1);
});