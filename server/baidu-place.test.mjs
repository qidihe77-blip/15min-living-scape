import test from 'node:test';
import assert from 'node:assert/strict';
import { BaiduApiError } from './baidu-client.mjs';
import { createBaiduPlaceProvider } from './baidu-place.mjs';

const center = { lat: 30.288902, lng: 120.150993 };
const poi = (uid, name = '测试地点') => ({
  uid, name, location: center, address: '测试地址',
  detail_info: { tag: '医疗;药店', navi_location: { lat: center.lat + 0.001, lng: center.lng } },
});
function providerFrom(responder) {
  const calls = [];
  const client = { requestJson: async (request) => {
    calls.push(request);
    assert.equal(request.service, 'place');
    assert.equal(request.path, '/place/v3/around');
    return { data: await responder(request.params), meta: { retrievedAt: '2026-09-29T00:00:00Z' } };
  } };
  return { provider: createBaiduPlaceProvider({ client }), calls };
}

test('Place preserves a top-level classified_poi_tag when detail_info classification is absent', async () => {
  const { provider } = providerFrom(() => ({ status: 0, total: 1, result_type: 'poi_type',
    results: [{ uid: 'library', name: '图书馆', location: center,
      classified_poi_tag: '文化传媒;图书馆', detail_info: { tag: '旧标签' } }] }));
  const result = await provider.searchAround({ categoryId: 'culture', center, maxRequests: 1 });
  assert.equal(result.candidates[0].rawCategory, '文化传媒;图书馆');
});

test('Place v3 follows full pages, retains raw fields and deduplicates UID across query shards', async () => {
  const { provider, calls } = providerFrom(({ query, page_num }) => {
    if (query === '医院') return {
      status: 0, total: 21, result_type: 'poi_type',
      results: page_num === '0'
        ? Array.from({ length: 20 }, (_, i) => poi('h' + i, '医院' + i))
        : [poi('h20', '医院20')],
    };
    if (query === '药店') return { status: 0, total: 2, result_type: 'poi_type',
      results: [poi('h0', '医院0'), poi('p1', '仁心药店')] };
    return { status: 0, total: 0, result_type: 'poi_type', results: [] };
  });
  const result = await provider.searchAround({ categoryId: 'medical', center });
  assert.equal(result.status, 'complete');
  assert.equal(result.searchComplete, true);
  assert.equal(result.candidates.length, 22);
  assert.equal(result.pages.length, 6);
  assert.deepEqual(result.duplicateUids, ['h0']);
  assert.deepEqual(result.candidates.find((p) => p.uid === 'h0').matchedQueries, ['医院', '药店']);
  assert.deepEqual(result.candidates.find((p) => p.uid === 'p1').naviLocation, { lat: center.lat + 0.001, lng: center.lng });
  assert.equal(result.candidates.find((p) => p.uid === 'p1').rawCategory, '医疗;药店');
  assert.equal(calls[0].params.location, '30.288902,120.150993');
  assert.equal(calls[0].params.coord_type, '3');
  assert.equal(calls[0].params.page_size, '20');
  assert.deepEqual(calls.filter((call) => call.params.query === '医院').map((call) => call.params.page_num), ['0', '1']);
});

test('150 cap triggers spatial subcircles; unresolved cap is explicitly truncated', async () => {
  const { provider, calls } = providerFrom(({ query, location }) => {
    if (query !== '公园') return { status: 0, total: 0, result_type: 'poi_type', results: [] };
    if (location === '30.288902,120.150993') {
      return { status: 0, total: 150, result_type: 'poi_type', results: [poi('park-root')] };
    }
    return { status: 0, total: 1, result_type: 'poi_type', results: [poi('park-root')] };
  });
  const split = await provider.searchAround({ categoryId: 'parks', center });
  assert.equal(split.searchComplete, true);
  assert.equal(split.truncated, false);
  assert.equal(split.candidates.length, 1);
  assert.equal(calls.filter((call) => call.params.query === '公园').length, 5);
  const capped = await provider.searchAround({ categoryId: 'parks', center, maxShardDepth: 0 });
  assert.equal(capped.searchComplete, false);
  assert.equal(capped.truncated, true);
  assert.ok(capped.errors.some((error) => error.code === 'reported_total_cap'));
});

