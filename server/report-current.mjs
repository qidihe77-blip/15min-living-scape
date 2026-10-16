import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { facilityCategoryTree } from './facility-categories.mjs';
import { lightReportModel } from '../web/report-charts-light.js';
import { fmt } from '../web/report-charts-a36.js';
import { facilitySunburstOption, sunburstNameGraphics } from '../web/report-sunburst-a37.js';
import { refinedRadarOption, radarAxisGraphics } from '../web/radar-a38.js';
import { contributionRadarOption } from '../web/report-charts-light.js';
import { ringScoreOption, scoreSummary } from '../web/report-ring.js';
import { specialtyStatsRows } from '../web/specialty-diagnostics.js';
import { decisionSeconds } from '../web/walking-model.js';
import { reportMapSnapshot } from './report-map.mjs';

const escapeHtml = (value) => String(value ?? '—').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const number = (value, digits = 1) => Number.isFinite(value) ? Number(value.toFixed(digits)).toString() : '—';
const interval = (low, high, suffix = '') => low == null ? '—'
  : low === high ? `${number(low)}${suffix}` : `${number(low)}–${number(high)}${suffix}`;
const dateText = (value) => value ? new Date(value).toLocaleString('zh-CN', {
  timeZone: 'Asia/Shanghai', hour12: false,
}) : '未提供';
const decisionMinutes = (item) => {
  const seconds = decisionSeconds(item?.routeEvidence ?? item);
  return Number.isFinite(seconds) ? seconds / 60 : null;
};

let echartsLibrary;
function echarts() {
  if (echartsLibrary) return echartsLibrary;
  const module = { exports: {} };
  runInNewContext(readFileSync(new URL('../web/vendor/echarts-6.0.0.min.js', import.meta.url), 'utf8'), {
    exports: module.exports, module, setTimeout, clearTimeout, console,
  }, { timeout: 10000 });
  echartsLibrary = module.exports;
  return echartsLibrary;
}

function renderSvg(option, width, height, decorate) {
  const chart = echarts().init(null, null, { renderer: 'svg', ssr: true, width, height });
  try {
    chart.setOption({ ...option, animation: false, tooltip: { show: false } });
    if (decorate) chart.setOption({ graphic: decorate(chart) }, { silent: true });
    return chart.renderToSVGString();
  } finally {
    chart.dispose();
  }
}

export function printableFacilityCharts(model, width = 335, height = 260) {
  const sunburst = renderSvg(
    facilitySunburstOption(model, echarts(), width, height), width, height,
    (chart) => sunburstNameGraphics(chart),
  );
  const radarOption = refinedRadarOption(model, width, height);
  if (model.confirmedScore === 0) radarOption.series[0].data = radarOption.series[0].data.slice(0, 1);
  const radar = renderSvg(
    radarOption, width, height,
    (chart) => radarAxisGraphics(
      model, chart.getModel().getSeriesByIndex(0).coordinateSystem,
      contributionRadarOption(model).axisMax, width,
    ),
  );
  return { sunburst, radar };
}

function scoreRing(model) {
  return renderSvg(ringScoreOption(model, { width: 220, height: 220, reduced: true }), 220, 220);
}

function categoryBars(model) {
  const maximum = Math.max(1, ...model.view.groups.map((group) => group.reachablePoiCount));
  return model.view.groups.map((group) => `<div class="category-bar" style="--category-color:${group.color}">
    <div class="category-bar-label">${escapeHtml(group.label)}</div>
    <div class="category-bar-track"><i style="width:${(group.reachablePoiCount / maximum * 100).toFixed(2)}%"></i></div>
    <strong>${group.reachablePoiCount}处</strong>
  </div>`).join('');
}

