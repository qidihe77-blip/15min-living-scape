import { SAMPLING_BUDGET_PROFILES } from './isochrone.mjs';

export function decideReachabilitySource({
  mode = 'walking',
  officialEnabled = false,
  officialEntitlementVerified = false,
  officialStatus = 'not_requested',
  officialRemainingRequests = 0,
  allowWalkingSamplingFallback = false,
  walkingRouteAvailable = false,
  walkingRemainingRequests = 0,
  samplingBudget = 'high',
  serviceHalted = false,
} = {}) {
  if (!['walking', 'cycling', 'driving'].includes(mode)) throw new RangeError('Unsupported travel mode.');
  if (!Object.hasOwn(SAMPLING_BUDGET_PROFILES, samplingBudget)) throw new RangeError('Unknown sampling budget.');
  if (!Number.isInteger(officialRemainingRequests) || officialRemainingRequests < 0
    || !Number.isInteger(walkingRemainingRequests) || walkingRemainingRequests < 0) {
    throw new RangeError('Remaining request counts must be nonnegative integers.');
  }
  if (serviceHalted) return { geometrySource: 'none', geometryStatus: 'unknown', reason: 'service_halted', maxRouteCalls: 0 };
  if (officialEnabled && officialEntitlementVerified && officialRemainingRequests > 0
    && ['not_requested', 'ok', 'available'].includes(officialStatus)) {
    return { geometrySource: 'baidu_isochrone', geometryStatus: 'pending', reason: 'official_available', maxRouteCalls: 0 };
  }
  if (mode === 'walking' && allowWalkingSamplingFallback === true
    && walkingRouteAvailable && walkingRemainingRequests > 0) {
    return {
      geometrySource: 'walking_sampling_fallback', geometryStatus: 'pending',
      reason: 'confirmed_sampling_fallback',
      maxRouteCalls: Math.min(SAMPLING_BUDGET_PROFILES[samplingBudget], walkingRemainingRequests),
    };
  }
  const reason = mode !== 'walking' ? 'nonwalking_fallback_unavailable'
    : !allowWalkingSamplingFallback ? 'sampling_not_confirmed'
      : !walkingRouteAvailable ? 'walking_route_unavailable' : 'walking_budget_exhausted';
  return { geometrySource: 'none', geometryStatus: 'unknown', reason, maxRouteCalls: 0 };
}

export async function runWalkingSamplingFallback(decision, input) {
  if (decision?.geometrySource !== 'walking_sampling_fallback' || decision.maxRouteCalls <= 0) {
    return { geometrySource: 'none', geometryStatus: 'unknown', reason: decision?.reason ?? 'no_sampling_decision' };
  }
  const { buildIsochrone } = await import('./isochrone.mjs');
  return buildIsochrone({ ...input, maxRouteCalls: decision.maxRouteCalls });
}
