import { createHash } from 'node:crypto';
import { BaiduApiError } from './baidu-client.mjs';
import { FACILITY_CATEGORIES, FACILITY_MAPPING_VERSION } from './facility-categories.mjs';
import { straightDistanceMeters } from './facility-coverage.mjs';
import { createLegacyFacilityAnalysis as createFacilityAnalysis } from './facility-analysis.mjs';
import { scoreFacilityPriorities } from './priority-score.mjs';
import { buildIsochrone } from './isochrone.mjs';
import { classifyOfficialPoint } from './geometry.mjs';
import { validBd09ll } from './walking-provider.mjs';

export const VALIDATION_VERSION = 'wenjin-api-validation-v1';
const ENDPOINTS = Object.freeze({
  '/place/v3/region': 'place', '/place/v3/around': 'place',
  '/directionlite/v1/walking': 'facility_route', '/direction/v2/walking': 'sampling_route',
  '/logistics_truck/v1/isochrone': 'isochrone', '/traffic/v1/around': 'traffic',
});
const FATAL_API = new Set([3, 4, 5, 9, 101, 200, 201, 202, 203, 210, 211, 240, 302, 401]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Persist only public POI and route fields, never request URLs, AK, provider messages or contact details.
export function safeResponse(data) {
  const location = (raw) => validBd09ll({ lat: Number(raw?.lat), lng: Number(raw?.lng) })
    && raw?.lat != null && raw?.lng != null ? { lat: Number(raw.lat), lng: Number(raw.lng) } : null;
  const result = { status: Number.isInteger(data?.status) ? data.status : null };
  if (Array.isArray(data?.results)) {
    result.total = data.total ?? null;
    result.result_type = data.result_type ?? null;
    result.results = data.results.slice(0, 20).map((poi) => ({
      uid: typeof poi.uid === 'string' ? poi.uid : null, name: String(poi.name ?? ''),
      address: String(poi.address ?? ''), location: location(poi.location),
      city: poi.city ?? null, area: poi.area ?? null,
      rawCategory: String(poi.detail_info?.classified_poi_tag ?? poi.classified_poi_tag
        ?? poi.detail_info?.tag ?? poi.tag ?? ''),
      naviLocation: location(poi.detail_info?.navi_location ?? poi.navi_location),
    }));
  }
  if (Array.isArray(data?.result?.routes)) {
    result.result = {
      origin: location(data.result.origin?.originPt),
      destination: location(data.result.destination?.destinationPt),
      routes: data.result.routes.slice(0, 1).map((route) => ({
        duration: route.duration ?? null, distance: route.distance ?? null,
        // Coordinates support replay; omit narrative instructions and external detail URLs.
        paths: (route.steps ?? []).slice(0, 60).map((step) => String(step.path ?? '')).filter(Boolean),
      })),
    };
  }
  if (typeof data?.result?.path === 'string') result.result = { path: data.result.path };
  if (data?.evaluation) result.evaluation = { status: data.evaluation.status ?? null };
  return result;
}

export function createValidationTransport({ fetchImpl = fetch, limits = {}, minIntervalMs = 1100,
  onEvidence = async () => {}, now = Date.now, wait = sleep } = {}) {
  const caps = { place: 48, facility_route: 24, sampling_route: 60, isochrone: 0, traffic: 0, ...limits };
  if (Object.values(caps).some((n) => !Number.isInteger(n) || n < 0)
    || !Number.isFinite(minIntervalMs) || minIntervalMs < 0) throw new RangeError('Invalid validation limits.');
  const counts = Object.fromEntries(Object.keys(caps).map((key) => [key, 0]));
  let stoppedReason = null, sequence = Promise.resolve(), lastStarted = -Infinity;
  function boundedFetch(urlString, options = {}) {
    const task = sequence.then(async () => {
      const url = new URL(urlString);
      const service = ENDPOINTS[url.pathname];
      if (url.origin !== 'https://api.map.baidu.com' || !service) throw new TypeError('Unapproved validation endpoint.');
      if (stoppedReason) throw new BaiduApiError(stoppedReason, { service });
      if (counts[service] >= caps[service]) throw new BaiduApiError('validation_budget_exhausted', { service });
      if (options.signal?.aborted) throw new BaiduApiError('cancelled', { service });
      await wait(Math.max(0, minIntervalMs - (now() - lastStarted)));
      if (options.signal?.aborted) throw new BaiduApiError('cancelled', { service });
      lastStarted = now();
      counts[service] += 1;
      const params = {};
      for (const key of ['query', 'region', 'region_limit', 'scope', 'output', 'location', 'radius', 'radius_limit', 'page_num', 'page_size',
        'coord_type', 'ret_coordtype', 'origin', 'destination', 'origin_uid', 'destination_uid',
        'profile', 'point', 'timeLimit', 'inputCrs', 'outputCrs', 'center']) {
        if (url.searchParams.has(key)) params[key] = url.searchParams.get(key);
      }
      const record = { service, endpoint: url.pathname, params,
        requestedAt: new Date(now()).toISOString(), httpStatus: null, apiStatus: null };
      try {
        const response = await fetchImpl(urlString, options);
        record.httpStatus = response.status;
        let data;
        try { data = await response.clone().json(); }
        catch { record.error = 'invalid_json'; }
        record.apiStatus = Number.isInteger(data?.status) ? data.status : null;
        record.response = safeResponse(data);
        if ([401, 403].includes(response.status)) stoppedReason = 'permission_denied';
        else if (response.status === 429 || record.apiStatus === 401) stoppedReason = 'rate_limited';
        else if ([4, 302].includes(record.apiStatus)) stoppedReason = 'quota_exhausted';
        else if (FATAL_API.has(record.apiStatus)) stoppedReason = 'permission_denied';
        record.retrievedAt = new Date(now()).toISOString();
        record.stoppedReason = stoppedReason;
        record.responseHash = hash(record.response);
        await onEvidence(record);
        return response;
      } catch (error) {
        stoppedReason ||= error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'upstream_unavailable';
        record.error = stoppedReason;
        record.retrievedAt = new Date(now()).toISOString();
        await onEvidence(record);
        throw new BaiduApiError(stoppedReason, { service });
      }
    });
    sequence = task.catch(() => {});
    return task;
  }
  return { fetch: boundedFetch, stats: () => ({ counts: { ...counts }, limits: { ...caps },
    totalRequests: Object.values(counts).reduce((a, b) => a + b, 0), stoppedReason, minIntervalMs }) };
}

function offset(center, north, east) {
  return { lat: center.lat + north / 111320,
    lng: center.lng + east / (111320 * Math.cos(center.lat * Math.PI / 180)) };
}
const pointKey = (point) => point.lat.toFixed(6) + ',' + point.lng.toFixed(6);
function contains(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > point.lat) !== (b[1] > point.lat)
      && point.lng < (b[0] - a[0]) * (point.lat - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function proxySupportAt(sampling, point) {
  const cells = (sampling?.geojson?.features ?? []).filter((feature) =>
    ['sample_cell', 'refined_sample_cell'].includes(feature.properties?.featureType)
    && feature.geometry?.type === 'Polygon' && contains(point, feature.geometry.coordinates[0]));
  if (!cells.length) return { status: 'unknown', evidenceId: null, durationSeconds: null };
  const refined = cells.filter((feature) => feature.properties.featureType === 'refined_sample_cell');
  const selected = refined.length ? refined : cells;
  const statuses = new Set(selected.map((feature) => feature.properties.coverageStatus));
  if (statuses.size !== 1 || statuses.has('unknown')) return { status: 'unknown', evidenceId: null, durationSeconds: null };
  return { status: selected[0].properties.coverageStatus, evidenceId: selected[0].properties.evidenceId,
    durationSeconds: selected[0].properties.durationSeconds };
}
export function selectHoldoutPoints(sampling, { count = 12 } = {}) {
  if (!validBd09ll(sampling?.center) || !Number.isInteger(count) || count < 4 || count > 20) {
    throw new TypeError('A sampling result and holdout count from 4 to 20 are required.');
  }
  const excluded = new Set((sampling.samples ?? []).map(pointKey));
  const selected = [], seenSectors = new Set();
  const valid = (sampling.samples ?? []).filter((sample) => sample.offsetMeters > 0
    && sample.decisionSource === 'baidu_walking_duration')
    .sort((a, b) => Math.abs(a.durationSeconds - 900) - Math.abs(b.durationSeconds - 900));
  const add = (point) => {
    const key = pointKey(point);
    if (excluded.has(key) || selected.some((item) => pointKey(item) === key)) return;
    selected.push({ ...point, id: 'holdout-' + String(selected.length + 1).padStart(2, '0') });
  };
  for (const sample of [...valid.filter((s) => {
    if (seenSectors.has(s.sector)) return false;
    seenSectors.add(s.sector); return true;
  }), ...valid]) {
    if (selected.length >= count - 4) break;
    const delta = sample.sampleStage === 'boundary_refinement' ? 20 : 45;
    add({ ...offset(sampling.center, sample.northOffsetMeters + delta, sample.eastOffsetMeters + delta),
      group: 'sample_cell_neighborhood', pairedEvidenceId: sample.evidenceId });
  }
  for (const [north, east] of [[1200, 0], [0, 1200], [-1200, 0], [0, -1200],
    [1050, 750], [-750, -1050], [750, -1050], [-1050, 750], [750, 450], [-450, -750], [450, -750], [-750, 450]]) {
    if (selected.length >= count) break;
    add({ ...offset(sampling.center, north, east), group: 'outer_window_stress' });
  }
  return selected;
}
export function evaluateHoldout(sampling, point, route, official = null) {
  const valid = route?.routeStatus === 'ok' && Number.isFinite(route.durationSeconds)
    && route.durationSeconds >= 0;
  const observedStatus = valid ? (route.durationSeconds <= 900 ? 'covered' : 'over_threshold') : 'unknown';
  const support = proxySupportAt(sampling, point);
  return { ...point, referenceRoute: route, observedStatus, proxySupport: support,
    comparable: observedStatus !== 'unknown' && support.status !== 'unknown',
    agrees: observedStatus !== 'unknown' && support.status !== 'unknown' ? observedStatus === support.status : null,
    localDurationDifferenceSeconds: valid && Number.isFinite(support.durationSeconds)
      ? Math.abs(route.durationSeconds - support.durationSeconds) : null,
    requestedToReturnedMeters: validBd09ll(route?.destination)
      ? straightDistanceMeters(point, route.destination) : null,
    officialAssessment: official ? classifyOfficialPoint(official, point) : null };
}
export function summarizeHoldouts(rows) {
  const valid = rows.filter((r) => r.observedStatus !== 'unknown');
  const compared = rows.filter((r) => r.comparable);
  const differences = compared.map((r) => r.localDurationDifferenceSeconds).filter(Number.isFinite);
  return { total: rows.length, valid: valid.length, unknown: rows.length - valid.length,
    covered: valid.filter((r) => r.observedStatus === 'covered').length,
    overThreshold: valid.filter((r) => r.observedStatus === 'over_threshold').length,
    proxySupported: compared.length, proxyUnsupported: rows.filter((r) => r.proxySupport.status === 'unknown').length,
    matches: compared.filter((r) => r.agrees).length,
    agreementShare: compared.length ? compared.filter((r) => r.agrees).length / compared.length : null,
    localDurationMaeSeconds: differences.length ? differences.reduce((a, b) => a + b, 0) / differences.length : null,
    interpretation: 'Purposeful API holdouts; local visual proxy diagnostics only, not statistical accuracy or field walking measurement.' };
}

export async function runWenjinValidation({ reference, client, placeProvider, routeProvider,
  samplingProvider, officialProvider = null, sampleCalls = 48,
  stats = () => ({}), onProgress = () => {}, signal } = {}) {
  if (!validBd09ll(reference?.center) || !client?.requestJson || !placeProvider?.searchAround
    || !routeProvider?.route || !samplingProvider?.route) throw new TypeError('Validation providers are required.');
  const output = { validationVersion: VALIDATION_VERSION, categoryMappingVersion: FACILITY_MAPPING_VERSION,
    startedAt: new Date().toISOString(), status: 'running', reference,
    origin: { id: 'wenjin-reference', name: reference.standardName, source: 'provided_reference_point',
      location: reference.center, uid: null }, originVerification: { status: 'unverified' },
    categories: [], facilityRoutes: [], sampling: null, holdouts: [], optionalServices: {
      isochrone: { status: officialProvider ? 'pending' : 'permission_unverified' },
      matrix: { status: 'not_tested' }, traffic: { status: 'not_tested' },
      aoi: { status: 'permission_unverified' }, events: { status: 'permission_unverified' },
    } };
  onProgress({ phase: 'origin' });
  try {
    const { data, meta } = await client.requestJson({ service: 'place', path: '/place/v3/region',
      params: { query: reference.standardName, region: '杭州市西湖区', region_limit: 'true',
        coord_type: '3', page_num: '0', page_size: '10', scope: '2', output: 'json' }, signal });
    const matches = (data.results ?? []).filter((poi) => validBd09ll(poi.location)
      && String(poi.name).includes('文锦社区') && !/北门|西门|停车|幢|委员会|服务站/.test(poi.name)
      && straightDistanceMeters(reference.center, poi.location) <= 500);
    const found = matches.sort((a, b) => straightDistanceMeters(reference.center, a.location)
      - straightDistanceMeters(reference.center, b.location))[0];
    output.originVerification = { status: found ? 'matched_poi_point' : 'no_unique_match',
      retrievedAt: meta.retrievedAt, candidates: safeResponse(data).results,
      displacementMeters: found ? straightDistanceMeters(reference.center, found.location) : null };
    if (found) output.origin = { id: String(found.uid || 'wenjin-poi'), uid: found.uid ?? null,
      source: 'baidu_poi', name: found.name, address: found.address, location: found.location };
  } catch (error) {
    output.originVerification = { status: 'failed', code: error.code ?? 'upstream_unavailable',
      apiStatus: error.apiStatus ?? null, httpStatus: error.httpStatus ?? null };
  }
  const origin = output.origin;
  const searchResults = new Map();
  for (const category of FACILITY_CATEGORIES) {
    onProgress({ phase: 'places', categoryId: category.id });
    const searches = [], merged = new Map();
    for (const radiusMeters of [1500, 3000, 5000]) {
      if (stats().stoppedReason) break;
      const result = await placeProvider.searchAround({ categoryId: category.id, center: origin.location,
        radiusMeters, pageSize: 10, maxRequests: 3, maxPagesPerShard: 1, maxShardDepth: 0, signal });
      searches.push(result);
      for (const poi of result.candidates) if (poi.uid && poi.classification?.candidateStatus !== 'excluded_by_rule') {
        merged.set(poi.uid, poi);
      }
      if (merged.size >= 3) break;
    }
    const candidates = [...merged.values()].sort((a, b) => straightDistanceMeters(origin.location, a.location)
      - straightDistanceMeters(origin.location, b.location));
    const selected = candidates.slice(0, 3);
    output.categories.push({ categoryId: category.id, label: category.label,
      candidateCount: candidates.length, selected, searchRadiiMeters: searches.map((s) => s.radiusMeters),
      searches: searches.map(({ candidates: omitted, ...rest }) => rest),
      reviewStatus: 'api_metadata_only_not_field_confirmed' });
    searchResults.set(category.id, { candidates: selected, candidatesFound: candidates.length,
      status: candidates.length ? 'partial' : 'failed', searchComplete: false, truncated: true,
      pages: searches.flatMap((s) => s.pages), errors: searches.flatMap((s) => s.errors) });
    for (const poi of selected) {
      if (stats().stoppedReason) break;
      onProgress({ phase: 'facility_routes', categoryId: category.id });
      const destination = poi.naviLocation ?? poi.location;
      const route = await routeProvider.route(origin, { location: destination, uid: poi.uid }, { mode: 'walking', signal });
      output.facilityRoutes.push({ categoryId: category.id, uid: poi.uid, name: poi.name,
        destination, destinationSource: poi.naviLocation ? 'navi_location' : 'location', route });
    }
  }
  if (!stats().stoppedReason) {
    onProgress({ phase: 'sampling' });
    output.sampling = await buildIsochrone({ center: origin.location, provider: samplingProvider,
      maxRouteCalls: sampleCalls, onProgress: (p) => onProgress({ ...p, phase: 'sampling' }) });
    if (officialProvider && !stats().stoppedReason) {
      try {
        output.official = await officialProvider.getIsochrone({ center: origin.location, mode: 'walking', minutes: 15, signal });
        output.optionalServices.isochrone = { status: 'available' };
      } catch (error) { output.optionalServices.isochrone = { status: 'failed', code: error.code ?? 'invalid_response' }; }
    }
    for (const point of selectHoldoutPoints(output.sampling)) {
      if (stats().stoppedReason) break;
      onProgress({ phase: 'holdouts', completed: output.holdouts.length, total: 12 });
      const route = await samplingProvider.route(origin.location, point);
      output.holdouts.push(evaluateHoldout(output.sampling, point, route, output.official));
    }
  }
  const recordedRoutes = new Map(output.facilityRoutes.map((row) => [row.uid, row.route]));
  output.analysis = await createFacilityAnalysis({
    placeProvider: { searchAround: async ({ categoryId }) => searchResults.get(categoryId) },
    routeProvider: { route: async (_from, _to, options) => recordedRoutes.get(options.destinationUid)
      ?? { routeStatus: 'unverified', durationSeconds: null } },
  }).analyze({ origin, maxRouteCandidates: 3, geometry: output.official ?? output.sampling });
  output.score = scoreFacilityPriorities({ analysis: output.analysis });
  output.holdoutMetrics = summarizeHoldouts(output.holdouts);
  output.requestStats = stats();
  const validRoutes = output.facilityRoutes.filter((r) => r.route.routeStatus === 'ok').length
    + (output.sampling?.sampleMetrics.validRoutePoints ?? 0) + output.holdoutMetrics.valid;
  output.acceptance = { atLeastTenValidRoutes: validRoutes >= 10, validRoutes,
    atLeastThreePoisEach: output.categories.length === FACILITY_CATEGORIES.length
      && output.categories.every((c) => c.selected.length >= 3),
    independentHoldoutsComplete: output.holdoutMetrics.valid >= 10,
    samplingAvailable: output.sampling?.geometryStatus === 'sampled_approximation',
    originMatched: output.originVerification.status === 'matched_poi_point' };
  output.status = Object.entries(output.acceptance).filter(([key]) => key !== 'validRoutes')
    .every(([, value]) => value === true) && !output.requestStats.stoppedReason ? 'complete' : 'partial';
  output.finishedAt = new Date().toISOString();
  return output;
}

const cell = (value) => String(value ?? '—').replace(/\|/g, '／').replace(/[\r\n]+/g, ' ');
const percent = (value) => Number.isFinite(value) ? (value * 100).toFixed(1) + '%' : '不可计算';
export function renderValidationMarkdown(run, artifacts = {}) {
  const localTime = (value) => value ? new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium', hour12: false,
  }).format(new Date(value)) : '—';
  const lines = ['# 文锦社区 C16 真实 API 验证', '',
    '执行时间：' + localTime(run.startedAt) + ' 至 ' + localTime(run.finishedAt) + '（Asia/Shanghai）。',
    'UTC 原始时间：' + cell(run.startedAt) + ' 至 ' + cell(run.finishedAt) + '。',
    '', '状态：**' + run.status + '**。记录来自本次真实请求；不代表现场步行计时。',
    ...(run.acceptance.validRoutes === 0 ? ['', '本轮未获得有效路线，C16 真实数据验收尚未完成。'] : []), '',
    '## 起点与授权范围', '', '起点：' + cell(run.origin.name) + '，BD-09LL ' + cell(run.origin.location.lng)
      + ', ' + cell(run.origin.location.lat) + '；来源 ' + cell(run.origin.source) + '；UID ' + cell(run.origin.uid) + '。',
    '定位核验：' + cell(run.originVerification.status) + '；与历史样例点偏移 '
      + cell(run.originVerification.displacementMeters?.toFixed(1)) + ' 米。百度 POI 定位点未认定为社区几何中心或实际入口。',
    '用户执行 C16 的指令授权本轮有限真实调用；不更改账户权限或默认高级服务开关。', '',
    '起点请求结果：HTTP ' + cell(run.originVerification.httpStatus)
      + '；业务状态 ' + cell(run.originVerification.apiStatus) + '；错误 ' + cell(run.originVerification.code) + '。', '',
    '## 验收条件', '', '| 条件 | 结果 |', '|---|---|',
    ...Object.entries(run.acceptance).map(([key, value]) => '| ' + key + ' | ' + cell(value) + ' |'), '',
    '## 八类 POI 与路线', '',
    '| 类别 | UID | 名称 | 原始分类 | 搜索半径 | 终点来源 | 步行秒数 | 路线状态 |', '|---|---|---|---|---|---|---|---|'];
  for (const category of run.categories) {
    if (!category.selected.length) lines.push('| ' + category.label + ' | — | 未获得有效候选 | — | '
      + category.searchRadiiMeters.join('/') + ' | — | — | 未知 |');
    for (const poi of category.selected) {
      const evidence = run.facilityRoutes.find((r) => r.categoryId === category.categoryId && r.uid === poi.uid);
      lines.push('| ' + [category.label, poi.uid, poi.name, poi.rawCategory,
        category.searchRadiiMeters.join('/'), evidence?.destinationSource,
        evidence?.route.durationSeconds, evidence?.route.routeStatus ?? '未请求'].map(cell).join(' | ') + ' |');
    }
  }
  const score = run.score;
  lines.push('', '同证据默认等权评分：' + cell(score.S_low) + '–' + cell(score.S_high)
    + '；未知权重 ' + percent(score.unknownWeight) + '；指纹 ' + score.evidenceFingerprint + '。',
    '上述为受限检索的候选样例和路线证据；检索可能截断，分类、营业、公众开放与入口尚需人工现场复核。', '',
    ...(run.acceptance.validRoutes === 0 ? ['当前 0–100 仅表达全未知状态，不能作为社区体检得分。', ''] : []),
    '## 自研采样与独立点交叉核验', '',
    '采样版本：' + cell(run.sampling?.algorithmVersion) + '；状态 ' + cell(run.sampling?.geometryStatus) + '。',
    '尝试路线 ' + cell(run.sampling?.sampleMetrics.attemptedRouteCalls) + '；有效采样路线 '
      + cell(run.sampling?.sampleMetrics.validRoutePoints) + '；未知占比 '
      + percent(run.sampling?.sampleMetrics.unknownShare) + '；未采样占比 '
      + percent(run.sampling?.sampleMetrics.unsampledShare) + '。',
    '独立点 ' + run.holdoutMetrics.total + '，有效路线 ' + run.holdoutMetrics.valid
      + '，可达 ' + run.holdoutMetrics.covered + '，超时 ' + run.holdoutMetrics.overThreshold + '。',
    '有采样单元邻域支持的独立点 ' + run.holdoutMetrics.proxySupported + '，一致 '
      + run.holdoutMetrics.matches + '，诊断一致比例 ' + percent(run.holdoutMetrics.agreementShare)
      + '；邻近样点时长差 MAE ' + cell(run.holdoutMetrics.localDurationMaeSeconds?.toFixed(1)) + ' 秒。',
    '无采样支持点 ' + run.holdoutMetrics.proxyUnsupported + ' 个，保持未知，不记为可达或超时预测。',
    '独立点没有参与粗采样或边界加密，采用定向选点而非随机统计样本；该一致比例仅用于邻域可视代理诊断，不能称全社区算法准确率或连续边界误差。', '',
    '| 独立点 | 组别 | 真实步行秒数 | 阈值结论 | 可视代理支持 | 一致 |', '|---|---|---|---|---|---|',
    ...run.holdouts.map((r) => '| ' + [r.id, r.group, r.referenceRoute.durationSeconds,
      r.observedStatus, r.proxySupport.status, r.agrees].map(cell).join(' | ') + ' |'), '',
    '## 调用量与未验证项', '', '| 服务 | 实际请求 | 本轮硬上限 |', '|---|---|---|',
    ...Object.entries(run.requestStats.counts ?? {}).map(([key, value]) => '| ' + key + ' | '
      + value + ' | ' + run.requestStats.limits[key] + ' |'),
    '', '最小请求间隔 ' + cell(run.requestStats.minIntervalMs) + ' ms；自动重试 0；停止原因 '
      + cell(run.requestStats.stoppedReason) + '。平台批准日额度、剩余额度和有效期仍未知，本轮上限不等于平台配额。',
    '',
    ...Object.entries(run.optionalServices).map(([key, value]) => '- ' + key + '：' + cell(value.status)), '',
    '## 复核与复跑', '', '运行版本 ' + run.validationVersion + '；八类映射 ' + run.categoryMappingVersion + '。',
    '脱敏完整结果：' + cell(artifacts.result) + '；逐请求证据：' + cell(artifacts.evidence)
      + '；采样与独立点 GeoJSON：' + cell(artifacts.geojson) + '；哈希清单：' + cell(artifacts.manifest) + '。',
    '`npm run validate:wenjin -- --replay <结果JSON路径>` 只重算报告，不调用百度。',
    '`npm run validate:wenjin -- --live` 会产生新真实调用并消耗配额，保持默认限速与硬上限。', '',
    '缺失的高级权限、真实边界、人口分布和现场测量不以 Mock 替代。');
  if (run.originVerification.apiStatus === 210) lines.push('', '## 本轮阻塞：服务端 IP 校验失败', '',
    '百度官方状态码表将 210 定义为 APP IP 校验失败。这说明当前请求出口未通过服务端 AK 的 IP 白名单校验；不能据此判断 Place v3 是否获批。',
    '来源：[百度 Web API 状态码](https://lbs.baidu.com/faq/api?title=webapi/appendix)。', '',
    '1. 在百度地图控制台 → 应用管理 → 我的应用，打开与本机 BAIDU_SERVER_AK 对应的服务端应用。',
    '2. 检查服务端应用的 IP 校验配置，将实际请求的公网出口 IP 加入白名单。localhost、127.0.0.1 和局域网地址不能替代公网出口。',
    '3. 如果启用了代理/VPN，核对请求百度时的实际出口；ipify 等外部服务返回的 IP 只能作为候选，不能证明百度看到同一个 IP。',
    '4. 保存控制台配置后，重新运行一次 --live；脚本先做起点检索，成功才继续八类 POI、路线与采样；仍返回 210 时再次停止。',
    '5. 若返回 9/240、4/302 或 401，分别按高级/服务权限、日配额或并发额度处理，不循环重试。', '',
    '脚本不修改控制台白名单，也不把所有来源自动放行。IP 校验修复前，后续接口与所有 C16 验收条件保持未验证。');
  return lines.join('\n') + '\n';
}
