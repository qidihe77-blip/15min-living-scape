import test from 'node:test';
import assert from 'node:assert/strict';
import { decideReachabilitySource, runWalkingSamplingFallback } from './reachability-policy.mjs';

const center = { lat: 30.288902, lng: 120.150993 };

test('official source requires verified entitlement and budget', () => {
  assert.equal(decideReachabilitySource({ officialEnabled: true, officialEntitlementVerified: true, officialRemainingRequests: 1 }).geometrySource, 'baidu_isochrone');
  assert.equal(decideReachabilitySource({ officialEnabled: true, officialRemainingRequests: 1 }).geometrySource, 'none');
  assert.equal(decideReachabilitySource({ officialEnabled: true, officialEntitlementVerified: true, officialRemainingRequests: 1, officialStatus: 'permission_denied' }).geometrySource, 'none');
  assert.equal(decideReachabilitySource({ officialEnabled: true, officialEntitlementVerified: true, officialRemainingRequests: 1, officialStatus: 'timeout' }).geometrySource, 'none');
});

test('fallback requires prior consent and caps route calls by remaining allowance', async () => {
  let calls = 0;
  const provider = { route: async () => {
    calls++;
    return { routeStatus: 'ok', durationSeconds: 700, distanceMeters: 300 };
  } };
  const denied = decideReachabilitySource({ walkingRouteAvailable: true, walkingRemainingRequests: 10 });
  const noResult = await runWalkingSamplingFallback(denied, { center, provider });
  assert.equal(noResult.geometryStatus, 'unknown');
  assert.equal(calls, 0);
  const allowed = decideReachabilitySource({
    officialStatus: 'rate_limited', allowWalkingSamplingFallback: true,
    walkingRouteAvailable: true, walkingRemainingRequests: 4, samplingBudget: 'low',
  });
  assert.equal(allowed.maxRouteCalls, 4);
  const result = await runWalkingSamplingFallback(allowed, { center, provider, radiusMeters: 300, spacingMeters: 300 });
  assert.equal(calls, 4);
  assert.equal(result.geometryStatus, 'sampled_approximation');
});

test('no fallback for cycling or no walking allowance', () => {
  const args = { mode: 'cycling', allowWalkingSamplingFallback: true, walkingRouteAvailable: true, walkingRemainingRequests: 20 };
  assert.equal(decideReachabilitySource(args).geometrySource, 'none');
  assert.equal(decideReachabilitySource({ ...args, mode: 'walking', walkingRemainingRequests: 0 }).geometrySource, 'none');
  assert.throws(() => decideReachabilitySource({ walkingRemainingRequests: -1 }), RangeError);
});
