import { FACILITY_GROUPS, FACILITY_V3_MAPPING_VERSION, facilityCategoryTree } from './facility-categories.mjs';
import { assessServiceGaps } from './service-gaps.mjs';
import { reachabilityEvidence } from './reachability-evidence.mjs';
import {buildFacilityDisplay,fivePointScore} from './facility-display.mjs';
import {renderLightFacilityReport} from './report-v6.mjs';

export const SIX_GROUP_REPORT_VERSION = 'facility-report-v3';
export function buildSixGroupReport(job) {
  const analysis=job?.analysis;
  const tree=facilityCategoryTree(analysis?.categoryMappingVersion);
  if(![3,4,5,6,7,8].includes(analysis?.version) || !job.score
    || !['complete','partial'].includes(job.status) || analysis.categories?.length!==6
    || tree.categories.some((g)=>analysis.categories.filter((r)=>r.categoryId===g.id).length!==1
      || analysis.categories.find((r)=>r.categoryId===g.id)?.subtypeResults?.length!==g.subtypes.length
      || g.subtypes.some((s)=>analysis.categories.find((r)=>r.categoryId===g.id)?.subtypeResults
        ?.filter((r)=>r.subtypeId===s.id).length!==1)))throw new TypeError('Complete six-group/25-subtype snapshot is required.');
  const score=job.score, geometry=reachabilityEvidence(job);
  return structuredClone({reportVersion:'facility-report-v'+analysis.version,reportStatus:'available',
    analysisId:job.analysisId,createdAt:job.createdAt,completedAt:job.finishedAt ?? null,status:job.status,
    scope:'analysis_location_with_walking_origin',analysisLocation:analysis.analysisLocation ?? analysis.origin,origin:analysis.origin,coordinateSystem:analysis.coordinateSystem,mode:'walking',minutes:15,
    walkingModel:analysis.walkingModel,walkingModelId:analysis.walkingModelId,thresholdSeconds:900,categoryMappingVersion:analysis.categoryMappingVersion,
    analysisVersion:analysis.analysisVersion,nearestAlgorithmVersion:analysis.nearestAlgorithmVersion,
    scoreFormulaVersion:score.formulaVersion,evidenceSnapshotId:score.evidenceFingerprint,
    searchWindow:{...analysis.searchWindow,center:analysis.searchWindow?.center??(analysis.analysisLocation ?? analysis.origin).location,radiusMeters:analysis.searchRadiusMeters,region:analysis.region,maxRouteCandidatesPerSubtype:analysis.maxRouteCandidatesPerSubtype},
    counts:{groupCount:6,subtypeCount:tree.categories.flatMap(g=>g.subtypes).length,uniqueUidCount:analysis.uniqueUidCount,
      anonymousCandidateCount:analysis.anonymousCandidateCount,
      childReachableMemberships:analysis.categories.reduce((sum,g)=>sum+g.subtypeResults.reduce((n,s)=>n+s.reachableCountLowerBound,0),0),
      note:'UID并集与小类成员计数不同；同一地点可服务多个小类。'},
    categories:analysis.categories,analysis,score,auxiliaryMetrics:analysis.auxiliaryMetrics,scoreDisplay:analysis.version>=6?fivePointScore(score):undefined,display:analysis.version>=6?buildFacilityDisplay(job):undefined,rangeDiagnostics:analysis.version>=6?job.rangeDiagnostics:undefined,geometry,geojson:geometry.geojson,
    serviceGaps:job.serviceGaps ?? assessServiceGaps(analysis),regionalGaps:job.regionalGaps??null,networkEvidence:job.networkEvidence ?? null,rangeSamples:job.rangeSamples,
    requestStats:job.requestStats,warnings:job.warnings ?? [],context:job.context ?? null,
    limitations:['起点来自所选POI定位或地图选点，不自动视为社区几何中心；不输出整社区人口或面积覆盖。',
      '路线、入口、检索窗口及观测时刻限定结果；缺页、分类不明、预算截断和失败仍为未知。',
      '评分为当前优先级下小类可达存在性的上下界，不代表容量、设施充足或政策合规。',
      job.rangeDiagnostics?.strategy==='walking_batch'?'80m/min时间由真实步行距离估算，百度原始耗时独立保留；36方向矩阵二分与受约束外推为近似边界，未测内部未知。区域网格覆盖是估算，独立于总体评分及真实1km专项。':analysis.version===7?'80m/min时间由真实步行距离估算，百度原始耗时单独保留；32方向边界点沿真实路径按距离份额估计，未经逐点独立核验，未测内部未知，不代表完整路网。':analysis.walkingModelId==='walking80-v1'?'80m/min时间是由真实步行距离换算的估算值；百度原始耗时单独保留。采样边界仅连接实測方向点，未测内部未知，不代表完整路网等时圈。':'采样热力只在已测点代理内着色，不补色未知区；有限路径不是连续精确等时圈。',
      '一公里专项使用真实步行距离≤1000米，独立于≤900秒判断；直线距离仅作参考。',
      '不存在仅指本次声明检索窗口和已验证候选；不声称全市不存在或已核验所有实际入口。']});
}
const escape=(v)=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=(v)=>Number.isFinite(v)?String(Number(v.toFixed(1))):'—';
const interval=(a,b)=>a==null?'未计分':a===b?number(a):number(a)+'–'+number(b);
const statuses={reachable:'可达',no_reachable_in_declared_search:'本次未发现',unknown:'待核验',
  present:'1公里内有服务',absent_in_declared_search:'本次1公里专项缺项'};