function categoryBarTable(model) {
  return `<table class="compact-table"><thead><tr><th>大类</th><th>确认可达设施</th><th>小类覆盖</th><th>覆盖率</th><th>权重</th><th>评分贡献</th></tr></thead><tbody>${model.view.groups.map((group) => {
    const score = group.score ?? {};
    return `<tr><td>${escapeHtml(group.label)}</td><td>${group.reachablePoiCount}处</td><td>${group.reachable}/${group.subtypes.length}</td><td>${interval(group.low, group.high, '%')}</td><td>${number(score.normalizedWeight * 100)}%</td><td>${interval(score.contributionLow, score.contributionHigh, '分')}</td></tr>`;
  }).join('')}</tbody></table>`;
}

function subtypeDataTable(model) {
  return `<table class="compact-table subtype-table"><thead><tr><th>大类 / 小类</th><th>状态</th><th>设施数</th><th>占全部POI</th><th>最近设施</th><th>步行时间</th><th>距离</th></tr></thead><tbody>${model.view.groups.flatMap((group) => group.subtypes.map((subtype) => {
    const chartSubtype = model.groups.find((item) => item.id === group.id)?.children.find((item) => item.id === subtype.id);
    const nearest = subtype.nearest;
    const minutes = decisionMinutes(nearest);
    return `<tr><td><b>${escapeHtml(group.label)}</b><br>${escapeHtml(subtype.label)}</td><td>${escapeHtml(subtype.statusText)}</td><td>${chartSubtype?.value ?? 0}</td><td>${model.totalPoi ? number((chartSubtype?.value ?? 0) / model.totalPoi * 100) : '0'}%</td><td>${escapeHtml(nearest?.name ?? '—')}</td><td>${minutes == null ? '—' : `${number(minutes)}分钟`}</td><td>${Number.isFinite(nearest?.distanceMeters) ? `${Math.round(nearest.distanceMeters)}米` : '—'}</td></tr>`;
  })).join('')}</tbody></table>`;
}

function radarDataTable(model) {
  const total = model.confirmedScore;
  return `<table class="compact-table"><thead><tr><th>大类</th><th>期望权重</th><th>实际贡献占比</th><th>评分贡献</th><th>可达小类</th><th>待核验</th></tr></thead><tbody>${model.view.groups.map((group) => {
    const contribution = group.score?.contributionLow;
    const share = total > 0 && Number.isFinite(contribution) ? contribution / total * 100 : null;
    return `<tr><td>${escapeHtml(group.label)}</td><td>${number(group.score?.normalizedWeight * 100)}%</td><td>${share == null ? '暂无贡献' : `${number(share)}%`}</td><td>${interval(group.score?.contributionLow, group.score?.contributionHigh, '分')}</td><td>${group.reachable}/${group.subtypes.length}</td><td>${group.unknown}</td></tr>`;
  }).join('')}</tbody></table>`;
}

