import {TYPE,auxiliaryText,installReportTypography} from './report-typography.js';
import {loadEcharts, lightReportModel, contributionRadarOption} from './report-charts-light.js';
export {loadEcharts};
import {refinedRadarOption, radarAxisGraphics, radarAxisTooltip, radarTooltipPosition} from './radar-a38.js?v=a43-20261013';
import {LIGHT_CHART_THEME, LIGHT_TOOLTIP} from './report-theme.js';
import {ringScoreOption, scoreSummary} from './report-ring.js?v=a35-20261013';
import {facilitySunburstOption, sunburstNameGraphics, sunburstCenterGraphics, sunburstDisplayLayout, fmt} from './report-sunburst-a37.js?v=a41-20261013';

export function createReportCharts(E, {gaugeNode, mainNode, radarNode, captionNode, legendNode, onCategory, onSubtype, onReset}) {
  installReportTypography();E.registerTheme('lifeCircleLight', {...LIGHT_CHART_THEME,textStyle:{fontFamily:TYPE.family,fontSize:TYPE.body}});
  const main = E.init(mainNode, 'lifeCircleLight', {renderer: 'svg'}),
    gauge = E.init(gaugeNode, 'lifeCircleLight', {renderer: 'svg'}),
    radar = E.init(radarNode, 'lifeCircleLight', {renderer: 'svg'}),
    reduced = matchMedia('(prefers-reduced-motion:reduce)');
  const head=radarNode.closest('.report-section').querySelector('.report-section-head'),raisedLegend=document.createElement('div');raisedLegend.className='radar-heading-legend';raisedLegend.setAttribute('aria-label','得分贡献图例');
  raisedLegend.innerHTML=['期望权重','实际贡献占比'].map((name,i)=>'<button type="button" data-radar-series="'+name+'" aria-pressed="true"><i class="'+(i?'actual':'expected')+'"></i><span>'+name+'</span></button>').join('');head.append(raisedLegend);
  raisedLegend.addEventListener('click',e=>{const b=e.target.closest('[data-radar-series]');if(!b)return;radar.dispatchAction({type:'legendToggleSelect',name:b.dataset.radarSeries});b.setAttribute('aria-pressed',String(radar.getOption().legend[0].selected?.[b.dataset.radarSeries]!==false));});
  let m, alive = true, axis = null, iconAreas = [], hoveredIcon = null, labelsSignature = '', enlargedSectors = [];

  function sunburstLabels() {
    if (!m || !alive) return;
    if (!m.totalPoi) return;
    const graphics = [...sunburstCenterGraphics(m.totalPoi,sunburstDisplayLayout(main.getWidth(),main.getHeight())),...sunburstNameGraphics(main)], signature = JSON.stringify(graphics);
    if (labelsSignature === signature) return;
    labelsSignature = signature;
    main.setOption({graphic: graphics}, {replaceMerge: ['graphic'], silent: true});
  }
  function restoreSectors() {
    enlargedSectors.forEach(el => el.animateTo?.({scaleX: 1, scaleY: 1}, {duration: 160}));
    enlargedSectors = [];
  }
  main.on('mouseover', p => {
    if (p.seriesType !== 'sunburst' || !p.data?.categoryId) return;
    restoreSectors();
    const data = main.getModel().getSeriesByIndex(0).getData();
    data.each(i => {
      const d = data.getRawDataItem(i), l = data.getItemLayout(i), el = data.getItemGraphicEl(i);
      const related = p.data.subtypeId ? d?.id === p.data.id : d?.categoryId === p.data.categoryId;
      if (!related || !el || !l) return;
      el.attr({originX: l.cx, originY: l.cy});
      el.animateTo({scaleX: reduced.matches ? 1 : 1.025, scaleY: reduced.matches ? 1 : 1.025}, {duration: 180});
      enlargedSectors.push(el);
    });
    window.lifeCircleSunburstHover = {categoryId: p.data.categoryId, subtypeId: p.data.subtypeId ?? null, enlarged: enlargedSectors.length};
  });
  main.on('mouseout', restoreSectors);
  main.on('click', p => {
    const d = p.data;
    if (d?.subtypeId) onSubtype(d.categoryId, d.subtypeId, m.allocations.filter(a => a.subtypeId === d.subtypeId).map(a => a.identityKey));
    else if (d?.categoryId) onCategory(d.categoryId, m.allocations.filter(a => a.categoryId === d.categoryId).map(a => a.identityKey));
  });

  function hoverIcon(id) {
    if (id === hoveredIcon) return;
    for (const key of [hoveredIcon, id]) {
      const a = iconAreas.find(a => a.id === key), el = a && radar.getZr().storage.getDisplayList().find(e => e.type === 'image' && e.style.image === a.src);
      if (el) el.animateTo({scaleX: key === id && !reduced.matches ? 1.12 : 1,
        scaleY: key === id && !reduced.matches ? 1.12 : 1,
        style: {shadowBlur: key === id ? 9 : 0, shadowColor: '#409FEA66'}}, {duration: 180});
    }
    hoveredIcon = id;
  }
  function radarIcons() {
    const c = radar.getModel().getSeriesByIndex(0)?.coordinateSystem;
    if (!c) return;
    const graphics = radarAxisGraphics(m, c, contributionRadarOption(m).axisMax, radar.getWidth());
    if (m.confirmedScore === 0) graphics.push({type: 'text', left: 'center', top: '49%', silent: true,
      style: {...auxiliaryText,text: '暂无贡献数据', fill: '#7B96A8'}});
    iconAreas = graphics.filter(g => g.type==='image'&&g.id.startsWith('radar-icon-')).map(g => ({id: g.id, src: g.style.image, x: g.style.x, y: g.style.y, w: g.style.width, h: g.style.height}));
    hoveredIcon = null;
    radar.setOption({graphic: graphics}, {replaceMerge: ['graphic'], silent: true});
  }
  const pointerMove = e => {
    const b = radarNode.getBoundingClientRect(), x = (e.clientX - b.left) * radar.getWidth() / b.width,
      y = (e.clientY - b.top) * radar.getHeight() / b.height,
      a = iconAreas.find(a => x >= a.x - 3 && x <= a.x + a.w + 3 && y >= a.y - 3 && y <= a.y + a.h + 3);
    hoverIcon(a?.id ?? null);
  }, pointerLeave = () => hoverIcon(null);
  radarNode.addEventListener('pointermove', pointerMove, true);
  radarNode.addEventListener('pointerleave', pointerLeave);
  function axisAt(x, y) {
    const c = radar.getModel().getSeriesByIndex(0)?.coordinateSystem;
    if (!c) return null;
    const legend=radar.getViewOfComponentModel(radar.getModel().getComponent('legend'))?.group;
    if(legend){const box=legend.getBoundingRect().clone();if(legend.transform)box.applyTransform(legend.transform);if(x>=box.x-2&&x<=box.x+box.width+2&&y>=box.y-2&&y<=box.y+box.height+2)return null;}
    const r = Math.hypot(x - c.cx, y - c.cy);
    if (r < 10 || r > c.r + 56 || y < 36) return null;
    const a = Math.atan2(y - c.cy, x - c.cx), max = contributionRadarOption(m).axisMax;
    return m.view.groups.map((g, i) => {const p = c.dataToPoint(max, i), b = Math.atan2(p[1] - c.cy, p[0] - c.cx);
      return {g, d: Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))};
    }).sort((a, b) => a.d - b.d)[0]?.g ?? null;
  }
  function hoverFace(index, on) {
    const el = radar.getModel().getSeriesByIndex(0)?.getData()?.getItemGraphicEl(index),
      c = radar.getModel().getSeriesByIndex(0)?.coordinateSystem;
    if (!el || !c) return;
    el.attr({originX: c.cx, originY: c.cy});
    const amount = on && !reduced.matches ? 1.025 : 1;
    el.animateTo({scaleX: amount, scaleY: amount}, {duration: 180});
    radar.dispatchAction({type: on ? 'highlight' : 'downplay', seriesIndex: 0, dataIndex: index});
    window.lifeCircleRadarHover = {index, on, scale: amount};
  }
  radar.on('mouseover', p => {if (p.seriesIndex === 0) hoverFace(p.dataIndex, true);});
  radar.on('mouseout', p => {if (p.seriesIndex === 0) hoverFace(p.dataIndex, false);});
  radar.getZr().on('mousemove', e => {
    if (!m || !alive) return;
    const nextAxis=axisAt(e.offsetX,e.offsetY),changed=nextAxis?.id!==axis?.id;axis=nextAxis;if(changed){const graphics=m.view.groups.flatMap(g=>['radar-axis-highlight-'+g.id,'radar-node-expected-'+g.id,...(m.confirmedScore>0?['radar-node-actual-'+g.id]:[])].map(id=>({id,style:{opacity:g.id===nextAxis?.id?1:0}})));radar.setOption({graphic:graphics},{silent:true});}
    const count = radar.getModel().getSeriesByIndex(0)?.getData()?.count() ?? 0;
    if (!axis || !count) {radar.dispatchAction({type: 'hideTip'}); return;}
    radar.dispatchAction({type: 'showTip', seriesIndex: 0, dataIndex: count > 1 ? 1 : 0, x: e.offsetX, y: e.offsetY});
  });
  radar.getZr().on('globalout', () => {if(!m||!alive)return;axis = null;radar.setOption({graphic:m.view.groups.flatMap(g=>['radar-axis-highlight-'+g.id,'radar-node-expected-'+g.id,...(m.confirmedScore>0?['radar-node-actual-'+g.id]:[])].map(id=>({id,style:{opacity:0}})))},{silent:true});radar.dispatchAction({type: 'hideTip'});});
  radar.getZr().on('click', e => {if (!m || !alive) return; const g = axisAt(e.offsetX, e.offsetY); if (g) onCategory(g.id);});

  function renderRadar(resizing = false) {
    const o = refinedRadarOption(m, radar.getWidth(), radar.getHeight());
    if (resizing) o.legend.selected = radar.getOption()?.legend?.[0]?.selected ?? {};
    // A zero total has no contribution shares; keep only the priority reference, with no fabricated zero polygon.
    if (m.confirmedScore === 0) {
      o.series[0].data = o.series[0].data.slice(0, 1);
      o.graphic = [{type: 'text', left: 'center', top: '49%', silent: true,
        style: {...auxiliaryText,text: '暂无贡献数据', fill: '#7B96A8'}}];
    }
    o.tooltip = {...LIGHT_TOOLTIP,confine:false,transitionDuration:0,textStyle:{...auxiliaryText,color:'#31536A'},triggerOn: 'none', extraCssText: LIGHT_TOOLTIP.extraCssText + 'pointer-events:none;font-variant-numeric:tabular-nums;',
      formatter: () => radarAxisTooltip(axis, m.confirmedScore),
      position: (point, params, dom, rect, size) => radarTooltipPosition(axis, iconAreas, radar.getWidth(), radar.getHeight(), size.contentSize,{rect:radarNode.getBoundingClientRect(),viewport:{width:innerWidth,height:innerHeight},center:radar.getModel().getSeriesByIndex(0)?.coordinateSystem})};
    radar.setOption({...o, animation: !reduced.matches && !resizing}, true);
    raisedLegend.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(radar.getOption()?.legend?.[0]?.selected?.[b.dataset.radarSeries]!==false)));
    radarIcons();
  }
  function render(resizing = false) {
    if (!m || !alive) return;
    const ring = ringScoreOption(m, {reduced: reduced.matches || resizing, width: gauge.getWidth(), height: gauge.getHeight()});
    ring.tooltip = {show: false};
    ring.series[0].itemStyle.color = {type: 'linear', x: 0, y: 0, x2: 1, y2: 1,
      colorStops: [{offset: 0, color: '#50DDD3'}, {offset: 1, color: '#13A9E5'}]};
    const detail=ring.series[0].detail;detail.fontSize=TYPE.core;detail.fontFamily=TYPE.family;detail.rich.score={...detail.rich.score,fontFamily:TYPE.family,fontSize:TYPE.core};detail.rich.unit={...detail.rich.unit,fontFamily:TYPE.family,fontSize:TYPE.auxiliary};gauge.setOption(ring,true);
    labelsSignature = '';
    enlargedSectors = [];
    main.setOption({...facilitySunburstOption(m, E, main.getWidth(), main.getHeight()), animation: !reduced.matches}, true);
    // Layout is already available after setOption; do not depend on the global animation-finished event.
    sunburstLabels();
    renderRadar(resizing);
    captionNode.textContent = ''; captionNode.parentElement.hidden = true; legendNode.innerHTML = '';
    document.querySelector('#radar-context-caption').hidden = true;
    window.lifeCircleReportCharts = {status: 'ready', version: m.version, compositionType: 'facility_share_sunburst', contributionType: 'dual_radar',
      totalPoi: m.totalPoi, confirmedScore: m.confirmedScore, scoreLow: m.confirmedScore,
      contributionLow: m.contributions.reduce((s, g) => s + g.contributionLow, 0),
      subtypeCount: m.groups.flatMap(g => g.children).length,
      groups: m.groups.map(g => ({id: g.id, value: g.value, children: g.children.map(s => ({id: s.id, value: s.value}))})),
      weights: m.contributions.map(g => ({id: g.id, p: g.priority, weight: g.weight})),
      getChart: () => main, getGauge: () => gauge, getRadar: () => radar};
  }
  function update(job, tree) {
    m = lightReportModel(job, tree);
    const s = scoreSummary(m, job, tree), grade = document.querySelector('#score-grade');
    grade.textContent = s.grade?.label ?? '暂无评分'; grade.style.setProperty('--grade-color', s.grade?.color ?? '#91A6B5');
    document.querySelector('#score-community').textContent = s.community;
    document.querySelector('#score-poi-count').textContent = s.reachablePoi + '处';
    document.querySelector('#score-completeness').textContent = fmt(s.coverage) + '%';
    document.querySelector('#score-specialty-completeness').textContent = fmt(s.specialtyCompleteness) + '%';
    document.querySelector('#score-conclusion').textContent = m.confirmedScore >= 80 ? '生活配套较为完善，重点服务仍可持续提升' : m.confirmedScore >= 60 ? '生活配套较为完善，部分服务仍有提升空间' : '部分服务覆盖不足，建议优先关注重点设施';
    render();
  }
  const observer = new ResizeObserver(() => {if (!alive || !m) return; gauge.resize(); main.resize(); radar.resize(); render(true);});
  [gaugeNode, mainNode, radarNode].forEach(n => observer.observe(n));
  return {update, reset() {render(); onReset();}, getModel: () => m, destroy() {
    alive = false; m = null; observer.disconnect();
    radarNode.removeEventListener('pointermove', pointerMove, true); radarNode.removeEventListener('pointerleave', pointerLeave);
    gauge.dispose(); main.dispose(); radar.dispose();
    raisedLegend.remove();
  }};
}
