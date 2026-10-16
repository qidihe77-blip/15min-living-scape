import{reachableCategoryCount}from'./facility-membership.js';
import{decisionSeconds,walkingTimeLabel}from'./walking-model.js';
import{facilityViewRows}from'./facility-view.js';
import{reachableFacilityRows,reachablePoiCount}from'./reachable-presentation.js';
import{circleFacilityRows,walkingRangePolygons,subtypeDisplayLabel}from'./circle-presentation.js';
// Presentation only: read existing scores and status evidence without recomputing them.
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const number = (value) => finite(value) ? Number(value.toFixed(1)).toString() : '—';
export const SUBTYPE_STATUS_TEXT = Object.freeze({ reachable:'可达', no_reachable_in_declared_search:'未发现', unknown:'本次未查到' });
export function reportPresentation(job, tree, {scale=100,simple=false}={}) {
  const points=value=>number(value/(scale===5?20:1));
  const statusText=status=>simple?({reachable:'可达',no_reachable_in_declared_search:'未发现可达设施',unknown:'暂无步行数据'}[status]):SUBTYPE_STATUS_TEXT[status];
  const score = job?.score, analysis = job?.analysis;
  const facilityRows=facilityViewRows(analysis,tree,'all',job?.display),reachableRows=reachableFacilityRows(facilityRows,analysis?.origin),circleRows=circleFacilityRows(facilityRows,job),circleAvailable=walkingRangePolygons(job).length>0;
  const groups = (tree?.categories ?? []).map((definition) => {
    const evidence = analysis?.categories?.find((row) => row.categoryId === definition.id);
    const scored = score?.categories?.find((row) => row.categoryId === definition.id);
    const subtypes = definition.subtypes.map((sub) => {
      const row = evidence?.subtypeResults?.find((item) => item.subtypeId === sub.id);
      const status = Object.hasOwn(SUBTYPE_STATUS_TEXT,row?.accessStatus) ? row.accessStatus : 'unknown';
      return { ...sub, label:subtypeDisplayLabel(sub), evidence:row, status, simple, statusText:statusText(status),
        nearest:row?.nearestReachable ?? null, nearestComplete:row?.nearestComplete === true };
    });
    const low = finite(scored?.G_low) ? scored.G_low : null, high = finite(scored?.G_high) ? scored.G_high : null;
    return { ...definition, evidence, score:scored, subtypes, low, high, simple,scale,
      reachablePoiCount:reachableCategoryCount(reachableRows,definition),
      circlePoiCount:reachableCategoryCount(reachableRows,definition),
      scoreText:low==null?'—':low===high?points(low):points(low)+'–'+points(high),
      reachable:subtypes.filter((sub)=>sub.status==='reachable').length,
      unknown:subtypes.filter((sub)=>sub.status==='unknown').length };
  });
  const subtypes=groups.flatMap((group)=>group.subtypes);
  const counts={reachable:subtypes.filter((sub)=>sub.status==='reachable').length,
    absent:subtypes.filter((sub)=>sub.status==='no_reachable_in_declared_search').length,
    unknown:subtypes.filter((sub)=>sub.status==='unknown').length,total:subtypes.length};
  const scored=score?.scoreStatus==='scored' && finite(score.S_low) && finite(score.S_high);
  const exact=scored && score.isExact === true;
  const overallText=!scored?'未计分':exact?points(score.S_low):points(score.S_low)+'–'+points(score.S_high);
  const verdict=!scored?'仅设施评估':!exact?'部分信息暂无':score.S_low>=85?'可达性较好':score.S_low>=70?'较好':score.S_low>=50?'有待完善':'需关注';
  const description=!scored?'所有大类均不计分，设施与路线证据继续保留。':!exact
    ? '当前偏好评分为区间，未知结果可能改变评价。'
    : '基于当前优先级与已有步行数据的小类的可达存在性评分。';
  return { groups,counts,overall:{scored,exact,text:overallText,primaryText:scored?points(score.S_low):'—',verdict:simple?(!scored?'仅设施评估':!exact?'综合评分':score.S_low>=85?'配套较好':score.S_low>=70?'较好':score.S_low>=50?'有待完善':'需关注'):verdict,description:simple?'':description,
    low:scored?score.S_low:0,high:scored?score.S_high:0,
    uncertainty:simple?'':scored&&!exact?'未知权重 '+number(score.unknownWeight*100)+'%':'不代表设施容量、人口覆盖或规范合规'},
    // Display only the dedicated backend distance diagnostic; 15-minute status is independent.
    specialties:(tree?.specialtySubtypeIds ?? ['market','pharmacy','primary_school']).map((id)=>{
      const group=groups.find((item)=>item.subtypes.some((sub)=>sub.id===id));
      const sub=group?.subtypes.find((item)=>item.id===id);
      const evidence=job?.serviceGaps?.specialties?.find((row)=>row.subtypeId===id)?.walking_1km_gap;
      const status=['present','absent_in_declared_search'].includes(evidence?.status)?evidence.status:'unknown';
      return {subtypeId:id,categoryId:group?.id,label:sub?.label ?? id,status,
        statusText:status==='present'?'1公里内有服务':status==='absent_in_declared_search'?'本次缺项':simple?'暂无数据':'本次未查到',
        description:evidence?.nearestWithinOneKilometer?evidence.nearestWithinOneKilometer.name+' · '+number(evidence.nearestWithinOneKilometer.distanceMeters)+'米'
          :simple?(status==='absent_in_declared_search'?'本次范围内未发现目标设施':'暂无专项结果'):status==='absent_in_declared_search'?'本次范围内未查到服务':evidence?'检索或路线证据不完整':'尚未返回1公里专项证据'};
    }),
    observedAt:job?.finishedAt ?? job?.startedAt ?? analysis?.observedAt ?? null };
}
const escape = (value) => String(value).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function radarSvg(groups) {
  const center=[110,110],radius=74;
  const point=(index,fraction)=>{const angle=-Math.PI/2+index*Math.PI/3;return [center[0]+Math.cos(angle)*radius*fraction,center[1]+Math.sin(angle)*radius*fraction];};
  const polygon=(fraction)=>groups.map((_g,index)=>point(index,fraction).join(',')).join(' ');
  const values=(key)=>groups.map((g,i)=>point(i,finite(g[key])?g[key]/100:0).join(',')).join(' ');
  const description=groups.map((g)=>g.label+' '+g.scoreText).join('，');
  return '<svg class="radar-svg" viewBox="0 0 220 220" role="img" aria-label="六类设施可达性评分，'+escape(description)+'"><title>'+escape(description)+'</title>'
    +[.25,.5,.75,1].map((r)=>'<polygon class="radar-grid" points="'+polygon(r)+'"/>').join('')
    +groups.map((_g,i)=>'<path class="radar-axis" d="M110 110 L'+point(i,1).join(' ')+'"/>').join('')
    +'<polygon class="radar-possible" points="'+values('high')+'"/><polygon class="radar-known" points="'+values('low')+'"/>'
    +groups.map((g,i)=>{const p=point(i,1.32),dot=point(i,finite(g.low)?g.low/100:0),hit=point(i,1);
      const tip=chartTip(g.label+' · 六类雷达图',[['评分',g.scoreText+(g.scale===5?' /5':'')],['可达小类',g.reachable+'/'+g.subtypes.length],['暂无数据',g.unknown+'小类']]);
      return '<g class="radar-dimension" tabindex="0" role="img" aria-label="'+escape(g.label+'评分'+g.scoreText)+'" data-chart-tip="'+escape(JSON.stringify(tip))+'">'
        +'<circle class="radar-hit" cx="'+hit[0]+'" cy="'+hit[1]+'" r="10"/><circle class="radar-axis-dot" cx="'+hit[0]+'" cy="'+hit[1]+'" r="3.2" style="fill:'+g.color+'"/><circle class="radar-dot" cx="'+dot[0]+'" cy="'+dot[1]+'" r="4" style="fill:'+g.color+'"/>'
        +'<text x="'+p[0]+'" y="'+p[1]+'" dominant-baseline="middle" text-anchor="middle">'+escape(g.label)+'</text></g>';}).join('')+'</svg>';
}
export function chartTip(title,rows=[],note='') { return {title,rows,note}; }
export function subtypeChartColumns(groups) {
  return groups.map(group=>({id:group.id,label:group.label,color:group.color,columns:group.subtypes.map(sub=>{
    const nearest=sub.nearest,seconds=decisionSeconds(nearest);
    const minutes=sub.status==='reachable'&&finite(seconds)&&seconds>=0&&seconds<=900?seconds/60:null;
    const distance=finite(nearest?.distanceMeters)&&nearest.distanceMeters>=0?Math.round(nearest.distanceMeters)+'m':'—';
    const note=sub.simple?(sub.status==='no_reachable_in_declared_search'?'本次检索范围内未发现可达设施':minutes===null?'暂无步行时间':nearest?.walkingModelId==='walking80-v1'?'按真实路线距离和80m/min估算；百度返回时间单独保留':'设施的百度返回步行耗时'):sub.status==='no_reachable_in_declared_search'?'本次检索范围内未发现可达设施':sub.status==='unknown'?'步行信息暂无':minutes===null?'已标为可达，当前快照未返回有效耗时':'最近结果'+(sub.nearestComplete?'已获取':'信息暂缺');
    return {id:sub.id,label:sub.label,status:sub.status,minutes,heightPercent:minutes===null?null:minutes/15*100,
      tooltip:chartTip(sub.label,[['所属大类',group.label],['状态',sub.statusText],['最近设施',sub.status==='reachable'?nearest?.name||'未返回':'—'],
        ['步行时间',minutes===null?'—':number(minutes)+'分钟（'+walkingTimeLabel(nearest)+'）'],...(nearest?.walkingModelId==='walking80-v1'?[['百度返回',number(nearest.durationSeconds/60)+'分钟']]:[]),['距离',sub.status==='reachable'?distance:'—']],note)};
  })}));
}
export function subtypeBarsHtml(groups) {
  const chart=subtypeChartColumns(groups);
  return '<div class="subtype-chart" role="group" aria-label="小类步行耗时与状态；纵轴0到15分钟，占位柱不表示耗时">'
    +'<div class="subtype-y-axis" aria-hidden="true"><span>15</span><span>10</span><span>5</span><span>0</span></div>'
    +'<div class="subtype-plot"><div class="subtype-grid" aria-hidden="true"><i></i><i></i><i></i><i></i></div><div class="subtype-columns">'
    +chart.map(group=>'<div class="subtype-chart-group" data-chart-group="'+group.id+'" style="flex:'+group.columns.length+';--subtype-count:'+group.columns.length+';--category-color:'+group.color+'">'
      +group.columns.map(sub=>'<div class="subtype-column"><button type="button" class="subtype-bar-button" data-subtype-bar="'+sub.id+'" data-status="'+sub.status+'" data-minutes="'+(sub.minutes??'')+'" data-chart-tip="'+escape(JSON.stringify(sub.tooltip))+'" aria-label="'+escape(sub.label+'，'+sub.tooltip.rows[1][1]+(sub.minutes===null?'，耗时未知或不适用':'，步行'+number(sub.minutes)+'分钟'))+'">'
        +'<span class="subtype-bar-fill'+(sub.minutes===null?' is-placeholder':'')+'" style="'+(sub.minutes===null?'':'--bar-height:'+sub.heightPercent+'%;')+'"></span></button><span class="subtype-axis-label" aria-hidden="true">'+escape(sub.label)+'</span></div>').join('')
      +'</div>').join('')+'</div></div></div>'
    +'<div class="subtype-chart-legend">'+chart.map(g=>'<span class="category-legend-item"><i style="background:'+g.color+'"></i>'+escape(g.label)+'</span>').join('')+'<span><i class="status-dot no_reachable_in_declared_search"></i>未发现</span><span><i class="status-dot unknown"></i>'+(groups[0]?.simple?'暂无数据':'本次未查到')+'</span></div>';
}
export function reportSummary(job, tree) {
  const view=reportPresentation(job,tree);
  return ['15分钟步行生活圈评估报告','分析地点：'+(job.analysis?.analysisLocation?.name ?? job.analysis?.origin?.name ?? '地图选点'),
    '步行起点：'+(job.analysis?.origin?.name ?? '地图选点'),
    '总体评分：'+view.overall.text+'（'+view.overall.verdict+'）',
    ...view.groups.map((g)=>g.label+'：'+g.reachable+'/'+g.subtypes.length+'小类可达，评分'+g.scoreText),
    '本次未查到：'+view.counts.unknown+'小类。',
    ...view.specialties.map((s)=>'1公里专项 '+s.label+'：'+s.statusText),
    '分析时间：'+(view.observedAt??'未返回'),'此摘要不代表容量或规范合规结论。'].join('\n');
}
