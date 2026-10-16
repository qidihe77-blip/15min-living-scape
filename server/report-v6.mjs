import{decisionSeconds}from'../web/walking-model.js';
import{facilityViewRows}from'../web/facility-view.js';
import{reachableFacilityRows,walkingRangeNotice}from'../web/reachable-presentation.js';
import{facilityCategoryTree}from'./facility-categories.mjs';
import{reportPresentation,radarSvg,subtypeBarsHtml}from'../web/report-view.js';
import{renderV8PrintableReport}from'./report-current.mjs';
const escape=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const value=v=>Number.isFinite(v)?String(Number(v.toFixed(1))):'—';
export function renderLightFacilityReport(report){
 if(report.categoryMappingVersion==='facility-categories-v8')return renderV8PrintableReport(report);
 const tree=facilityCategoryTree(report.categoryMappingVersion),view=reportPresentation(report,tree,{scale:5,simple:true}),display=report.display;
 const fixed80=report.walkingModelId==='walking80-v1';
 const timeCells=p=>'<td>'+value(decisionSeconds(p.routeEvidence)===null?null:decisionSeconds(p.routeEvidence)/60)+'分钟</td>'+(fixed80?'<td>'+value(p.durationSeconds/60)+'分钟</td>':'');
 const reachable=reachableFacilityRows(facilityViewRows(report.analysis,tree,'all',display),report.origin);
 const groups=view.groups.map(group=>{
  const rows=group.subtypes.flatMap(sub=>{
   const found=reachable.filter(p=>(p.subtypeIds??[]).includes(sub.id));
   return found.length?found.map(p=>'<tr data-subtype="'+sub.id+'"><td>'+escape(sub.label)+'</td><td>'+escape(p.statusText)+'</td><td>'+escape(p.name)+'</td>'+timeCells(p)+'<td>'+value(p.distanceMeters)+'米</td></tr>')
    :['<tr data-subtype="'+sub.id+'"><td>'+escape(sub.label)+'</td><td>'+escape(sub.statusText)+'</td><td>—</td><td>—</td>'+(fixed80?'<td>—</td>':'')+'<td>—</td></tr>'];
  }).join('');
  return '<section data-report-category="'+group.id+'"><h2>'+escape(group.label)+' '+group.reachablePoiCount+'处</h2><table><thead><tr><th>小类</th><th>状态</th><th>设施名称</th><th>'+(fixed80?'80m/min估算':'步行时间')+'</th>'+(fixed80?'<th>百度返回</th>':'')+'<th>距离</th></tr></thead><tbody>'+rows+'</tbody></table></section>';
 }).join('');
 return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>生活圈体检报告</title><style>body{font:14px/1.6 system-ui;color:#17364c;background:#f2f7fb;max-width:1100px;margin:24px auto;padding:0 16px}h1{font-size:24px}h2{font-size:22px;margin:0 0 12px}section,.head-card{background:white;border:1px solid #dfebf2;border-radius:12px;padding:18px;margin-bottom:18px}.charts{display:grid;grid-template-columns:1fr 1fr;gap:16px}.score{font-size:34px;color:#00adbb}.radar-svg{width:100%;height:220px}.radar-grid,.radar-axis{stroke:#dce9f3;fill:none}.radar-known{stroke:#20a8ed;fill:#20a8ed22}.radar-possible{stroke:#72b9df;fill:none;stroke-dasharray:3 3}.radar-hit{fill:transparent}.radar-svg text{font-size:16px;fill:#36556b}table{width:100%;table-layout:fixed;border-collapse:collapse}td,th{text-align:left;padding:8px;border-bottom:1px solid #e5edf4;overflow-wrap:anywhere}.gaps{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.gaps article{background:#f4f9fc;border-radius:8px;padding:12px}.subtype-plot{display:none}@media print{button{display:none}section,tr{break-inside:avoid}body{background:white}}</style></head><body><h1>15分钟步行生活圈体检报告</h1><p>'+escape(report.analysisLocation?.name??report.origin.name)+' · '+escape(report.completedAt)+'</p><div class="charts"><section><h2>总体评分</h2><strong class="score">'+escape(view.overall.text)+' /5</strong><p>'+escape(view.overall.verdict)+'</p></section><section><h2>六类设施雷达图</h2>'+radarSvg(view.groups)+'</section></div>'+groups+'<section><h2>'+view.counts.total+'小类可达情况</h2><p>固定模型：80 m/min；百度返回耗时独立保留。</p><table><thead><tr><th>小类</th><th>状态</th><th>步行分钟</th></tr></thead><tbody>'+view.groups.flatMap(g=>g.subtypes.map(s=>'<tr><td>'+escape(s.label)+'</td><td>'+escape(s.statusText)+'</td><td>'+value(decisionSeconds(s.nearest)===null?null:decisionSeconds(s.nearest)/60)+'</td></tr>')).join('')+'</tbody></table></section><section><h2>重点服务盲区（1公里专项）</h2><div class="gaps">'+view.specialties.map(s=>'<article><strong>'+escape(s.label)+'</strong><p>'+escape(s.statusText)+'</p><small>'+escape(s.description)+'</small></article>').join('')+'</div></section><p>'+escape(walkingRangeNotice(report))+'</p><button onclick="window.print()">打印／保存PDF</button></body></html>';
}
