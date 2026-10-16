import { buildSixGroupReport, renderSixGroupReportHtml, SIX_GROUP_REPORT_VERSION } from './report-v3.mjs';
import { getFacilityCategory } from './facility-categories.mjs';

export const FACILITY_REPORT_VERSION = 'facility-report-v1';

const LIMITATIONS = Object.freeze([
  '结果只描述所选起点、模式和时间阈值，不代表整片社区或人口覆盖。',
  '设施候选来自地点检索；名称和定位点不证明实际入口、营业状态或服务容量。',
  '未完成的检索或路线保持未知；评分区间不把未知当作零分。',
  '步行采样单元仅表示已测点附近的可视代理，不是连续精确等时圈。',
]);

export function buildFacilityReport(job) {
  if ([3,4,5,6,7,8].includes(job?.analysis?.version)) return buildSixGroupReport(job);
  if (!job?.analysis || !job.score || !['complete', 'partial'].includes(job.status)) {
    throw new TypeError('A completed facility analysis is required.');
  }
  const analysis = job.analysis;
  const score = job.score;
  return {
    reportVersion: FACILITY_REPORT_VERSION,
    analysisId: job.analysisId,
    createdAt: job.createdAt,
    completedAt: job.finishedAt,
    status: job.status,
    scope: 'origin_point_only',
    origin: analysis.origin,
    coordinateSystem: analysis.coordinateSystem,
    mode: analysis.mode,
    minutes: analysis.minutes,
    thresholdSeconds: analysis.thresholdSeconds,
    categoryMappingVersion: analysis.categoryMappingVersion,
    analysisVersion: analysis.algorithmVersion,
    geometry: {
      source: job.geometrySource,
      status: job.geometryStatus,
      sampleMetrics: job.sampleMetrics ?? null,
      label: job.geometrySource === 'baidu_isochrone' ? '百度官方等时圈'
        : job.geometrySource === 'walking_sampling_fallback' ? '步行路网采样近似范围'
          : '可达范围未知',
    },
    score,
    categories: analysis.categories.map((category) => ({
      categoryId: category.categoryId,
      label: getFacilityCategory(category.categoryId)?.label ?? category.categoryId,
      selectedForScore: score.selectedCategoryIds.includes(category.categoryId),
      priority: score.priorities[category.categoryId] ?? null,
      normalizedWeight: score.normalizedWeights[category.categoryId] ?? null,
      coverageStatus: category.coverageStatus,
      shortestRouteSeconds: category.shortestRouteSeconds,
      candidatesFound: category.candidatesFound,
      candidatesRouted: category.candidatesRouted,
      searchComplete: category.searchComplete,
      searchStatus: category.searchStatus,
      searchTruncated: category.searchTruncated,
      evidenceIds: category.evidenceIds,
      routes: category.routes,
    })),
    requestStats: job.requestStats,
    warnings: job.warnings,
    context: job.context ?? null,
    traffic: job.context?.traffic ?? (analysis.mode === 'driving'
      ? { status: 'permission_unverified' } : { status: 'not_applicable' }),
    limitations: LIMITATIONS,
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

const statusLabel = {
  covered: '已确认可达', over_threshold: '已确认超时',
  unknown_search: '地点检索未完成', unknown_route: '路线未完成',
};

export function renderFacilityReportHtml(report) {
  if ([SIX_GROUP_REPORT_VERSION,'facility-report-v4','facility-report-v5','facility-report-v6','facility-report-v7','facility-report-v8'].includes(report?.reportVersion)) return renderSixGroupReportHtml(report);
  if (!report || report.reportVersion !== FACILITY_REPORT_VERSION) {
    throw new TypeError('A versioned facility report is required.');
  }
  const score = report.score;
  const scoreText = score.isExact ? score.S_low.toFixed(1)
    : score.S_low.toFixed(1) + '–' + score.S_high.toFixed(1);
  const scoreByCategory = new Map(score.categories.map((row) => [row.categoryId, row]));
  const rows = report.categories.map((category) => {
    const scored = scoreByCategory.get(category.categoryId);
    const priority = category.selectedForScore ? category.priority : '未计分';
    const contribution = scored
      ? scored.contributionLow.toFixed(1) + (scored.contributionHigh !== scored.contributionLow
        ? '–' + scored.contributionHigh.toFixed(1) : '') : '—';
    return '<tr><td>' + escapeHtml(category.label)
      + '</td><td>' + escapeHtml(priority)
      + '</td><td>' + escapeHtml(scored ? (scored.normalizedWeight * 100).toFixed(1) + '%' : '—')
      + '</td><td>' + escapeHtml(statusLabel[category.coverageStatus] ?? category.coverageStatus)
      + '</td><td>' + escapeHtml(category.shortestRouteSeconds == null ? '—'
        : Math.round(category.shortestRouteSeconds) + ' 秒')
      + '</td><td>' + escapeHtml(category.searchComplete ? '完整' : '不完整')
      + '</td><td>' + escapeHtml(contribution)
      + '</td><td>' + escapeHtml(category.evidenceIds?.join(', ') || '—') + '</td></tr>';
  }).join('');
  const sample = report.geometry.sampleMetrics;
  const sampleSummary = sample
    ? '已尝试采样路线 ' + escapeHtml(sample.attemptedRouteCalls ?? '—')
      + ' 条；有效采样点 ' + escapeHtml(sample.validRoutePoints ?? '—')
      + ' 个；未知占比 ' + escapeHtml(Number.isFinite(sample.unknownShare)
        ? (sample.unknownShare * 100).toFixed(1) + '%' : '未知')
      + '；未采样占比 ' + escapeHtml(Number.isFinite(sample.unsampledShare)
        ? (sample.unsampledShare * 100).toFixed(1) + '%' : '未知')
      + '。边界分辨率不等于统计误差上界。'
    : '没有可披露的路线采样指标。';
  const stats = report.requestStats || {};
  const requestSummary = '地点检索逻辑请求 ' + escapeHtml(stats.placeRequests ?? 0)
    + '；设施路线决策 ' + escapeHtml(stats.routeDecisions ?? 0)
    + '；官方等时圈请求 ' + escapeHtml(stats.officialRequests ?? 0)
    + '；步行采样请求 ' + escapeHtml(stats.samplingRequests ?? 0) + '。';
  const warnings = (report.warnings || []).length
    ? '<p>降级与告警：' + report.warnings.map(escapeHtml).join('、') + '</p>' : '';
  const limitations = report.limitations.map((item) => '<li>' + escapeHtml(item) + '</li>').join('');
  const context = report.context ?? {};
  const eventLabels = { accident: '事故', construction: '施工', closure: '封闭', control: '交通管制' };
  const eventDetails = (context.events?.status === 'available' ? context.events.events || [] : [])
    .slice(0, 30).map((event) => '<li>' + escapeHtml(eventLabels[event.type] ?? event.type)
      + ' · ' + escapeHtml(event.title || '未命名事件') + ' · 事件时间 '
      + escapeHtml(event.observedAt ?? '未提供') + '</li>').join('');
  const contextRows = [
    ['驾车路况', context.traffic], ['AOI 边界', context.aoi], ['动态交通事件', context.events],
  ].map(([label, layer]) => '<tr><td>' + escapeHtml(label) + '</td><td>'
    + escapeHtml(layer?.status ?? '未接入') + '</td><td>'
    + escapeHtml(layer?.retrievedAt ?? '—') + '</td><td>'
    + escapeHtml(layer?.status === 'available' ? (layer?.evaluationLabel ??
      (label === '动态交通事件' ? String(layer.events?.length ?? 0) + ' 条'
        : '百度 POI UID ' + layer.uid))
      : (layer?.code ?? '—')) + '</td></tr>').join('');
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>生活圈体检报告 · '
    + escapeHtml(report.analysisId) + '</title><style>'
    + 'body{font:14px/1.6 system-ui,sans-serif;color:#183047;max-width:960px;margin:24px auto;padding:0 20px}'
    + 'h1{margin-bottom:4px}small{color:#657b8a}.summary{display:flex;gap:12px;flex-wrap:wrap;margin:18px 0}'
    + '.card{border:1px solid #c5d6df;border-radius:8px;padding:10px 16px;min-width:150px}'
    + '.card strong{display:block;font-size:23px}table{width:100%;border-collapse:collapse;font-size:12px}'
    + 'th,td{border-bottom:1px solid #d7e2e8;text-align:left;padding:8px 5px;vertical-align:top;word-break:break-word}'
    + '@media print{body{margin:0;max-width:none}.no-print{display:none}tr{break-inside:avoid}}'
    + '</style></head><body><h1>15分钟生活圈 | 智能体检与规划助手</h1>'
    + '<small>分析 ID：' + escapeHtml(report.analysisId) + ' · 完成时间：'
    + escapeHtml(report.completedAt ?? '未知') + '</small>'
    + '<div class="summary"><div class="card">所选设施可达评分<strong>' + escapeHtml(scoreText)
    + '</strong><small>' + (score.isExact ? '已确认单值' : '上下界区间，未知权重 '
      + escapeHtml((score.unknownWeight * 100).toFixed(1)) + '%') + '</small></div>'
    + '<div class="card">出行情景<strong>' + escapeHtml(report.mode) + ' '
    + escapeHtml(report.minutes) + ' 分钟</strong></div>'
    + '<div class="card">范围来源<strong>' + escapeHtml(report.geometry.label) + '</strong></div></div>'
    + '<p>起点：' + escapeHtml(report.origin?.name || report.origin?.id) + '（'
    + escapeHtml(report.origin?.source) + '；BD-09LL '
    + escapeHtml(report.origin?.location?.lng) + ', '
    + escapeHtml(report.origin?.location?.lat) + '）</p>'
    + '<h2>设施路线证据与优先级</h2><table><thead><tr><th>类别</th><th>原始权重</th>'
    + '<th>归一化</th><th>状态</th><th>最短路线</th><th>检索</th><th>评分贡献</th>'
    + '<th>证据 ID</th></tr></thead><tbody>' + rows + '</tbody></table>'
    + '<h2>地图上下文</h2><p>路况检索时间不等于路况发生时间。交通图层与事件不二次修正路线耗时、等时圈或设施评分；AOI 边界与等时圈独立。</p>'
    + '<table><thead><tr><th>图层</th><th>状态</th><th>检索时间</th><th>摘要</th></tr></thead><tbody>'
    + contextRows + '</tbody></table>'
    + (eventDetails ? '<h3>交通事件明细</h3><ul>' + eventDetails + '</ul>' : '')
    + '<h2>范围、请求与限制</h2><p>几何状态：' + escapeHtml(report.geometry.status)
    + '；' + sampleSummary + '</p><p>' + requestSummary + '</p>' + warnings
    + '<p>公式版本：' + escapeHtml(score.formulaVersion)
    + '<br>证据指纹：' + escapeHtml(score.evidenceFingerprint)
    + '<br>八类映射版本：' + escapeHtml(report.categoryMappingVersion)
    + '<br>分析口径：所选起点的设施路线可达性</p><ul>' + limitations + '</ul>'
    + '<button class="no-print" onclick="window.print()">打印报告</button></body></html>';
}