export function renderSixGroupReportHtml(report) {
  if(['facility-report-v6','facility-report-v7','facility-report-v8'].includes(report?.reportVersion))return renderLightFacilityReport(report);
  if(![SIX_GROUP_REPORT_VERSION,'facility-report-v4','facility-report-v5','facility-report-v6'].includes(report?.reportVersion))throw new TypeError('Six-group report required.');
  const score=report.score;
  const groups=report.categories.map(group=>{
    const scored=score.categories.find(row=>row.categoryId===group.categoryId);
    const rows=group.subtypeResults.map(sub=>{
      const nearest=sub.nearestReachable;
      return '<tr data-subtype="'+escape(sub.subtypeId)+'"><td>'+escape(sub.label)+'</td><td>'+escape(statuses[sub.accessStatus])
        +'</td><td>'+escape(nearest?.name)+'</td><td>'+number(nearest?.durationSeconds)+'秒</td><td>'+number(nearest?.distanceMeters)
        +'米</td><td>'+escape(sub.nearestComplete?'声明窗口内完整':'部分／未知')+'</td><td>'+escape(sub.unknownReasons.join('、')||'无')
        +'<br>'+escape(sub.evidenceIds.join('、')||'无路线证据')+'</td></tr>';
    }).join('');
    return '<section><h2>'+escape(group.label)+' · '+group.reachableSubtypeCount+'/'+group.totalSubtypeCount+'小类可达</h2>'
      +'<div class="bar-row"><div class="bar"><i style="width:'+number(scored?.G_low??0)+'%"></i></div><strong>'+interval(scored?.G_low,scored?.G_high)+'</strong></div>'
      +'<p>权重 '+escape(score.priorities[group.categoryId])+' · 归一化 '+number((score.normalizedWeights[group.categoryId]??0)*100)
      +'% · 评分贡献 '+interval(scored?.contributionLow,scored?.contributionHigh)+' · UID并集 '+group.uniqueUidCount+' · 待核验 '+group.unknownSubtypeCount+'小类</p>'
      +'<table><thead><tr><th>小类</th><th>状态</th><th>最近已核验可达设施</th><th>步行时间</th><th>距离</th><th>完整性</th><th>未知原因／证据</th></tr></thead><tbody>'+rows+'</tbody></table></section>';
  }).join('');
  const gaps=report.serviceGaps.specialties.map(row=>'<article><h3>'+escape(row.label)+'</h3><strong>'+escape(statuses[row.walking_1km_gap.status]??'待核验')+'</strong>'
    +'<p>最近已核验路线：'+escape(row.walking_1km_gap.nearestVerified?.name)+' · '+number(row.walking_1km_gap.nearestVerified?.distanceMeters)+'米</p>'
    +'<p>几何参考：'+escape(statuses[row.geometric_1km_gap.status]??'待核验')+'（不作路网盲区结论）</p><small>'+escape(row.definitionNote??'')
    +escape(row.walking_1km_gap.unknownReasons.join('、'))+'</small></article>').join('');
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>生活圈体检报告 · '+escape(report.analysisId)
    +'</title><style>body{font:14px/1.65 system-ui;color:#183047;max-width:1060px;margin:24px auto;padding:0 20px}h1{font-size:26px}h2{font-size:18px}small{color:#61778a}section{margin:20px 0}table{width:100%;border-collapse:collapse;font-size:12px}td,th{padding:8px 5px;border-bottom:1px solid #d7e2e8;text-align:left;overflow-wrap:anywhere;vertical-align:top}.gaps{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.gaps article,.score{background:#f3f8fb;padding:14px;border-radius:8px}.score strong{font-size:32px}.bar-row{display:flex;gap:12px;align-items:center}.bar{height:10px;background:#e2edf4;flex:1}.bar i{display:block;background:#159db8;height:100%}@media(max-width:600px){body{padding:10px}.gaps{grid-template-columns:1fr}table{font-size:10px}}@media print{body{max-width:none;margin:0}.no-print{display:none}tr,article{break-inside:avoid}}</style></head><body><h1>15分钟步行生活圈体检报告</h1><small>分析ID：'
    +escape(report.analysisId)+' · 完成时间：'+escape(report.completedAt)+'</small><p>起点：'+escape(report.origin.name||report.origin.id)+' · 来源：'+escape(report.origin.source)
    +' · BD-09LL '+escape(report.origin.location.lng)+', '+escape(report.origin.location.lat)+'</p><h2>总体评分</h2><div class="score"><strong>'+interval(score.S_low,score.S_high)
    +'</strong><p>固定六大类／'+report.counts.subtypeCount+'小类分母 · 未知权重 '+number(score.unknownWeight*100)+'% · '+escape(score.formulaVersion)+'</p></div>'
    +'<p>候选UID并集：'+report.counts.uniqueUidCount+'；匿名候选：'+report.counts.anonymousCandidateCount+'；可达小类成员计数：'+report.counts.childReachableMemberships+'。'+escape(report.counts.note)+'</p>'
    +groups+'<h2>重点服务盲区（1公里专项）</h2><div class="gaps">'+gaps+'</div><p>至少缺一项：'+escape(report.serviceGaps.walking.anyMissing)+'；三项均缺：'+escape(report.serviceGaps.walking.allThreeMissing)+'（null表示未知）。专项范围仅为所选起点。</p>'
    +'<h2>范围、预算与来源</h2><p>'+escape(report.geometry.rangeSource)+' · '+escape(report.geometry.rangeStatus)+'；真实路径 '+report.geometry.networkRouteCount+' 条；误差上界 '+escape(report.geometry.errorBoundStatus)+'</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'
    +escape(JSON.stringify({sampleMetrics:report.geometry.sampleMetrics,requestStats:report.requestStats},null,2))+'</pre><p>证据指纹：'+escape(report.evidenceSnapshotId)+'<br>分类版本：'+escape(report.categoryMappingVersion)+'</p><ul>'
    +[...report.limitations,...report.geometry.warnings,...report.warnings].map(row=>'<li>'+escape(row)+'</li>').join('')+'</ul><button class="no-print" onclick="window.print()">打印／保存PDF</button></body></html>';
}
