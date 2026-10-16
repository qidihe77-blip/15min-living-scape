import test from 'node:test';
import assert from 'node:assert/strict';
import { createBaiduClient, createBaiduCacheKey, BaiduApiError, BAIDU_SERVICE_IDS } from './baidu-client.mjs';
import { readFileSync } from 'node:fs';
const { serviceFixtures, permissionDeniedResponse, quotaExhaustedResponse } = JSON.parse(
  readFileSync(new URL('../test/fixtures/baidu-responses.json', import.meta.url), 'utf8'),
);

const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status });
const request = { service: 'place', path: '/place/v3/search', params: { query: '测试' } };

test('synthetic service fixtures pass through injectable mock transport without a real AK', async () => {
  assert.deepEqual(serviceFixtures.map((item) => item.service), BAIDU_SERVICE_IDS);
  for (const fixture of serviceFixtures) {
    const seen = [];
    const client = createBaiduClient({
      mode: 'mock', maxRetries: 0,
      fetchImpl: async (url) => {
        seen.push(new URL(url));
        return response(fixture.response);
      },
    });
    const result = await client.requestJson(fixture);
    assert.deepEqual(result.data, fixture.response);
    assert.equal(result.meta.service, fixture.service);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].searchParams.get('ak'), 'mock-ak');
  }
});

test('successful empty result is kept distinct from provider failure', async () => {
  const client = createBaiduClient({
    mode: 'mock', fetchImpl: async () => response({ status: 0, result: [] }),
  });
  const result = await client.requestJson(request);
  assert.deepEqual(result.data.result, []);
  assert.equal(result.meta.cached, false);
});

test('HTTP and API authorization errors do not become empty success', async () => {
  for (const payload of [
    { status: 403, body: { status: 9 } },
    { status: 200, body: permissionDeniedResponse },
  ]) {
    const client = createBaiduClient({
      mode: 'mock', maxRetries: 0,
      fetchImpl: async () => response(payload.body, payload.status),
    });
    await assert.rejects(client.requestJson(request), (error) =>
      error instanceof BaiduApiError && error.code === 'permission_denied');
  }
});

test('API quota errors and HTTP rate limits are classified separately', async () => {
  const quota = createBaiduClient({
    mode: 'mock', maxRetries: 0,
    fetchImpl: async () => response(quotaExhaustedResponse),
  });
  await assert.rejects(quota.requestJson(request), (error) =>
    error.code === 'quota_exhausted' && error.apiStatus === 302);
  const rate = createBaiduClient({
    mode: 'mock', maxRetries: 0,
    fetchImpl: async () => response({}, 429),
  });
  await assert.rejects(rate.requestJson(request), (error) =>
    error.code === 'rate_limited' && error.httpStatus === 429);
});

test('retryable rate limit backs off and then succeeds; permission error is not retried', async () => {
  let calls = 0;
  const waits = [];
  const client = createBaiduClient({
    mode: 'mock', maxRetries: 2, baseDelayMs: 125,
    sleep: async (ms) => waits.push(ms),
    fetchImpl: async () => {
      calls += 1;
      return calls < 3 ? response({}, 429) : response({ status: 0, result: [] });
    },
  });
  const result = await client.requestJson(request);
  assert.equal(result.meta.attempts, 3);
  assert.deepEqual(waits, [125, 250]);
  const denied = createBaiduClient({
    mode: 'mock', maxRetries: 2, sleep: async () => assert.fail('must not retry'),
    fetchImpl: async () => response(permissionDeniedResponse),
  });
  await assert.rejects(denied.requestJson(request), { code: 'permission_denied' });
});

test('timeout is typed and no request URL or AK enters logs', async () => {
  const logs = [];
  const client = createBaiduClient({
    mode: 'mock', maxRetries: 0, logger: (event) => logs.push(event),
    fetchImpl: async () => {
      throw Object.assign(new Error('secret-in-upstream-message'), { name: 'TimeoutError' });
    },
  });
  await assert.rejects(client.requestJson(request), { code: 'timeout' });
  assert.equal(logs[0].code, 'timeout');
  assert.equal(JSON.stringify(logs).includes('secret-in-upstream-message'), false);
  assert.equal(JSON.stringify(logs).includes('ak'), false);
});

test('transport abort signal enforces the configured timeout', async () => {
  const client = createBaiduClient({
    mode: 'mock', timeoutMs: 20, maxRetries: 0,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    }),
  });
  await assert.rejects(client.requestJson(request), { code: 'timeout' });
});
test('cache key excludes AK; TTL avoids duplicate calls and expires', async () => {
  assert.throws(() => createBaiduCacheKey('place', '/place/v3/search', { ak: 'secret' }));
  assert.throws(() => createBaiduCacheKey('place', '/place/v3/search', { AK: 'secret' }));
  let current = 1000;
  let calls = 0;
  const client = createBaiduClient({
    mode: 'mock', now: () => current,
    fetchImpl: async () => {
      calls += 1;
      return response({ status: 0, result: { value: calls } });
    },
  });
  const first = await client.requestJson({ ...request, cacheTtlMs: 100 });
  const second = await client.requestJson({ ...request, cacheTtlMs: 100 });
  assert.equal(first.data.result.value, 1);
  assert.equal(second.meta.cached, true);
  assert.equal(calls, 1);
  current += 101;
  const third = await client.requestJson({ ...request, cacheTtlMs: 100 });
  assert.equal(third.data.result.value, 2);
});

test('mock mode requires an injected transport; live mode requires server AK', () => {
  assert.throws(() => createBaiduClient({ mode: 'mock' }));
  assert.throws(() => createBaiduClient({ mode: 'live' }));
});
