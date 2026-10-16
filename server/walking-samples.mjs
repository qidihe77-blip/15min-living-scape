import { createWalkingProvider, validBd09ll } from './walking-provider.mjs';

const EARTH_METERS_PER_DEGREE = 111_320;
const GRID_SPACING_METERS = 500;
const GRID_RADIUS = 1;

export const isValidBd09ll = validBd09ll;

function makeTargets(center) {
  const metersPerLongitudeDegree = EARTH_METERS_PER_DEGREE * Math.cos(center.lat * Math.PI / 180);
  const targets = [];
  for (let north = -GRID_RADIUS; north <= GRID_RADIUS; north += 1) {
    for (let east = -GRID_RADIUS; east <= GRID_RADIUS; east += 1) {
      if (north === 0 && east === 0) continue;
      targets.push({
        northOffsetMeters: north * GRID_SPACING_METERS,
        eastOffsetMeters: east * GRID_SPACING_METERS,
        lat: center.lat + north * GRID_SPACING_METERS / EARTH_METERS_PER_DEGREE,
        lng: center.lng + east * GRID_SPACING_METERS / metersPerLongitudeDegree,
      });
    }
  }
  return targets;
}

export async function sampleWalkingNetwork(center, serverAk, fetchImpl = fetch) {
  const targets = makeTargets(center);
  const provider = createWalkingProvider({ serverAk, fetchImpl, maxRequests: targets.length });
  const samples = [];
  const failures = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(2, targets.length) }, async () => {
    while (cursor < targets.length) {
      const target = targets[cursor++];
      const route = await provider.route(center, target);
      if (route.routeStatus === 'ok') {
        samples.push({
          target: { lat: target.lat, lng: target.lng },
          destination: route.destination || { lat: target.lat, lng: target.lng },
          offsetMeters: Math.round(Math.hypot(target.northOffsetMeters, target.eastOffsetMeters)),
          walkingTimeSeconds: route.durationSeconds,
          walkingDistanceMeters: route.distanceMeters,
        });
      } else {
        failures.push({
          target: { lat: target.lat, lng: target.lng },
          reason: route.routeStatus === 'no_route' ? 'no_route'
            : route.routeStatus === 'route_service_error' ? 'route_service_error'
              : route.routeStatus === 'timeout' ? 'timeout' : 'upstream_unavailable',
          ...(Number.isInteger(route.apiStatus) ? { providerStatus: route.apiStatus } : {}),
        });
      }
    }
  });
  await Promise.all(workers);
  samples.sort((a, b) => a.offsetMeters - b.offsetMeters || a.target.lat - b.target.lat || a.target.lng - b.target.lng);
  failures.sort((a, b) => a.target.lat - b.target.lat || a.target.lng - b.target.lng);
  return {
    center,
    coordinateSystem: 'BD-09LL',
    method: 'walking_route_grid_samples',
    gridSpacingMeters: GRID_SPACING_METERS,
    sampleCount: samples.length,
    requestedCount: targets.length,
    samples,
    failedCount: failures.length,
    failures,
  };
}