test('rate limit, request budget and invalid points never become a complete empty search', async () => {
  const throttled = createBaiduPlaceProvider({ client: { requestJson: async ({ params }) => {
    if (params.query === '医院') throw new BaiduApiError('rate_limited', { service: 'place' });
    return { data: { status: 0, total: 0, results: [] }, meta: { retrievedAt: '2026-09-29T00:00:00Z' } };
  } } });
  const limited = await throttled.searchAround({ categoryId: 'medical', center });
  assert.equal(limited.searchComplete, false);
  assert.equal(limited.status, 'failed');
  assert.equal(limited.errors[0].code, 'rate_limited');
  const { provider } = providerFrom(() => ({ status: 0, total: 0, results: [] }));
  const budgeted = await provider.searchAround({ categoryId: 'medical', center, maxRequests: 1 });
  assert.equal(budgeted.searchComplete, false);
  assert.equal(budgeted.truncated, true);
  assert.equal(budgeted.requestStats.logicalRequests, 1);
  const malformed = createBaiduPlaceProvider({ client: { requestJson: async () => ({
    data: { status: 0, total: 1, results: [{ uid: 'bad', location: { lat: null, lng: 120 } }] },
    meta: { retrievedAt: '2026-09-29T00:00:00Z' },
  }) } });
  const bad = await malformed.searchAround({ categoryId: 'medical', center });
  assert.ok(bad.invalidCandidateCount > 0);
  assert.equal(bad.searchComplete, false);
});

test('v3 subtype OR query keeps original classification, parent UID and page evidence', async () => {
  const { provider, calls } = providerFrom(() => ({ status: 0, total: 2, results: [
    { ...poi('retail', '民生大药房'), classified_poi_tag: '医疗;药店', detail_info: { tag: '零售药房', parent_id: 'building-uid' } },
    { ...poi('unknown', '仁心'), detail_info: {}, classified_poi_tag: '' },
  ] }));
  const result = await provider.searchAround({ categoryId: 'medical', subtypeId: 'pharmacy', center });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.query, '药店$药房$大药房');
  assert.equal(result.categoryMappingVersion, 'facility-categories-v3');
  assert.equal(result.candidates[0].parentUid, 'building-uid');
  assert.deepEqual(result.candidates[0].rawCategoryTags, ['医疗;药店', '零售药房']);
  assert.equal(result.candidates[0].classification.candidateStatus, 'confirmed_by_rule');
  assert.equal(result.candidates[1].classification.candidateStatus, 'pending_review');
  assert.equal(result.candidates[0].retrievalEvidence[0].pageNum, 0);
  assert.deepEqual(result.candidates[0].queriedSubtypeIds, ['pharmacy']);
  await assert.rejects(() => provider.searchAround({ categoryId: 'education', subtypeId: 'pharmacy', center }), /parent mismatch/);
});

test('v3 pagination merges UID evidence but preserves distinct entrances and same-location shops', async () => {
  const firstPage = Array.from({ length: 20 }, (_, index) => poi('p' + index, '民生药店' + index));
  const { provider } = providerFrom(({ page_num }) => ({ status: 0, total: 21,
    results: page_num === '0' ? firstPage : [{ ...poi('p0', '民生药店0'),
      detail_info: { tag: '医疗;药店', navi_location: { lat: center.lat + 0.002, lng: center.lng } } }] }));
  const full = await provider.searchAround({ categoryId: 'medical', subtypeId: 'pharmacy', center });
  assert.equal(full.searchComplete, true);
  assert.equal(full.candidates.length, 20);
  assert.equal(full.candidates[0].retrievalEvidence.length, 2);
  assert.equal(full.candidates[0].destinationVariants.length, 2);
  assert.equal(full.candidates[0].destinationConflict, true);
  assert.ok(full.candidates.some((candidate) => candidate.uid === 'p1'));
  const partial = await provider.searchAround({ categoryId: 'medical', subtypeId: 'pharmacy', center, maxRequests: 1 });
  assert.equal(partial.searchComplete, false);
  assert.equal(partial.truncated, true);
  assert.equal(partial.requestStats.logicalRequests, 1);
});
