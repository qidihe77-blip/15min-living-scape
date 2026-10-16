import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidBd09ll, sampleWalkingNetwork } from './walking-samples.mjs';

const center = { lat: 30.288902, lng: 120.150993 };

test('accepts valid BD-09LL center and rejects invalid coordinates', () => {
  assert.equal(isValidBd09ll(center), true);
  assert.equal(isValidBd09ll({ lat: 91, lng: 120 }), false);
  assert.equal(isValidBd09ll({ lat: 30, lng: Number.NaN }), false);
});

test('returns eight real route samples with provider walking durations', async () => {
  let requestCount = 0;
  const fetchMock = async (input, options) => {
    requestCount += 1;
    assert.equal(options.signal instanceof AbortSignal, true);
    const url = new URL(input);
    assert.equal(url.pathname, '/direction/v2/walking');
    assert.equal(url.searchParams.get('coord_type'), 'bd09ll');
    assert.equal(url.searchParams.get('ret_coordtype'), 'bd09ll');
    assert.match(url.searchParams.get('origin'), /^30\.288902,120\.150993$/);
    assert.equal(url.searchParams.get('ak'), 'server-secret-test-only');
    return Response.json({
      status: 0,
      result: {
        destination: { destinationPt: { lat: 30.29, lng: 120.16 } },
        routes: [{ duration: 721, distance: 860 }],
      },
    });
  };

  const result = await sampleWalkingNetwork(center, 'server-secret-test-only', fetchMock);
  assert.equal(requestCount, 8);
  assert.equal(result.sampleCount, 8);
  assert.equal(result.failedCount, 0);
  assert.ok(result.samples.every((sample) => sample.walkingTimeSeconds === 721));
  assert.ok(result.samples.every((sample) => sample.walkingDistanceMeters === 860));
  assert.equal(JSON.stringify(result).includes('server-secret-test-only'), false);
});

test('records no-route and timeout failures without fabricating samples', async () => {
  const fetchMock = async (_input, options) => {
    const params = new URL(_input).searchParams;
    if (params.get('destination')?.startsWith('30.284410')) {
      const error = new Error('timeout');
      error.name = 'TimeoutError';
      throw error;
    }
    return Response.json({ status: 0, result: { routes: [] } });
  };
  const result = await sampleWalkingNetwork(center, 'test-ak', fetchMock);
  assert.equal(result.sampleCount, 0);
  assert.equal(result.failedCount, 8);
  assert.ok(result.samples.length === 0);
});