function specialtySection(report, tree, model) {
  const rows = specialtyStatsRows(report, tree, {}, model.reachableRows);
  return `<div class="specialty-grid">${rows.map((row) => `<article class="specialty-card">
    <div class="specialty-card-head"><b>${escapeHtml(row.label)}</b><span class="status-chip" style="--status-color:${escapeHtml(row.color ?? '#6D8EA5')}">${escapeHtml(row.statusLabel)}</span></div>
    <strong>${escapeHtml(row.nearest?.name ?? row.name ?? '暂无已核验设施')}</strong>
    <span>${row.distanceMeters == null ? '距离待核验' : `${Math.round(row.distanceMeters)}米 · ${number(row.minutes)}分钟`}</span>
    <small>${escapeHtml(row.reasonDescription || row.definitionNote || '一公里专项基于真实步行距离；直线距离仅作参考。')}</small>
  </article>`).join('')}</div><table class="compact-table"><thead><tr><th>重点服务</th><th>状态</th><th>最近已核验设施</th><th>步行距离</th><th>估算时间</th><th>不确定性</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.statusLabel)}</td><td>${escapeHtml(row.nearest?.name ?? row.name ?? '—')}</td><td>${row.distanceMeters == null ? '—' : `${Math.round(row.distanceMeters)}米`}</td><td>${row.minutes == null ? '—' : `${number(row.minutes)}分钟`}</td><td>${escapeHtml(row.reasonDescription || '—')}</td></tr>`).join('')}</tbody></table>`;
}

function blindspotSection(report) {
  const regional = report.regionalGaps;
  const cells = regional?.blindZones?.length ? regional.blindZones
    : (regional?.cells ?? []).filter((cell) => cell.blind || cell.candidateBlind);
  if (!regional && !report.serviceGaps) return '';
  const regionalSummary = regional ? `<div class="metric-strip"><div><b>${regional.summary?.insideCells ?? '—'}</b><span>圈内网格</span></div><div><b>${regional.summary?.candidateBlindCells ?? regional.summary?.estimatedBlindCells ?? 0}</b><span>候选盲区</span></div><div><b>${regional.summary?.blindRatio == null ? '未知' : `${number(regional.summary.blindRatio)}%`}</b><span>盲区比例</span></div></div><p class="note">区域盲区为网格模型估算，独立于总体评分和一公里重点服务专项；${escapeHtml(regional.distanceDefinition ?? '未提供估算口径')}。</p>` : '<p class="note">当前快照未启用区域网格盲区评估；一公里重点服务缺项见上节。未知不等于不存在。</p>';
  const rows = cells.map((cell) => `<tr><td>${escapeHtml(cell.id)}</td><td>${cell.center ? `${number(cell.center.lng, 6)}, ${number(cell.center.lat, 6)}` : '—'}</td><td>${interval(cell.scoreInterval?.low, cell.scoreInterval?.high, '')}</td><td>${escapeHtml(cell.status ?? (cell.blind ? '盲区' : '候选盲区'))}</td><td>${escapeHtml((cell.reasonCodes ?? []).join('、') || '—')}</td></tr>`).join('');
  return `<section class="report-section insight-section"><div class="section-kicker">04 / 空间缺口</div><h2>盲区分析</h2>${regionalSummary}${cells.length ? `<table class="compact-table"><thead><tr><th>网格</th><th>中心坐标</th><th>评分区间</th><th>状态</th><th>判定说明</th></tr></thead><tbody>${rows}</tbody></table>` : ''}</section>`;
}

function provenanceSection(report) {
  const stats = report.requestStats ?? {};
  const sourceRows = [
    ['分析ID', report.analysisId], ['分析日期', dateText(report.analysis?.observedAt ?? report.completedAt)],
    ['数据快照', report.evidenceSnapshotId], ['分类版本', report.categoryMappingVersion],
    ['评分公式', report.scoreFormulaVersion ?? report.score?.formulaVersion],
    ['步行模型', report.walkingModelId ?? report.walkingModel], ['时间阈值', `${report.thresholdSeconds ?? 900}秒`],
    ['范围来源', report.geometry?.rangeSource ?? report.geometry?.geometrySource],
    ['检索半径', report.searchWindow?.radiusMeters == null ? '—' : `${report.searchWindow.radiusMeters}米`],
    ['请求统计', Object.entries(stats).filter(([, value]) => value != null).map(([key, value]) => `${key}: ${value}`).join('；') || '—'],
  ];
  const notes = [...(report.limitations ?? []), ...(report.geometry?.warnings ?? []), ...(report.warnings ?? [])];
  return `<section class="report-section source-section"><div class="section-kicker">06 / 口径与来源</div><h2>数据来源、计算口径与不确定性</h2><table class="compact-table source-table"><tbody>${sourceRows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join('')}</tbody></table><ul class="notes">${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul></section>`;
}

export function renderV8PrintableReport(report) {
  const tree = facilityCategoryTree(report.categoryMappingVersion);
  const model = lightReportModel(report, tree);
  const summary = scoreSummary(model, { ...report, analysis: { ...report.analysis, analysisLocation: report.analysisLocation } }, tree);
  const charts = printableFacilityCharts(model);
  const mapSnapshot = reportMapSnapshot(report);
  const scoreText = model.view.overall.scored ? `${number(model.confirmedScore)} /100` : '未计分';
  const uncertainty = model.view.overall.exact ? '已确认单值' : `区间评分 · 未知权重 ${number((report.score?.unknownWeight ?? 0) * 100)}%`;
  const details = model.view.groups.map((group) => `<section class="report-section facility-group"><h3>${escapeHtml(group.label)}设施核验明细 <small>${group.reachablePoiCount}处可达设施 · ${group.reachable}/${group.subtypes.length}小类确认可达</small></h3><table class="compact-table"><thead><tr><th>小类</th><th>状态</th><th>最近设施</th><th>步行时间</th><th>百度耗时</th><th>距离</th></tr></thead><tbody>${group.subtypes.map((subtype) => {
    const nearest = subtype.nearest;
    const minutes = decisionMinutes(nearest);
    return `<tr><td>${escapeHtml(subtype.label)}</td><td>${escapeHtml(subtype.statusText)}</td><td>${escapeHtml(nearest?.name ?? '—')}</td><td>${minutes == null ? '—' : `${number(minutes)}分钟`}</td><td>${Number.isFinite(nearest?.durationSeconds) ? `${number(nearest.durationSeconds / 60)}分钟` : '—'}</td><td>${Number.isFinite(nearest?.distanceMeters) ? `${Math.round(nearest.distanceMeters)}米` : '—'}</td></tr>`;
  }).join('')}</tbody></table></section>`).join('');
  const css = `@page{size:A4;margin:12mm 11mm}*{box-sizing:border-box}html{background:#eef5f9}body{margin:0 auto;max-width:1120px;padding:28px 28px 44px;color:#294d63;background:#f4f9fc;font:12px/1.58 'Microsoft YaHei','Noto Sans SC',Arial,sans-serif;print-color-adjust:exact;-webkit-print-color-adjust:exact}h1,h2,h3,p{margin-top:0}h1{font-size:28px;line-height:1.2;color:#153f60;margin:0 0 8px}h2{font-size:18px;color:#204f70;margin-bottom:10px}h3{font-size:15px;color:#205271;margin-bottom:10px}small{color:#7894a7;font-weight:400}.report-header{border-left:4px solid #10a9b0;padding:3px 0 4px 16px;margin-bottom:18px}.report-header .meta{color:#6f8999}.report-section{background:#fff;border:1px solid #dcebf3;border-radius:12px;padding:15px;margin:12px 0;break-inside:avoid-page;box-shadow:0 5px 16px rgba(41,93,122,.05)}.section-kicker{font-size:10px;font-weight:700;letter-spacing:.12em;color:#0a9eaa;margin-bottom:5px}.summary-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:12px}.score-panel{display:flex;gap:18px;align-items:center;min-height:180px;background:linear-gradient(120deg,#edfaff,#fff)}.score-ring{width:174px;flex:0 0 174px}.score-copy{min-width:0}.score-value{font-size:27px;font-weight:700;color:#1e9fb0}.score-grade{display:inline-block;color:var(--grade);background:color-mix(in srgb,var(--grade) 12%,white);border:1px solid color-mix(in srgb,var(--grade) 24%,white);border-radius:999px;padding:3px 10px;font-weight:700}.metric-strip{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-top:12px;padding-top:10px;border-top:1px solid #e0edf4}.metric-strip div{min-width:0}.metric-strip b{display:block;font-size:20px;color:#245d79}.metric-strip span{color:#7894a7;font-size:10px}.category-bars{display:grid;gap:10px;margin:7px 0 12px}.category-bar{display:grid;grid-template-columns:64px minmax(0,1fr) 48px;gap:10px;align-items:center}.category-bar-label{font-weight:600}.category-bar-track{height:10px;background:#e9f2f7;border-radius:99px;overflow:hidden}.category-bar-track i{display:block;height:100%;background:var(--category-color);border-radius:99px}.category-bar strong{text-align:right;color:#315d75}.chart-pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}.chart-card{min-width:0}.chart-card+.chart-card{border-left:1px solid #e1edf3;padding-left:12px}.chart-card svg{width:100%;height:auto;display:block}.chart-legend{font-size:10px;color:#7894a7;margin-bottom:3px}.dot{display:inline-block;width:10px;height:3px;margin:0 4px 2px 9px}.dot.expected{background:#4277e4}.dot.actual{background:#08ad98}.compact-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:10px}.compact-table th,.compact-table td{padding:7px 6px;border-bottom:1px solid #e5eef4;text-align:left;vertical-align:top;overflow-wrap:anywhere}.compact-table thead th{background:#edf7fb;color:#41657a;font-weight:700}.compact-table tbody tr:last-child td{border-bottom:0}.subtype-table th:nth-child(1){width:17%}.subtype-table th:nth-child(2){width:12%}.subtype-table th:nth-child(3){width:8%}.subtype-table th:nth-child(4){width:11%}.subtype-table th:nth-child(5){width:25%}.subtype-table th:nth-child(6),.subtype-table th:nth-child(7){width:13%}.facility-group{break-inside:auto}.facility-group h3{break-after:avoid}.specialty-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px}.specialty-card{background:#f4fafd;border:1px solid #e1edf3;border-radius:9px;padding:10px;break-inside:avoid}.specialty-card-head{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:10px}.specialty-card strong,.specialty-card span,.specialty-card small{display:block}.specialty-card span{color:#4b7187;margin:3px 0}.specialty-card small{font-size:10px}.status-chip{color:var(--status-color)!important;background:color-mix(in srgb,var(--status-color) 12%,white);border-radius:99px;padding:2px 7px;white-space:nowrap;font-size:10px}.map-figure{margin:0}.map-snapshot{display:block;width:100%;height:auto;border-radius:9px;border:1px solid #dbeaf2;background:#f4fafd}.map-caption,.note,.evidence-note{font-size:10px;color:#728da0}.source-table th{width:20%;background:#f5fafc}.notes{margin:10px 0 0;padding-left:18px;color:#647f91;font-size:10px}.no-print{border:1px solid #b7dce8;border-radius:8px;background:#f1fbfd;color:#117b8a;padding:8px 14px;cursor:pointer}.print-actions{display:flex;gap:8px;justify-content:flex-end}@media(max-width:760px){body{padding:16px}.summary-grid,.chart-pair{grid-template-columns:1fr}.chart-card+.chart-card{border-left:0;border-top:1px solid #e1edf3;padding:12px 0 0}.specialty-grid{grid-template-columns:1fr}.compact-table{font-size:9px}.score-panel{align-items:flex-start;flex-direction:column}.score-ring{width:150px;flex-basis:auto}}@media print{html{background:#fff}body{max-width:none;padding:0;background:#fff;font-size:10px}.no-print{display:none!important}.report-section{box-shadow:none;border-color:#d8e6ed;border-radius:8px;margin:7px 0;padding:10px}.report-header{margin-bottom:10px}.summary-grid,.chart-pair{gap:8px}.score-panel{min-height:0}.score-ring{width:130px;flex-basis:130px}.chart-card svg{max-height:210px}.map-snapshot{max-height:260mm;object-fit:contain}.compact-table th,.compact-table td{padding:5px 4px}.facility-group{break-inside:auto}.facility-group,.specialty-card,.compact-table tr{break-inside:avoid}.compact-table thead{display:table-header-group}h1{font-size:22px}h2{font-size:15px}h3{font-size:13px}.page-break-before{break-before:page}.print-actions{display:none}}`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'unsafe-inline'"><title>15分钟生活圈分析报告 · ${escapeHtml(summary.community)}</title><style>${css}</style></head><body>
<header class="report-header"><h1>15分钟生活圈分析报告</h1><div class="meta">${escapeHtml(summary.community)} · 分析完成于 ${escapeHtml(dateText(report.completedAt ?? report.createdAt))} · ${escapeHtml(report.analysisId)}</div></header>
<section class="report-section score-panel"><div class="score-ring">${scoreRing(model)}</div><div class="score-copy"><div class="section-kicker">01 / 综合结论</div><h2>综合匹配度</h2><div class="score-value">${escapeHtml(scoreText)}</div><p><span class="score-grade" style="--grade:${escapeHtml(summary.grade?.color ?? '#6d8ea5')}">${escapeHtml(summary.grade?.label ?? '暂无等级')}</span> <span class="note">${escapeHtml(uncertainty)}</span></p><p>${escapeHtml(model.view.overall.description || '基于当前优先级与已有步行证据的设施可达性评估。')}</p><div class="metric-strip"><div><b>${model.totalPoi}处</b><span>确认可达POI</span></div><div><b>${number(summary.coverage)}%</b><span>18小类覆盖</span></div><div><b>${number(summary.specialtyCompleteness)}%</b><span>重点服务完备</span></div></div></div></section>
<section class="report-section"><div class="section-kicker">02 / 设施结构</div><h2>六类设施分布与评分贡献</h2><div class="category-bars">${categoryBars(model)}</div>${categoryBarTable(model)}</section>
<section class="report-section chart-pair"><div class="chart-card" data-chart="facility_share_sunburst"><h2>18小类设施构成旭日图</h2>${charts.sunburst}<p class="note">内环为六类设施，外环为18个细分小类；颜色只表示分类，不代表评分高低。</p></div><div class="chart-card" data-chart="dual_radar"><h2>六类设施贡献雷达图</h2><div class="chart-legend"><span class="dot expected"></span>期望权重 <span class="dot actual"></span>实际贡献占比</div>${charts.radar}<p class="note">雷达图的全部轴值和贡献区间见下表，避免依赖悬浮信息。</p></div></section>
<section class="report-section"><h2>小类可达情况明细 · 18类旭日图数据</h2>${subtypeDataTable(model)}</section>
<section class="report-section"><h2>雷达图数据明细</h2>${radarDataTable(model)}</section>
<section class="report-section page-break-before"><div class="section-kicker">03 / 重点服务</div><h2>重点服务与一公里专项</h2>${specialtySection(report, tree, model)}<p class="note">专项判定使用真实步行距离 ≤1000米，独立于15分钟可达评分；“未查到”仅针对本次声明检索窗口。</p></section>
${blindspotSection(report)}
<section class="report-section page-break-before"><div class="section-kicker">05 / 地图空间分布</div><h2>等时圈、POI、盲区与重点路线</h2>${mapSnapshot ? `<figure class="map-figure"><img class="map-snapshot" alt="等时圈、POI、盲区与重点路线静态地图快照" src="${mapSnapshot}"><figcaption class="map-caption">静态快照直接嵌入本报告，包含${model.totalPoi}处确认可达POI、已核验路线、15分钟范围、重点服务路线及可用的区域盲区网格。未展示在线底图瓦片，不影响打印完整性。</figcaption></figure>` : '<p class="note">当前分析快照未包含可绘制的空间几何，地图图层不可用。</p>'}</section>
<h2 class="page-break-before">设施核验明细</h2><p class="evidence-note">显示步行时间沿用分析快照中的决策口径；80m/min估算与百度原始耗时分别列出。未知、未发现和路线缺失不被转化为零分。</p>${details}
${provenanceSection(report)}
<div class="print-actions no-print"><button onclick="window.print()">打印 / 保存PDF</button></div></body></html>`;
}
