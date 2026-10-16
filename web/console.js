import{popupWalkingMetrics,compactFacilityPopup,facilityPopupWidth,facilityPopupMarkup}from'./facility-popup-a41.js?v=a82';
import{SPECIALTY_COLORS,specialtyMarkerImage}from'./subtype-icons.js';
import{createWalkingNavigationLayer}from'./walking-navigation.js?v=a80';
import{productText}from'./presentation-copy.js';
import{placeMapLabel,mapUiObstacles}from'./map-label-layout.js';
import{boundaryContainsPoint}from'./sample-boundary.js';
import{resetWalkingOrigin}from'./location-selection.js?v=a34';
import{arrangeMapFilters,dockMapScale,dockReportDetails}from'./compact-map-controls.js?v=a65-20261015';
dockMapScale();dockReportDetails();
import{createSpecialtyMapLink,renderInitialSpecialtyLegend}from'./specialty-map-a61.js?v=a82';
import{composeSpecialtyRoutes}from'./specialty-route-policy.js';
import{createServiceGapLayer}from'./service-gap-layer.js?v=a86';
import{reduceBlindspotState}from'./blindspot-state.js?v=a86';
import{hydrateSpecialtyGapEvidence,SPECIALTY_EVIDENCE_VERSION,hasCurrentServiceGapEvidence}from'./specialty-gap-evidence.js?v=a79';
import{createMapFocus}from'./map-focus-a38.js?v=a79';
import{installReportTypography,mountTopTypography}from'./report-typography.js?v=a76';installReportTypography();mountTopTypography();
import{mountReportStates}from'./report-state-ui.js?v=a68-20261015';
const reportStates=mountReportStates();renderInitialSpecialtyLegend(document.querySelector('#map-diagnostic-legend'));
import{POI_HEAT_CSS,POI_HEAT_GRADIENT,poiFacilityHeatData}from'./poi-facility-heat.js?v=a31-20261012';
import{loadTimeHeatLibrary,createTimeHeatController}from'./walk-time-heat.js?v=a31-20261012';
import{startMapBootstrap}from'./map-bootstrap.js?v=a82';
import{createMapFirstPaintQueue}from'./map-first-paint.js';
import{facilityDetailList}from'./facility-detail-list.js?v=a74';
import{p123Default,p123Weights,mountP123Priorities}from'./p123-horizontal.js?v=a38-20261013';
import{decisionSeconds,walkingTimeLabel}from'./walking-model.js?v=ui16-20261009';
import{reachableFacilityRows,walkingRangeNotice}from'./reachable-presentation.js?v=a20-20261010';
import{circleFacilityRows,mapPresentationRows,walkingRangePolygons}from'./circle-presentation.js?v=a21-final-20261010';
import{paletteTree}from'./report-theme.js?v=a24-20261011';
import { equalPriorityTiers, tierWeights, mountPriorityTiers } from './priority-tiers.js?v=desktop-responsive-20261008';
import { reportPresentation, chartTip } from './report-view.js?v=a21-final-20261010';
import { facilityGlyph, poiIconSvg, originIconSvg } from './poi-icons.js?v=a68-20261015';
import { compactMarkerVisual, nearbyMarkerRows } from './marker-presentation.js?v=ui14-20261009';
import { facilityViewRows, makeFacilityTask } from './facility-view.js?v=reference-v7.1-20261010';

import {createSelectedRouteViewer} from './selected-route.js?v=a76';
import {knownReachableEnvelope} from './poi-envelope.js?v=ui15-20261009';
import {retinaSvg} from './retina-icons.js?v=light-workbench-v16-20261009';
import { createFacilityRouteController } from './facility-routes.js?v=20261005';
import { createMapThemeRuntime } from './map-theme-runtime.js?v=a20-cache-20261010';
import { observeMapLayout } from './map-layout.js?v=desktop-responsive-20261008';
// 业务 POI、中心点和后续分析图层由覆盖物单独绘制，不混入底图样式。
const MAP_STYLE_IDS = Object.freeze({
  dark: '8a55956fa476aee2aaf84c667a660162',
  light: '214cf6a585f2b9166e4106873999ec9e',
});
const fallbackCenter = { lng: 120.150993, lat: 30.288902 };
let categoryTree = { version: 'facility-categories-v8', categories: [] };
let categories = [];
const state = {
  map: null, center: null, centerMarker: null, walkingOrigin:null, pickingWalkingOrigin:false, analysisLocationMarker:null, originDragAnalyzed:false, draggingOrigin:false,
  selectedName: '', selectedAddress: '', originSource: 'map_click', originUid: null,
  activeCategoryId: 'all', categoryLayers:null,focusedLayer:'global',cameraController:null, activeSubtypeId:null,activePoiKeys:null,directionOverlays:[],directionSelection:null,reportCharts:null,reportChartSequence:0,categoryReady: false, priorities: {}, priorityModel: null,
  categoryMarkers: new Map(), nearestMarkerKeys: new Set(), prominentMarkerKeys:new Set(), selectedPoiKey: null,
  geometryOverlays: [], heatOverlay: null, heatController:null,heatSequence:0,heatOpacity:.8, geometryView: 'network',serviceGapLayer:null,blindspot:{visible:false},blindspotInitializedId:null,
  layerVisibility:{range:true,routes:true,poi:true,heat:true},heatCategoryId:'all',
  showStudyExtent: false, contextOverlays: { traffic: [], aoi: [], events: [] },
  contextExpiryTimer: null, searchSequence: 0,
  activeAnalysisId: null, analysisJob: null, analysisScore: null, scoreRequestSequence: 0,
  // Competition flow is fixed to walking 15 minutes.
  travelMode: 'walking', travelMinutes: 15, mapTheme: 'light',
  mapReady: false, placeSearchReady: false, serviceReady: false, runSequence: 0, reportOpen: false,
  sdkCorePromise: null, mapTimings: {}, mapThemeRuntime: null,
};
const $ = (selector) => document.querySelector(selector);
$('#heat-toggle span').textContent='可达设施热力';$('#heat-toggle').setAttribute('aria-label','可达设施热力');
function recordMapStage(stage,at=performance.now()) {
  if (Object.hasOwn(state.mapTimings, stage)) return;
  state.mapTimings[stage] = Math.round(at);
  performance.mark('life-circle:' + stage,{startTime:at});
  window.lifeCircleMapTimings = { ...state.mapTimings };
}
recordMapStage('boot');
const mapBootstrap=startMapBootstrap();mapBootstrap.subscribe(recordMapStage);
const mapStyleTransport = mapBootstrap.styleTransport;
// The 8s fallback could compile charts while slow SDK tiles were still drawing.
// Keep the map's first frame exclusive; explicit map failures release reports.
const firstPaintQueue=createMapFirstPaintQueue({timeoutMs:30000});window.addEventListener('pagehide',event=>{if(!event.persisted)firstPaintQueue.dispose();});
window.lifeCircleMapRequestTimeouts = { styleRequestMs: mapStyleTransport.installed ? mapStyleTransport.timeoutMs : null, styleOverallMs:30000 };
window.addEventListener('pagehide', (event) => { if (!event.persisted) mapStyleTransport.dispose(); });
const mapRuntime = mapBootstrap.runtime;
const escapeHtml = (value) => productText(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

function formatScaleDistance(meters) {
  if (meters >= 1000) return Number((meters / 1000).toFixed(2)) + ' km';
  return Number(meters.toFixed(meters < 10 ? 1 : 0)) + ' m';
}
function updateMapNavigation() {
  const map = state.map;
  if (!map || typeof map.getZoom !== 'function' || typeof map.getCenter !== 'function') return;
  const center = map.getCenter();
  const zoom = Number(map.getZoom());
  if (!center || !Number.isFinite(zoom)) return;
  const metersPerPixel = 156543.03392 * Math.cos(Number(center.lat) * Math.PI / 180) / (2 ** zoom);
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return;
  const targetPixels = Math.max(60, Math.min(140, $('#map').clientWidth * .10));
  const targetMeters = targetPixels * metersPerPixel;
  const exponent = Math.floor(Math.log10(targetMeters));
  const candidates = [];
  for (let power = exponent - 1; power <= exponent + 1; power += 1) {
    for (const step of [1, 2, 5]) candidates.push(step * (10 ** power));
  }
  const viable = candidates.filter((distance) => distance / metersPerPixel >= targetPixels * .74 && distance / metersPerPixel <= targetPixels * 1.42);
  const distances = viable.length ? viable : candidates;
  const distance = distances.reduce((best, candidate) =>
    Math.abs(candidate / metersPerPixel - targetPixels) < Math.abs(best / metersPerPixel - targetPixels) ? candidate : best);
  const width = Math.round(distance / metersPerPixel);
  const scale = $('#map-scale');
  scale.style.width = width + 'px';
  $('#map-scale-quarter').textContent = formatScaleDistance(distance / 4);
  $('#map-scale-half').textContent = formatScaleDistance(distance / 2);
  $('#map-scale-full').textContent = formatScaleDistance(distance);
  // Keep endpoint labels; show inner ticks only when their text has room.
  const labels = [...scale.querySelectorAll('.map-scale-labels span')];
  const ticks = [...scale.querySelectorAll('.map-scale-track i')];
  labels.forEach((label) => { label.hidden = false; });
  ticks.forEach((tick) => { tick.hidden = false; });
  const bounds = labels.map((label) => label.getBoundingClientRect());
  const visible = [0, 3];
  for (const index of [2, 1]) {
    const hasRoom = visible.every((other) =>
      bounds[index].right + 5 <= bounds[other].left ||
      bounds[other].right + 5 <= bounds[index].left);
    if (hasRoom) visible.push(index);
    else {
      labels[index].hidden = true;
      ticks[index].hidden = true;
    }
  }
  scale.setAttribute('aria-label', '比例尺：' + width + '像素约为' + formatScaleDistance(distance));
}
function applyMapTheme(theme) {
  const resolvedTheme = 'light';
  const map = state.map;
  if (map) {
    if (typeof map.setMapStyleV2 !== 'function') {
      console.error('BMapGL setMapStyleV2 is unavailable.');
      toast('当前百度地图版本不支持主题切换。');
      return false;
    }
    try {
      state.mapThemeRuntime?.select(resolvedTheme);
    } catch (error) {
      console.error('BMapGL theme switch failed', error);
      toast('地图主题切换失败，请检查样式配置。');
      return false;
    }
  }

  state.mapTheme = resolvedTheme;
  document.body.dataset.mapTheme = resolvedTheme;
  markerColors.clear();
  showCenterLayers();
  state.heatOverlay?.setTheme(resolvedTheme);
  updateRepresentativeDisplay();
  if(state.analysisJob) { applyCategoryFocus(); drawAnalysisGeometry(state.analysisJob); renderGeometryControls(state.analysisJob); }
  const toggle = $('#map-theme-toggle');
  if (toggle) toggle.firstChild.textContent = `${resolvedTheme === 'dark' ? '深色主题' : '浅色主题'} `;
  document.querySelectorAll('#map-theme-menu [data-map-theme]').forEach((option) => {
    option.setAttribute('aria-pressed', String(option.dataset.mapTheme === resolvedTheme));
  });
  return true;
}
function setReportOpen(open) {
  state.reportOpen = Boolean(open);
  const report = $('#report-drawer');
  if (!report) return;
  report.setAttribute('aria-hidden', String(!state.reportOpen));
  report.classList.toggle('is-open', state.reportOpen);
  document.body.dataset.reportOpen = String(state.reportOpen);
  const drawerToggle = $('#report-drawer-toggle');
  if (drawerToggle) {
    drawerToggle.setAttribute('aria-expanded', String(state.reportOpen));
    drawerToggle.setAttribute('aria-label', state.reportOpen ? '收起分析结果' : '展开分析结果');
    drawerToggle.textContent = state.reportOpen ? '›' : '‹';
  }
}


function setState(value) {
  document.body.dataset.state = value;
}

function setStatus(message, tone = '') {
  const node = $('#analysis-status');
  node.textContent = productText(message);
  node.dataset.tone = tone;
}


const travelModeLabels = { walking: '步行' };
function refreshTravelSelection() {
  $('#travel-summary').textContent = '步行 · 15分钟';
  $('#travel-summary-top').textContent = '步行 15 分钟分析';
  $('#analysis-budget').textContent = '六大类18小类；真实步行15分钟，按现有额度分阶段处理。';
}
function toast(message) {
  const node = $('#toast');
  node.textContent = productText(message);
  node.classList.add('visible');
  clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => node.classList.remove('visible'), 3000);
}

function categoryIcon(category) {
  return `<span class="category-icon" style="--category-color:${category.color}" aria-hidden="true"><svg viewBox="0 0 24 24">${facilityGlyph(category.id??category.iconKey)}</svg></span>`;
}

// One shared tooltip for all charts. Content is text-only and never requests data.
let chartTipTarget=null;
function hideChartTooltip() {
  $('#chart-tooltip').hidden=true;
  chartTipTarget?.removeAttribute('aria-describedby');chartTipTarget=null;
}
function positionChartTooltip(target,event) {
  const tooltip=$('#chart-tooltip'),rect=target.getBoundingClientRect(),box=tooltip.getBoundingClientRect();
  const x=event?.clientX??rect.left+rect.width/2,y=event?.clientY??rect.top;
  tooltip.style.left=Math.max(8,Math.min(innerWidth-box.width-8,x-box.width/2))+'px';
  tooltip.style.top=Math.max(8,y-box.height-12>=8?y-box.height-12:Math.min(innerHeight-box.height-8,y+18))+'px';
}
function showChartTooltip(target,event) {
  if(!target)return;
  let tip;try{tip=JSON.parse(target.dataset.chartTip);}catch{return;}
  hideChartTooltip();chartTipTarget=target;
  const tooltip=$('#chart-tooltip');tooltip.classList.remove('is-hover-preview');tooltip.setAttribute('role','dialog');tooltip.replaceChildren();
  const close=document.createElement('button');close.type='button';close.className='chart-detail-close';close.textContent='×';close.setAttribute('aria-label','关闭图表详情');close.addEventListener('click',hideChartTooltip);tooltip.append(close);
  const title=document.createElement('strong');title.textContent=productText(tip.title);tooltip.append(title);
  for(const [label,value]of tip.rows??[]){const row=document.createElement('div'),key=document.createElement('span'),data=document.createElement('b');
    key.textContent=productText(label);data.textContent=productText(value);row.append(key,data);tooltip.append(row);}
  if(tip.note){const note=document.createElement('p');note.textContent=productText(tip.note);tooltip.append(note);}
  tooltip.hidden=false;target.setAttribute('aria-describedby','chart-tooltip');positionChartTooltip(target,event);
}
let subtypeHover=false;
document.addEventListener('pointerover',event=>{const target=event.target.closest?.('[data-subtype-bar],.trend-point,.category-count-row,.facility-detail-track');if(!target)return;subtypeHover=true;showChartTooltip(target,event);$('#chart-tooltip').classList.add('is-hover-preview');$('#chart-tooltip').setAttribute('role','tooltip');});
document.addEventListener('pointerout',event=>{const target=event.target.closest?.('[data-subtype-bar],.trend-point,.category-count-row,.facility-detail-track');if(target&&!target.contains(event.relatedTarget)&&subtypeHover){hideChartTooltip();subtypeHover=false;}});
document.addEventListener('click',event=>{const target=event.target.closest?.('[data-chart-tip]');
  subtypeHover=false;$('#chart-tooltip').classList.remove('is-hover-preview');$('#chart-tooltip').setAttribute('role','dialog');
  if(target?.matches('.group-score-bar,.category-count-row,.subtype-access-bar,.facility-detail-track')){hideChartTooltip();return;}
  if(target){event.preventDefault();event.stopPropagation();showChartTooltip(target,event);}
  else if(!event.target.closest?.('#chart-tooltip'))hideChartTooltip();},true);




document.addEventListener('scroll',hideChartTooltip,true);
document.addEventListener('keydown',event=>{if(event.key==='Escape')hideChartTooltip();if(['Enter',' '].includes(event.key)&&event.target.matches('[data-chart-tip]')&&!event.target.matches('.category-count-row,.subtype-access-bar')){event.preventDefault();if(event.target.classList.contains('group-score-bar')){const detail=event.target.closest('details');detail.open=!detail.open;}else showChartTooltip(event.target);}});
const scoreMeasure=document.createElement('canvas').getContext('2d');
function fitScoreNumber() {
  const ring=$('#overall-ring'),text=$('#coverage-rate');if(!ring.clientWidth||!scoreMeasure)return;
  const style=getComputedStyle(text);scoreMeasure.font=style.fontWeight+' 28px '+style.fontFamily;
  const available=ring.clientWidth-26,width=scoreMeasure.measureText(text.textContent).width;
  ring.style.setProperty('--score-digit-size',Math.min(21,Math.max(11,21*available/Math.max(1,width)))+'px');
}



function renderMapLegend(){
 $('#heat-toggle span').textContent='可达设施热力';$('#heat-toggle').setAttribute('aria-label','可达设施热力');
 const heat=window.lifeCircleHeatPresentation,legend=$('#map-analysis-legend');legend.hidden=!state.layerVisibility.heat;
 legend.innerHTML=state.layerVisibility.heat?'<div class="heat-legend"><strong>可达设施热力'+(state.heatCategoryId==='all'?'':' · '+escapeHtml(categories.find(g=>g.id===state.heatCategoryId)?.label??''))+'</strong>'+(heat?.status==='available'?'<i class="heat-gradient" style="--time-heat-gradient:'+POI_HEAT_CSS+'"></i><div class="poi-heat-labels"><span>高</span><span>中</span><span>低</span></div>':'<span>该分类暂无确认可达设施热力</span>')+'</div>':'';
 if(state.layerVisibility.heat){legend.insertAdjacentHTML('beforeend','<label class="heat-opacity-control">透明度 <input id="heat-opacity" type="range" min="0" max="100" value="'+Math.round(state.heatOpacity*100)+'" aria-label="可达设施热力透明度"><output>'+Math.round(state.heatOpacity*100)+'%</output></label>');legend.querySelector('#heat-opacity').oninput=e=>{state.heatOpacity=Number(e.target.value)/100;state.heatController?.setOpacity(state.heatOpacity*(['heat','global'].includes(state.focusedLayer)?1:.6));if(window.lifeCircleHeatPresentation)window.lifeCircleHeatPresentation.opacity=state.heatOpacity;legend.querySelector('output').textContent=e.target.value+'%';};}
}
function refreshHeatLayer(){
 const sequence=++state.heatSequence;state.heatOverlay?.dispose();state.heatOverlay=null;state.heatCategoryId=state.activeCategoryId;$('#heat-toggle').setAttribute('aria-pressed',String(state.layerVisibility.heat));
 const publish=model=>{window.lifeCircleHeatDiagnostics=null;window.lifeCircleHeatPresentation={...model,data:undefined,renderData:undefined,polygons:undefined,visible:state.layerVisibility.heat,opacity:state.heatOpacity};renderMapLegend();};
 if(!state.layerVisibility.heat){publish({status:'hidden'});return;}if(!state.analysisJob){publish({status:'unavailable',reasonCode:'analysis_required'});return;}if(!state.map||window.lifeCircleMapStatus?.status!=='applied'){publish({status:'loading',reasonCode:'waiting_for_basemap'});return;}
 const model=poiFacilityHeatData(state.analysisJob,allFacilityRows(),state.activeCategoryId);if(model.status!=='available'){publish(model);return;}publish({status:'loading'});
 loadTimeHeatLibrary().then(M=>{if(sequence!==state.heatSequence||!state.layerVisibility.heat)return;state.heatController??=createTimeHeatController(M,state.map,window.BMapGL,{aggregation:'additive',opacity:state.heatOpacity,gradient:POI_HEAT_GRADIENT,size:model.size});state.heatOverlay=state.heatController;const stats=state.heatController.set(model,heatForeground());publish({...model,...stats});updateLayerEmphasis();}).catch(e=>{if(sequence===state.heatSequence)publish({status:'unavailable',reasonCode:e.message});});
}

function renderCategoryOptions(){
 const selected=id=>id==='all'?state.categoryLayers===null||state.categoryLayers.size===categories.length:state.categoryLayers?.has(id)??false;
 $('#category-options').innerHTML=categories.map(g=>'<button type="button" class="category-option" data-category="'+g.id+'" aria-pressed="'+selected(g.id)+'">'+categoryIcon(g)+'<span class="category-label">'+g.label+'</span></button>').join('');
 $('#category-options').querySelectorAll('[data-category]').forEach(button=>button.onclick=()=>{
  const id=button.dataset.category;if(!state.analysisJob){toast('请先完成地点分析。');return;}
  let enabled;if(id==='all'){enabled=state.categoryLayers!==null;state.categoryLayers=enabled?null:new Set();state.activeCategoryId='all';}
  else{const already=state.categoryLayers?.has(id)??false;state.categoryLayers??=new Set();if(already)state.categoryLayers.delete(id);else state.categoryLayers.add(id);enabled=!already;state.activeCategoryId=enabled?id:[...state.categoryLayers].at(-1)??'all';}
  state.activeSubtypeId=null;state.activePoiKeys=null;specialtyLink?.setCategoryScope(state.categoryLayers===null?categories.map(g=>g.id):[...state.categoryLayers]);clearDirectionHighlight();renderCategoryOptions();applyCategoryFocus();refreshHeatLayer();
  if(enabled)fitCategoryCamera();else{state.focusedLayer='global';updateLayerEmphasis();refreshServiceGapLayer();}
 });arrangeMapFilters();
}
function refreshLayerControls(job){const sampled=walkingRangePolygons(job).length>0,reference=Boolean(job?.geojson?.features?.some(f=>f.properties?.featureType==='degraded_reference')),available=sampled||reference;const envelope=!available&&Boolean(envelopeFor(job)),aux=$('#envelope-toggle');aux.hidden=!envelope;aux.setAttribute('aria-pressed',String(state.layerVisibility.envelope!==false));const button=$('#range-toggle');button.disabled=!available;button.setAttribute('aria-pressed',String(available&&state.layerVisibility.range));button.querySelector('span').textContent=reference?'理论参考圈':'15分钟步行圈';button.title=reference?'步行算路不可用：仅理论参考，不代表实际可达，也不参与评分。':sampled?'显示或隐藏80m/min步行成本采样近似范围；内部未知':'15分钟步行范围暂不可用';}

function renderPriorityControls() {
  if (!categories.length) return;
  const ids = categories.map((group) => group.id);
  if(categoryTree.version==='facility-categories-v8'){
    state.priorityModel=state.priorityModel?.levels?state.priorityModel:p123Default(ids);state.priorities=p123Weights(state.priorityModel,ids);
    state.priorityController?.destroy();state.priorityController=mountP123Priorities($('#priority-options'),{onNotice:toast,categories,model:state.priorityModel,renderIcon:categoryIcon,onChange:(model,weights)=>{state.priorityModel=model;state.priorities=weights;updatePriorityPreview();handleScoreSelectionChange();}});updatePriorityPreview();return;
  }
  $('#priority-options').classList.remove('p123-priorities');state.priorityModel=state.priorityModel?.tiers?state.priorityModel:null;
  state.priorityModel ??= equalPriorityTiers(ids);
  state.priorities = tierWeights(state.priorityModel, ids);
  mountPriorityTiers($('#priority-options'), { categories, model: state.priorityModel, layout:'horizontal',renderIcon:categoryIcon, onChange: (model, weights) => {
    state.priorityModel = model; state.priorities = weights; updatePriorityPreview(); handleScoreSelectionChange();
  } });
  updatePriorityPreview();
}
function updatePriorityPreview() {
  const total = Object.values(state.priorities).reduce((sum,value) => sum+value,0);
  $('#priority-preview').textContent = total
    ? (state.priorityModel.levels?3:state.priorityModel.tiers.length)+'档；同档等权，各类内部小类等权。调整排序复用现有证据。'
    : '全部不计分：设施检索与步行计算照常进行。';
  refreshRunButton();
}
function invalidateExistingAnalysis() {
  state.blindspot={visible:false};state.blindspotInitializedId=null;refreshServiceGapLayer();
  state.reportChartSequence++;firstPaintQueue.cancel('charts');firstPaintQueue.cancel('heat');
  clearDirectionHighlight();
  specialtyLink?.destroy();specialtyLink=null;renderInitialSpecialtyLegend($('#map-diagnostic-legend'));$('#map-diagnostic-detail').hidden=true;
  state.activeSubtypeId = null;
  state.activePoiKeys = null;
  rememberAnalysis(null);
  routeController.clear();
  staticRoutes?.clear();
  state.runSequence += 1;
  state.scoreRequestSequence += 1;
  if (state.activeAnalysisId) {
    const id = state.activeAnalysisId;
    state.activeAnalysisId = null;
    fetch('/api/analyses/' + encodeURIComponent(id) + '/cancel', { method: 'POST' }).catch(() => {});
  }
  state.analysisJob = null;
  state.analysisScore = null;
  clearGeometryLayers();
  clearContextLayers();
  if (state.map) clearPoiLayers();
  $('#report-ready').hidden = true;
  $('#report-loading').hidden = true;
  $('#report-empty').hidden = false;
  $('#report-empty strong').textContent = '分析条件已变化';
  $('#report-empty p').textContent = '请重新运行路线分析，旧评分不再适用。';
  $('#cancel-analysis').hidden = true;
  $('#map-analysis-legend').hidden = true;
  setState(state.center ? 'selected' : 'default');
  if (state.center) setStatus('条件已改变 · 请重新评估');
  refreshRunButton();
}
async function rescoreCurrent() {
  let job = state.analysisJob;
  if (!job || !['complete','partial'].includes(job.status)) return;
  const sequence = ++state.scoreRequestSequence;
  const selectedCategoryIds = categories.map((item) => item.id);
  try {
    let response = await fetch('/api/analyses/' + encodeURIComponent(job.analysisId) + '/score', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        evidenceFingerprint: job.score.evidenceFingerprint, selectedCategoryIds,
        priorities: state.priorities,
      }),
    });
    // A user-opened detail may have replaced cost evidence while weights were changing.
    // Refresh the existing snapshot once; this does not rerun Place or routing.
    if (response.status === 409) {
      const snapshot = await fetch('/api/analyses/' + encodeURIComponent(job.analysisId)+'?view=ui');
      if (!snapshot.ok) throw new Error('无法读取更新后的证据');
      job = await snapshot.json();
      if (sequence !== state.scoreRequestSequence) return;
      response = await fetch('/api/analyses/' + encodeURIComponent(job.analysisId) + '/score', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ evidenceFingerprint: job.score.evidenceFingerprint, selectedCategoryIds,
          priorities: state.priorities }),
      });
    }
    const score = await response.json();
    if (!response.ok) throw new Error(score.error || '评分重算失败');
    if (sequence !== state.scoreRequestSequence || state.analysisJob?.analysisId !== job.analysisId) return;
    state.analysisScore = score;
    job.score = score;
    // Read the already reweighted regional grid; this GET never reruns providers.
    const presentationResponse=await fetch('/api/analyses/'+encodeURIComponent(job.analysisId)+'?view=ui');
    if(presentationResponse.ok){const refreshed=await presentationResponse.json();if(sequence!==state.scoreRequestSequence)return;job=refreshed;}
    renderFacilityResult(job, { reuseLayers: true });
    setStatus('权重已更新 · 路线证据未重新请求', 'success');
  } catch {
    if (sequence === state.scoreRequestSequence) toast('评分更新失败，请刷新证据后重试。');
  }
}

function handleScoreSelectionChange() {
  specialtyLink?.reorder(state.priorities);
  $('#priority-preview').textContent='优先级已调整，将用于下一次评估。';
}
function refreshRunButton() {
  $('#recenter-map').disabled=!state.center||!state.mapReady;
  refreshReportMeta();
  $('#run-analysis').disabled = !state.center || !state.mapReady || !state.serviceReady || !state.categoryReady
    || document.body.dataset.state === 'analyzing';
}
function centerIconSvg() {
  return originIconSvg({palette:markerPalette()});
}

function removeCenterLayers() {
  if (state.centerMarker) state.map.removeOverlay(state.centerMarker);
  if(state.analysisLocationMarker)state.map.removeOverlay(state.analysisLocationMarker);state.analysisLocationMarker=null;
  state.centerMarker = null;$('#origin-pulse').hidden=true;
}

function positionOriginPulse(){$('#origin-pulse').hidden=true;staticRoutes?.refreshOrigin();}
function showCenterLayers() {
  if (!state.center || !state.map) return;
  removeCenterLayers();
  const B = window.BMapGL;
  const actual=state.walkingOrigin?.location ?? state.center;
  const point = new B.Point(actual.lng,actual.lat);
  const icon = new B.Icon(`data:image/svg+xml;charset=UTF-8,${encodeURIComponent(retinaSvg(centerIconSvg(),devicePixelRatio))}`, new B.Size(42, 52.5), { imageSize:new B.Size(42,52.5),anchor: new B.Size(21, 47.25) });
  state.centerMarker = new B.Marker(point, { icon, isTop: true });
  state.centerMarker.addEventListener('click',()=>{const nearby=nearbyMarkerRows(visibleRows(),actual,{project:markerProject,radius:40});if(nearby.length)openPoi(nearby[0].identityKey,{overlapLocation:actual,overlapRadius:40});});
  state.centerMarker.enableDragging?.();
  state.centerMarker.addEventListener('dragstart',()=>{state.originDragAnalyzed=Boolean(state.analysisJob||state.activeAnalysisId);state.draggingOrigin=true;$('#origin-pulse').hidden=true;invalidateExistingAnalysis();});
  state.centerMarker.addEventListener('dragend',event=>{const p=event.latLng ?? event.point ?? state.centerMarker.getPoint?.();state.draggingOrigin=false;ignoreMapClickUntil=performance.now()+250;if(p)setWalkingOrigin(p,{source:'adjusted_entrance',name:'拖动的步行起点'},{recalculate:state.originDragAnalyzed});});
  state.map.addOverlay(state.centerMarker);positionOriginPulse();
  if(state.walkingOrigin){const svg='<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><rect x="3" y="3" width="12" height="12" rx="2" fill="#649eff" stroke="white" stroke-width="1.5"/></svg>';
    state.analysisLocationMarker=new B.Marker(new B.Point(state.center.lng,state.center.lat),{icon:new B.Icon('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg),new B.Size(18,18))});state.map.addOverlay(state.analysisLocationMarker);}
  $('#walking-origin-label').textContent=state.walkingOrigin?'起点：'+state.walkingOrigin.location.lng.toFixed(5)+', '+state.walkingOrigin.location.lat.toFixed(5):'起点：同分析地点';
}


function clearPoiLayers() {
  state.serviceGapLayer?.clear();
  hidePoiName();
  for (const { marker } of state.categoryMarkers.values()) state.map?.removeOverlay(marker);
  state.categoryMarkers.clear();
  state.prominentMarkerKeys.clear();
  state.selectedPoiKey=null;
}
function selectCenter(point, name, address = '', metadata = {}) {
  clearTimeout(originRecalcTimer);clearTimeout(originSearchTimer);originSearchSequence++;
  resetWalkingOrigin(state);$('#origin-search').value='';$('#origin-search-results').hidden=true;
  $('#origin-editor').hidden=true;$('#set-walking-origin').setAttribute('aria-expanded','false');
  invalidateExistingAnalysis();
  state.searchSequence += 1;
  setReportOpen(false);
  state.center = { lng: Number(point.lng), lat: Number(point.lat) };
  state.selectedName = name || '地图选点';
  state.originSource = metadata.source || 'map_click';
  state.originUid = metadata.uid || null;
  state.selectedAddress = address || `${state.center.lng.toFixed(6)}, ${state.center.lat.toFixed(6)}`;
  clearTimeout(searchTimer);
  state.searchSequence += 1;
  $('#location-search').value = address || name || state.selectedAddress;refreshClearButton();
  state.activeCategoryId = 'all';
  renderCategoryOptions();
  clearPoiLayers();
  showCenterLayers();
  if(!metadata.preserveViewport)state.map.centerAndZoom(new window.BMapGL.Point(state.center.lng, state.center.lat), 16);
  $('#selected-name').textContent = state.selectedName;
  $('#selected-address').textContent = state.selectedAddress;
  $('#selected-location').hidden = false;
  $('#analysis-coordinates').hidden=false;$('#analysis-coordinates').textContent=state.center.lng.toFixed(6)+', '+state.center.lat.toFixed(6)+' · BD-09LL';
  $('#map-coordinates').textContent = `${state.center.lng.toFixed(6)}, ${state.center.lat.toFixed(6)} · BD-09LL`;
  $('#map-analysis-legend').hidden = true;
  $('#map-empty').hidden = true;
  $('#map-layer-status').textContent = '中心点 · 已定位';
  $('#report-state-label').textContent = '中心点已选 · 等待分析';
  $('#report-empty strong').textContent = '中心点已就绪';
  $('#report-empty p').innerHTML = '选择设施类别并开始评估后，<br />这里将显示真实设施检索结果。';
  $('#report-empty').hidden = false;
  $('#report-ready').hidden = true;
  $('#report-loading').hidden = true;
  setState('selected');
  setStatus('位置已选定 · 可开始评估', 'success');
  $('#run-analysis').querySelector('span').textContent = '开始评估分析';
  refreshRunButton();
}

function clearSelection() {
  state.walkingOrigin=null;state.pickingWalkingOrigin=false;
  invalidateExistingAnalysis();
  state.searchSequence += 1;
  state.center = null;refreshClearButton();
  state.selectedName = '';
  state.selectedAddress = '';
  state.activeCategoryId = 'all';
  renderCategoryOptions();
  clearPoiLayers();
  removeCenterLayers();
  state.map.centerAndZoom(new window.BMapGL.Point(fallbackCenter.lng, fallbackCenter.lat), 12);
  $('#selected-location').hidden = true;$('#analysis-coordinates').hidden=true;
  $('#map-coordinates').textContent = '等待选择位置';
  $('#map-analysis-legend').hidden = true;
  $('#map-empty').hidden = false;
  $('#map-layer-status').textContent = '底图 · 就绪';
  $('#report-state-label').textContent = '等待分析';
  $('#report-empty strong').textContent = '暂无分析结果';
  $('#report-empty p').innerHTML = '选择中心点并开始分析后，<br />这里将显示生活圈评估报告。';
  $('#report-empty').hidden = false;
  $('#report-ready').hidden = true;
  $('#report-loading').hidden = true;
  setState('default');
  setStatus('请先搜索并选择中心点');
  $('#run-analysis').querySelector('span').textContent = '开始评估分析';
  refreshRunButton();
}

function renderSearchResults(items, sequence) {
  if (sequence !== state.searchSequence) return;
  const box = $('#search-results');
  const valid = items.filter((item) => item.point && Number.isFinite(item.point.lng) && Number.isFinite(item.point.lat)).slice(0, 8);
  box.innerHTML = valid.map((item, index) => `
    <button type="button" class="search-result" data-index="${index}"><strong>${escapeHtml(item.title || item.name || '未命名地点')}</strong><small>${escapeHtml(item.address || '地址信息暂缺')}</small></button>`).join('');
  box.hidden = !valid.length;
  $('#search-message').textContent = valid.length ? '选择一条搜索结果以定位中心点。' : '没有匹配地址，请调整关键词或直接点击地图选点。';
  box.querySelectorAll('.search-result').forEach((button) => {
    button.addEventListener('click', () => {
      const item = valid[Number(button.dataset.index)];
      $('#location-search').value = item.title || item.name || '';
      box.hidden = true;
      selectCenter(item.point, item.title || item.name, item.address || '',
        { source: 'baidu_poi', uid: item.uid || null });
    });
  });
}

async function searchAddress(query) {
  const sequence = ++state.searchSequence;
  const box = $('#search-results');
  box.hidden = true;
  box.replaceChildren();
  $('#search-message').textContent = '';
  if (!query.trim()) {
    return;
  }
  try {
    await state.sdkCorePromise;
    await mapRuntime.searchReady();
  } catch (error) {
    if (sequence === state.searchSequence) $('#search-message').textContent = error.message;
    return;
  }
  if (sequence !== state.searchSequence) return;
  const search = new window.BMapGL.LocalSearch(state.map, {
    pageCapacity: 8,
    renderOptions: { map: null, autoViewport: false },
    onSearchComplete(results) {
      if (sequence !== state.searchSequence) return;
      const items = [];
      if (results && typeof results.getCurrentNumPois === 'function') {
        for (let index = 0; index < Math.min(8, results.getCurrentNumPois()); index += 1) {
          const poi = results.getPoi(index);
          if (poi?.point) items.push({ title: poi.title, address: poi.address, point: poi.point, uid: poi.uid });
        }
      }
      renderSearchResults(items, sequence);
    },
  });
  try { search.search(query.trim()); }
  catch { renderSearchResults([], sequence); }
}


const markerColors=new Map();
function markerPalette() {
  const style=getComputedStyle(document.body);
  return {background:style.getPropertyValue('--marker-bg').trim(),primary:style.getPropertyValue('--origin-color').trim(),
    outline:style.getPropertyValue('--marker-outline').trim(),glyph:style.getPropertyValue('--marker-icon').trim()};
}
function markerProject(location) { return state.map?.pointToPixel?.(new window.BMapGL.Point(location.lng,location.lat)); }
function selectedMarkerKeys() {return new Set([state.selectedPoiKey,routeController.selectedIdentityKey,...(state.diagnosticDim?state.diagnosticPoiKeys??[]:[])].filter(Boolean));}
function markerColor(group) {
  if(!markerColors.has(group.color)){
    const resolver=document.createElement('span');resolver.className='marker-color-resolver';resolver.style.setProperty('--category-color',group.color);
    document.body.append(resolver);markerColors.set(group.color,getComputedStyle(resolver).color);resolver.remove();
  }return markerColors.get(group.color);
}
function hidePoiName(key){const label=$('#poi-name-label');if(label&&(!key||label.dataset.poi===key)){label.hidden=true;delete label.dataset.poi;}}
function showPoiName(row){const label=$('#poi-name-label'),p=markerProject(row.location);if(!label||!p)return;label.textContent=(row.name||'未命名设施')+(row.accessState==='outside_reachable'?' · 圈外可达':'');label.dataset.poi=row.identityKey;label.hidden=false;const map=$('#map'),box=placeMapLabel({anchor:p,width:label.offsetWidth,height:label.offsetHeight,viewport:{width:map.clientWidth,height:map.clientHeight},obstacles:mapUiObstacles(map)});if(!box){label.hidden=true;return;}label.style.left=(box.left+box.width/2)+'px';label.style.top=(box.top+box.height)+'px';}
function markerIcon(row,{hovered=false}={}) {
  const special=row.subtypeIds?.find(id=>SPECIALTY_COLORS[id]);
  if(special&&!row.classificationUncertain){const color=SPECIALTY_COLORS[special],key='specialty:'+special+':'+color;if(markerIconCache.has(key))return markerIconCache.get(key);const icon=new window.BMapGL.Icon(specialtyMarkerImage(special,color),new window.BMapGL.Size(30,30),{imageSize:new window.BMapGL.Size(30,30),anchor:new window.BMapGL.Size(15,15)});markerIconCache.set(key,icon);return icon;}
  const visual=row.classificationUncertain?{important:false,selected:false,width:18,dotDiameter:8}:compactMarkerVisual(row,{zoom:state.map?.getZoom?.()??16,selectedKeys:selectedMarkerKeys(),hovered});
  const options={iconKey:row.group.id,color:row.classificationUncertain?'#96a8b5':markerColor(row.group),palette:markerPalette(),status:row.status,outside:row.accessState==='outside_reachable',...visual,opacity:state.diagnosticDim&&state.focusedLayer.startsWith('specialty:')&&!state.diagnosticPoiKeys?.includes(row.identityKey)? .35:state.focusedLayer.startsWith('category:')&&state.activeCategoryId!=='all'&&!row.memberships?.includes(state.activeCategoryId)? .4:!['global','category:all'].includes(state.focusedLayer)&&!state.focusedLayer.startsWith('category:')? .55:1},key=JSON.stringify([options,devicePixelRatio]);
  if(markerIconCache.has(key))return markerIconCache.get(key);
  const svg = poiIconSvg(options).replace('<svg ','<svg opacity="'+options.opacity+'" ');
  const icon=new window.BMapGL.Icon('data:image/svg+xml;charset=UTF-8,'+encodeURIComponent(retinaSvg(svg,devicePixelRatio)),
    new window.BMapGL.Size(visual.width,visual.width), { imageSize:new window.BMapGL.Size(visual.width,visual.width), anchor: new window.BMapGL.Size(visual.width/2,visual.width/2) });
  markerIconCache.set(key,icon);if(markerIconCache.size>128)markerIconCache.delete(markerIconCache.keys().next().value);return icon;
}
const markerIconCache=new Map();
function paintPoiMarker(item,row=item.displayRow??item.row) {
  const visual=compactMarkerVisual(row,{zoom:state.map?.getZoom?.()??16,selectedKeys:selectedMarkerKeys(),hovered:item.hovered});
  const icon=markerIcon(row,{hovered:item.hovered});if(item.icon!==icon){item.marker.setIcon(icon);item.icon=icon;}
  item.marker.setTop?.(visual.selected||item.hovered);item.marker.lifeCircleVisualKind=row.classificationUncertain?'dot':visual.important?'feature':'dot';
}
function refreshPoiMarkerIcons() {
  const visible=visibleRows(),rows=new Map(visible.map(row=>[row.identityKey,row]));
  state.prominentMarkerKeys=new Set(visible.filter(row=>!row.classificationUncertain).map(row=>row.identityKey));
  for(const [key,item]of state.categoryMarkers){const row=rows.get(key)??item.row;
    item.displayRow=row;
    paintPoiMarker(item,row);
  }
  state.centerMarker?.setTop?.(true);
  window.lifeCircleMarkerPresentation={zoom:state.map?.getZoom?.()??null,total:state.categoryMarkers.size,visible:visible.length,
    features:visible.filter(row=>state.prominentMarkerKeys.has(row.identityKey)).length,
    dots:visible.filter(row=>!state.prominentMarkerKeys.has(row.identityKey)).length};
}
let cachedFacilityRows=null;
function allFacilityRows(){const job=state.analysisJob;if(cachedFacilityRows?.job!==job||cachedFacilityRows?.tree!==categoryTree)cachedFacilityRows={job,tree:categoryTree,rows:facilityViewRows(job?.analysis,categoryTree,'all',job?.display)};return cachedFacilityRows.rows;}
function allReachableRows(){return reachableFacilityRows(allFacilityRows(),state.analysisJob?.analysis.origin).map(row=>{const groups=categories.filter(g=>g.subtypes.some(s=>row.subtypeIds.includes(s.id)));return{...row,memberships:groups.map(g=>g.id),group:groups.find(g=>g.id===state.activeCategoryId)??groups[0]??row.group};});}
function allCircleRows(){return circleFacilityRows(allFacilityRows(),state.analysisJob);}
let mapRowsMemo=null,mapRowsHits=0,mapRowsMisses=0,mapRowsMs=0;
function rawMapRows(){if(mapRowsMemo?.job===state.analysisJob&&mapRowsMemo?.tree===categoryTree&&mapRowsMemo?.category===state.activeCategoryId){mapRowsHits++;}else{const start=performance.now(),raw=mapPresentationRows(allFacilityRows(),state.analysisJob,categories,state.activeCategoryId);mapRowsMemo={job:state.analysisJob,tree:categoryTree,category:state.activeCategoryId,raw,confirmed:raw.filter(r=>!r.classificationUncertain)};mapRowsMisses++;mapRowsMs+=performance.now()-start;}window.lifeCircleMapPreparation={hits:mapRowsHits,misses:mapRowsMisses,computeMs:mapRowsMs};return mapRowsMemo.raw;}
function allMapRows(){rawMapRows();return mapRowsMemo.confirmed;}
function visibleRows(){const keys=specialtyLink?.getVisibleKeys?.();return allMapRows().filter(row=>(!keys||keys.has(row.identityKey))&&(state.categoryLayers===null||row.memberships.some(id=>state.categoryLayers.has(id)))&&(!state.activeSubtypeId||row.subtypeIds.includes(state.activeSubtypeId))&&(!state.activePoiKeys||state.activePoiKeys.has(row.identityKey)));}
function addPoiMarkers() {
  if (!state.map) return;
  for (const row of allMapRows()) {
    const point = new window.BMapGL.Point(row.location.lng,row.location.lat);
    const marker = new window.BMapGL.Marker(point, { icon: markerIcon(row), title: '' });
    const item={marker,row,hovered:false};
    marker.lifeCircleIdentityKey=row.identityKey;
    marker.addEventListener('click', () => openPoi(row.identityKey));
    marker.addEventListener('mouseover',()=>{item.hovered=true;item.marker.setTop?.(true);showPoiName(item.displayRow??row);});
    marker.addEventListener('mouseout',()=>{item.hovered=false;item.marker.setTop?.(selectedMarkerKeys().has(row.identityKey));hidePoiName(row.identityKey);});
    marker.lifeCircleFacilityIdentity=row.identityKey;marker.lifeCircleSpecialtyId=row.subtypeIds?.find(id=>SPECIALTY_COLORS[id])??null;
    state.map.addOverlay(marker); state.categoryMarkers.set(row.identityKey,item);
  }
}
function routeText(evidence) {
  return evidence ? Math.round(evidence.distanceMeters)+'米 · '+Math.round(decisionSeconds(evidence))+'秒（'+walkingTimeLabel(evidence)+'）'
    + (decisionSeconds(evidence)<=900?' · 15分钟内可达':' · 超过15分钟')+(evidence.walkingModelId==='walking80-v1'?' · 百度返回'+Math.round(evidence.durationSeconds)+'秒':'') : '暂无步行数据';
}
function openPoi(identityKey,{focus=false}={}) {
 if(focus){const row=allFacilityRows().find(p=>p.identityKey===identityKey);if(!row)return;walkingNavigationLayer?.clear();state.map.closeInfoWindow();mapFocus().focusPoint(row.location,'poi:'+identityKey,{onComplete:()=>openPoi(identityKey)});return;}
 walkingNavigationLayer?.clear();
 state.cameraController?.cancel();
 staticRoutes?.select(identityKey);syncAllRoutes();
  hidePoiName();
  const row = visibleRows().find((item)=>item.identityKey===identityKey)??rawMapRows().find((item)=>item.identityKey===identityKey)??allFacilityRows().find((item)=>item.identityKey===identityKey);
  if (!row) return;
 if(!row.routeEvidence?.geometry)toast('该设施暂无可绘制的已保存步行路线。');
  state.selectedPoiKey=identityKey;refreshPoiMarkerIcons();
  const node=document.createElement('div'); node.className='poi-info';
  node.style.setProperty('--facility-accent',SPECIALTY_COLORS[row.subtypeIds?.find(id=>SPECIALTY_COLORS[id])]??row.group.color);node.dataset.facilityCategory=row.group.id;
  node.dataset.facilityStatus=row.status;node.dataset.accessState=row.accessState??'';
  const metrics=popupWalkingMetrics(row.routeEvidence,decisionSeconds);node.innerHTML=facilityPopupMarkup({name:row.name||'未命名设施',...metrics});
  node.querySelector('.facility-popup-title').title=row.name||'未命名设施';
  const popupWidth=facilityPopupWidth({name:row.name,summary:metrics.distance+' · '+metrics.time},$("#map").clientWidth);node.style.setProperty("--facility-popup-width",popupWidth+"px");
  const popupAnchor=new window.BMapGL.Point(row.location.lng,row.location.lat),infoWindow=new window.BMapGL.InfoWindow(node,{width:popupWidth,height:0,enableAutoPan:false,margin:[20,20,40,20]});
  compactFacilityPopup(infoWindow,node,{map:state.map,anchor:popupAnchor,getObstacles:()=>{const boxes=visibleRows().filter(p=>p.location).map(p=>{const q=state.map.pointToPixel(new window.BMapGL.Point(p.location.lng,p.location.lat));return{left:q.x-17,top:q.y-17,width:34,height:34};}),origin=state.analysisJob?.analysis.origin.location;if(origin){const q=state.map.pointToPixel(new window.BMapGL.Point(origin.lng,origin.lat));boxes.push({left:q.x-23,top:q.y-49,width:46,height:58});}return boxes;},onLayout:()=>{state.serviceGapLayer?.refresh();walkingNavigationLayer?.refresh();}});infoWindow.addEventListener("open",()=>state.serviceGapLayer?.refresh());infoWindow.addEventListener("close",()=>state.serviceGapLayer?.refresh());
  state.map.openInfoWindow(infoWindow,popupAnchor);
}
function renderPoiList(rows) {
  $('#poi-visible-count').textContent='当前显示 '+rows.length+' 个候选地点 · '+state.prominentMarkerKeys.size+'个重点，其余为可点击小圆点';
  $('#poi-list').innerHTML=rows.slice(0,100).map((row,index)=>'<article class="poi-list-row"><button type="button" data-poi="'+index+'">'
    +categoryIcon({...row.group,iconKey:row.iconKey})+'<span><strong>'+escapeHtml(row.name||'未命名设施')+'</strong><small>'
    +escapeHtml(row.relatedSubtypes.map((sub)=>sub.label).join(' / '))+'</small><small>'+escapeHtml(routeText(row.routeEvidence))+'</small></span></button>'
    +(row.routeEvidence?'<button type="button" class="route-action" data-route="'+index+'">路线</button>':'<span class="route-unknown">步行信息暂无</span>')+'</article>').join('')
    +(rows.length>100?'<p class="helper-text">列表显示前100个，地图显示全部'+rows.length+'个；完整证据可导出JSON。</p>':'')
    +(!rows.length?'<p class="helper-text">该视图尚无召回地点。未检索或截断不等于不存在。</p>':'');
  $('#poi-list').querySelectorAll('[data-poi]').forEach((button)=>button.addEventListener('click',()=>openPoi(rows[Number(button.dataset.poi)].identityKey,{focus:true})));
  $('#poi-list').querySelectorAll('[data-route]').forEach((button)=>button.addEventListener('click',()=>routeController.show({job:state.analysisJob,row:rows[Number(button.dataset.route)]})));
}
function mapFocusMargins(){const host=$('#map'),box=host.getBoundingClientRect(),legend=$('.map-legend-panel')?.getBoundingClientRect(),width=legend?legend.width*host.clientWidth/box.width:154;return[45,35,80,Math.min(host.clientWidth*.35,Math.ceil(width)+25)];}
function mapFocus(){return state.cameraController??=createMapFocus({map:state.map,B:window.BMapGL,getMargins:mapFocusMargins,onNotice:toast});}
function rangePoints(){const job=state.analysisJob,polygons=walkingRangePolygons(job),reference=job?.geojson?.features?.find(f=>f.properties?.featureType==='degraded_reference');const rings=polygons.length?polygons.map(p=>p[0]):reference?[reference.geometry.coordinates[0]]:[];return rings.flatMap(r=>r.map(([lng,lat])=>({lng,lat})));}
function focusLayer(id,points,{fit=true,animate=true,onComplete}={}){state.focusedLayer=id;updateLayerEmphasis();refreshServiceGapLayer();if(fit)mapFocus().focus(points,id,{animate,onComplete});window.lifeCircleLegendLayers={categories:state.categoryLayers===null?'all':[...state.categoryLayers],heat:state.layerVisibility.heat,range:state.layerVisibility.range,focused:id};}
function updateLayerEmphasis(){if(!state.map)return;const active=state.focusedLayer==='range'||state.focusedLayer==='global';for(const o of state.geometryOverlays){if(o.lifeCircleRangeRole==='label'){o.setStyle?.({opacity:active?1:.65});continue;}o.setStrokeOpacity?.((o.lifeCircleBaseOpacity??.9)*(active?1:.48));o.setFillOpacity?.((o.lifeCircleBaseFill??0)*(active?1:.45));}state.heatController?.setOpacity(state.heatOpacity*(['heat','global'].includes(state.focusedLayer)?1:.6));refreshPoiMarkerIcons();specialtyLink?.redraw();window.lifeCircleLegendLayers={categories:state.categoryLayers===null?'all':[...state.categoryLayers],heat:state.layerVisibility.heat,range:state.layerVisibility.range,focused:state.focusedLayer};}
function fitCategoryCamera(options={}){if(!state.map)return;state.focusedLayer='category:'+state.activeCategoryId;const rows=visibleRows().filter(r=>state.activeCategoryId==='all'||r.memberships.includes(state.activeCategoryId)),pts=rows.map(r=>r.location),origin=state.analysisJob?.analysis?.origin?.location;if(!pts.length)pts.push(...rangePoints());if(!pts.length){toast('该图层暂无有效空间范围。');return;}if(origin)pts.push(origin);if(state.activeCategoryId==='all')pts.push(...rangePoints());focusLayer('category:'+state.activeCategoryId,pts,options);window.lifeCircleCategoryViewport={category:state.activeCategoryId,points:pts.length,...state.cameraController.getLast()};}
function restoreGlobalView(){if(!state.map||!state.analysisJob){toast('请先完成地点分析。');return;}const pts=[...allMapRows().map(r=>r.location),...rangePoints(),state.analysisJob.analysis.origin.location,...(specialtyLink?.getSelections()??[]).map(s=>s.location)];const range=specialtyLink?.getRange();if(window.lifeCircleSpecialtyDiagnostics?.scopeShown&&range?.ring)pts.push(...range.ring.map(([lng,lat])=>({lng,lat})));focusLayer('global',pts);}
function syncPoiVisibility(){const byKey=new Set(visibleRows().map(r=>r.identityKey)),specialKeys=specialtyLink?.getHiddenMarkerKeys?.()??new Set();for(const[key,{marker}]of state.categoryMarkers){if(byKey.has(key)&&!specialKeys.has(key))marker.show();else marker.hide();}refreshPoiMarkerIcons();}
function updateGapLegendState(){refreshBlindspotControls();}
function ensureGapLayer(){return state.serviceGapLayer??=createServiceGapLayer({map:state.map,B:window.BMapGL,onState:s=>{window.lifeCircleServiceGaps=s;refreshBlindspotControls();}});}
function refreshBlindspotControls(){const field=state.serviceGapLayer?.getModel(),available=field?.status==='available'&&field.models.length>0,button=$('#service-gap-toggle');if(button){button.disabled=!available;button.setAttribute('aria-disabled',String(!available));button.setAttribute('aria-pressed',String(available&&state.blindspot.visible));button.title=available?'显示或隐藏全部服务盲区':'无可展示服务盲区';}window.lifeCircleBlindspotState={visible:state.blindspot.visible};window.lifeCircleServiceGapLegend={available,enabled:available&&state.blindspot.visible,targets:field?.targets??[]};}
function refreshServiceGapLayer(){if(!state.map)return;const layer=ensureGapLayer(),rows=allFacilityRows(),range=specialtyLink?.getRange(),models=state.analysisJob?layer.getModels(state.analysisJob,rows,categoryTree):[],available=models.some(m=>m.status==='available'&&m.components.length>0);if(available&&state.blindspotInitializedId!==state.analysisJob.analysisId){state.blindspotInitializedId=state.analysisJob.analysisId;state.blindspot=reduceBlindspotState(state.blindspot,{type:'initialize'},{allowed:true});}state.blindspot=reduceBlindspotState(state.blindspot,{type:'reconcile'},{allowed:available});layer.setAll(state.analysisJob,rows,categoryTree,{rows:visibleRows(),routes:displayRoutes(),origin:state.analysisJob?.analysis.origin.location,rangeRings:window.lifeCircleSpecialtyDiagnostics?.scopeShown&&range?.ring?[range.ring]:[]},{visible:state.blindspot.visible});refreshBlindspotControls();}
function applyBlindspotAction(action){const field=state.serviceGapLayer?.getModel();state.blindspot=reduceBlindspotState(state.blindspot,action,{allowed:field?.status==='available'&&field.models.length>0});refreshServiceGapLayer();}
function applyCategoryFocus(){walkingNavigationLayer?.clear();hidePoiName();routeController.filter(state.activeCategoryId);syncPoiVisibility();state.map?.closeInfoWindow();syncAllRoutes();refreshLayerControls(state.analysisJob);refreshServiceGapLayer();$('#category-focus-hint').textContent=state.activeCategoryId==='all'?'全部设施':categories.find(g=>g.id===state.activeCategoryId)?.label??'';}
const routeOverlays=[];
const routeController=createFacilityRouteController({
  clear:()=>{for(const overlay of routeOverlays) state.map?.removeOverlay(overlay);routeOverlays.length=0;$('#route-selection-status').textContent='';},
  onStatus:(text)=>{$('#route-selection-status').textContent=text;},
  requestDetail:async(id,body,signal)=>{
    const response=await fetch('/api/analyses/'+encodeURIComponent(id)+'/route',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal});
    const data=await response.json();
    if(response.status===409){
      const fresh=await fetch('/api/analyses/'+encodeURIComponent(id)+'?view=ui',{signal});
      if(fresh.ok)renderFacilityResult(await fresh.json());
      throw new Error('路线证据已更新，请再次打开路线。');
    }
    if(!response.ok)throw new Error(data.error||'路线详情请求失败');return data;
  },
  updateJob:(job)=>renderFacilityResult(job),
  draw:(evidence,row)=>{
    const geometry=evidence.geometry;
    const lines=geometry.type==='LineString'?[geometry.coordinates]:geometry.type==='MultiLineString'?geometry.coordinates:[];
    for(const line of lines){
      const overlay=new window.BMapGL.Polyline(line.map(([lng,lat])=>new window.BMapGL.Point(lng,lat)),
        {strokeColor:row.group.color,strokeWeight:2.6,strokeOpacity:.82});
      if(state.layerVisibility.routes&&state.activeCategoryId!=='all')state.map.addOverlay(overlay);routeOverlays.push(overlay);
    }
    applyCategoryFocus();
  }
});
let staticRoutes=null,specialtyLink=null,walkingNavigationLayer=null;
function resetCategoryForSpecialty(){walkingNavigationLayer?.clear();state.activeCategoryId='all';state.categoryLayers=null;state.activeSubtypeId=null;state.activePoiKeys=null;clearDirectionHighlight();renderCategoryOptions();}
function selectWalkingRoute(identityKey){
 if(walkingNavigationLayer?.identity()===identityKey){walkingNavigationLayer.clear();staticRoutes?.select(null);state.map?.closeInfoWindow();syncAllRoutes();return;}
 const route=displayRoutes().find(r=>r.identityKey===identityKey);if(!route)return;openPoi(identityKey);walkingNavigationLayer?.select(state.analysisJob,route);
}
function displayRoutes(){const rows=allFacilityRows(),keys=new Set(visibleRows().map(p=>p.identityKey)),base=state.analysisJob?.display?(state.analysisJob.display.routes??[]).filter(r=>keys.has(r.identityKey)):rows.filter(r=>r.status==='reachable'&&r.routeEvidence?.geometry).map(r=>({...r.routeEvidence,identityKey:r.identityKey,categoryIds:r.memberships,subtypeIds:r.subtypeIds}));
 return specialtyLink?composeSpecialtyRoutes(base,rows,specialtyLink.getRoutes().filter(r=>keys.has(r.identityKey))):base;}
function syncAllRoutes(){if(!staticRoutes)return;const routes=displayRoutes();staticRoutes.set(routes,categories,state.activeCategoryId,state.categoryLayers===null?null:[...state.categoryLayers]);walkingNavigationLayer?.reconcile(state.analysisJob?.analysisId,routes);window.lifeCircleStaticRoutes={...window.lifeCircleStaticRoutes,lines:staticRoutes.count(),activeCategory:state.activeCategoryId};}
function updateRepresentativeDisplay(){syncAllRoutes();}

const coverageLabels = {
  covered: '可达', over_threshold: '超时',
  unknown_search: '检索未知', unknown_route: '路线未知',
};
function clearGeometryLayers(){walkingNavigationLayer?.clear();state.cameraController?.cancel();for(const overlay of state.geometryOverlays)state.map?.removeOverlay(overlay);state.geometryOverlays=[];state.heatSequence++;state.heatOverlay?.dispose();state.heatOverlay=null;window.lifeCircleHeatPresentation=null;}
function clearContextLayers() {
  window.clearTimeout(state.contextExpiryTimer);
  state.contextExpiryTimer = null;
  for (const kind of ['traffic', 'aoi', 'events']) {
    if (state.map) for (const overlay of state.contextOverlays[kind]) state.map.removeOverlay(overlay);
    state.contextOverlays[kind] = [];
    const toggle = $('#' + kind + '-layer-toggle');
    if (toggle) { toggle.checked = false; toggle.disabled = true; }
  }
}
function showContextLayer(kind, visible) {
  for (const overlay of state.contextOverlays[kind]) visible ? overlay.show() : overlay.hide();
  renderMapLegend();
}
function renderContextSection(job) {
  const context = job.context || {};
  for (const kind of ['traffic', 'aoi', 'events']) {
    const item = context[kind] || { status: 'permission_unverified' };
    const hasGeometry = item.status === 'available' && state.contextOverlays[kind].length > 0;
    const toggle = $('#' + kind + '-layer-toggle');
    toggle.disabled = !hasGeometry;
    if (!hasGeometry) toggle.checked = false;
    const time = item.retrievedAt ? ' · 检索 ' + new Date(item.retrievedAt).toLocaleString('zh-CN') : '';
    let detail = contextStatusLabels[item.status] || item.status;
    if (item.status === 'available') detail = kind === 'traffic'
      ? item.evaluationLabel + (hasGeometry ? ' · 可显示路段' : ' · 无路段坐标')
      : kind === 'aoi' ? '真实边界 · UID ' + item.uid
        : (item.events || []).slice(0, 3).map((event) =>
          (trafficEventLabels[event.type] || event.type) + '：' + (event.title || '未命名')
          + (event.observedAt ? '（' + event.observedAt + '）' : '')).join('；')
          + ((item.events?.length || 0) > 3 ? '等共 ' + item.events.length + ' 条' : '');
    if (kind === 'events' && item.status === 'empty') detail = '已查询，暂无交通事件';
    $('#' + kind + '-summary').textContent = detail + time;
  }
}
function drawContextLayers(job) {
  clearContextLayers();
  if (!state.map || !window.BMapGL || !job.context) { renderContextSection(job); return; }
  const B = window.BMapGL;
  const asPoint = ([lng, lat]) => new B.Point(lng, lat);
  const add = (kind, overlay) => { state.map.addOverlay(overlay); state.contextOverlays[kind].push(overlay); };
  const context = job.context;
  if (context.traffic?.status === 'available' && B.Polyline) {
    const colors = { 1: '#45c9a5', 2: '#eab969', 3: '#f28c62', 4: '#e66475' };
    for (const feature of context.traffic.geojson?.features || []) {
      const coordinates = feature.geometry?.coordinates;
      if (feature.geometry?.type !== 'LineString' || !Array.isArray(coordinates) || coordinates.length < 2) continue;
      add('traffic', new B.Polyline(coordinates.map(asPoint), {
        strokeColor: colors[feature.properties?.congestionStatus] || '#f2aa57',
        strokeWeight: 4, strokeOpacity: 0.85, enableMassClear: false,
      }));
    }
  }
  if (context.aoi?.status === 'available' && B.Polygon) {
    for (const feature of context.aoi.geojson?.features || []) {
      const geometry = feature.geometry;
      if (!['Polygon', 'MultiPolygon'].includes(geometry?.type)) continue;
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
      for (const rings of polygons) add('aoi', new B.Polygon(rings.length === 1
        ? rings[0].map(asPoint) : rings.map((ring) => ring.map(asPoint)), {
        strokeColor: '#d7a6f5', strokeWeight: 2, strokeStyle: 'dashed',
        strokeOpacity: 0.9, fillColor: '#d7a6f5', fillOpacity: 0.04, enableMassClear: false,
      }));
    }
  }
  if (context.events?.status === 'available' && B.Circle) {
    for (const event of context.events.events || []) add('events', new B.Circle(
      new B.Point(event.location.lng, event.location.lat), 48, {
        strokeColor: '#f28c62', strokeWeight: 2, strokeOpacity: 0.9,
        fillColor: '#f28c62', fillOpacity: 0.24, enableMassClear: false,
      }));
  }
  for (const kind of ['traffic', 'aoi', 'events']) {
    const toggle = $('#' + kind + '-layer-toggle');
    toggle.checked = state.contextOverlays[kind].length > 0;
  }
  renderContextSection(job);
  scheduleContextExpiry(job);
}
function scheduleContextExpiry(job) {
  const expiry = [job.context.traffic, job.context.events].map((item) => Date.parse(item?.expiresAt))
    .filter((value) => Number.isFinite(value) && value > Date.now());
  if (expiry.length) state.contextExpiryTimer = window.setTimeout(() => {
    for (const kind of ['traffic', 'events']) {
      const item = job.context[kind];
      if (item?.expiresAt && Date.parse(item.expiresAt) <= Date.now()) {
        item.status = 'stale';
        for (const overlay of state.contextOverlays[kind]) state.map.removeOverlay(overlay);
        state.contextOverlays[kind] = [];
      }
    }
    renderContextSection(job);
    renderMapLegend();
    scheduleContextExpiry(job);
  }, Math.max(0, Math.min(...expiry) - Date.now() + 50));
}
for (const kind of ['traffic', 'aoi', 'events']) {
  $('#' + kind + '-layer-toggle').addEventListener('change', (event) =>
    showContextLayer(kind, event.currentTarget.checked));
}

function envelopeFor(job){return knownReachableEnvelope(allFacilityRows(),job?.analysis?.origin);}
function drawAnalysisGeometry(job){clearGeometryLayers();if(!state.map)return;const B=window.BMapGL;refreshHeatLayer();
 if(!job)return;
 const official=['baidu_isochrone','baidu_isodistance'].includes(job.geometrySource) && (job.display?.rangeAvailable??true);
 const sampled=!official&&walkingRangePolygons(job).length?(job.geojson?.features??[]).find(f=>f.properties?.featureType==='sampled_boundary'):null;
 const reference=!sampled&&!official?(job.geojson?.features??[]).find(f=>f.properties?.featureType==='degraded_reference'):null;
 // Restore the existing real sampled/official boundary; POI heat is a separate layer.
 const envelope=null;
 window.lifeCircleEnvelope=envelope?.properties??null;
 const features=official&&state.layerVisibility.range?(job.geojson?.features??[]):(sampled||reference)&&state.layerVisibility.range?[sampled??reference]:envelope&&state.layerVisibility.envelope!==false?[envelope]:[];
 for(const feature of features){const g=feature.geometry;if(!['Polygon','MultiPolygon'].includes(g?.type))continue;
  for(const rings of g.type==='Polygon'?[g.coordinates]:g.coordinates){
   const center=job.analysis?.origin?.location;if(center&&!boundaryContainsPoint(rings[0],center))continue;
   const point=p=>new B.Point(p[0],p[1]),path=rings.length===1?rings[0].map(point):rings.map(r=>r.map(point));
   const styles=reference?[{strokeColor:'#8BA3B5',strokeWeight:2,strokeOpacity:.7}]:[{strokeColor:'#A0E8F4',strokeWeight:13,strokeOpacity:.045},{strokeColor:'#66CEE6',strokeWeight:9,strokeOpacity:.08},{strokeColor:'#42B7D8',strokeWeight:6,strokeOpacity:.15},{strokeColor:'#16ACE4',strokeWeight:3,strokeOpacity:.95}];
   for(const style of styles){const shape=new B.Polygon(path,{...style,strokeStyle:reference?'dashed':'solid',fillColor:reference?'#DDE8EF':'#6FCBF2',fillOpacity:style.strokeWeight<4?.055:0,enableParse:false,strokeLineCap:'round',strokeLineJoin:'round',enableMassClear:false});shape.lifeCircleLayer=reference?'theoretical-range-reference':official?'walking-range':sampled?'sampled-range-approximation':'poi-envelope-schematic';shape.lifeCircleRangeRole=style.strokeWeight<4?'boundary':'glow';shape.lifeCircleBaseOpacity=style.strokeOpacity;shape.lifeCircleBaseFill=style.strokeWeight<4?.055:0;state.map.addOverlay(shape);state.geometryOverlays.push(shape);}}}
 syncAllRoutes();updateLayerEmphasis();
}
function renderGeometryControls(){}

function refreshReportMeta() {
  const job=state.analysisJob;
  const observed=job?.finishedAt ?? job?.startedAt ?? job?.analysis?.observedAt;
  const date=observed?new Date(observed):null;
  const valid=date&&!Number.isNaN(date.getTime());
  $('#analysis-time').textContent=valid?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(date):'尚未分析';
  if(valid)$('#analysis-time').dateTime=date.toISOString();else $('#analysis-time').removeAttribute('datetime');

  $('#report-meta').textContent=job?.analysis?(job.analysis.walkingModelId==='walking80-v1'?'80m/min估算模型 · ':'百度返回时间口径 · ')+'分析地点：'+(job.analysis.analysisLocation?.name||job.analysis.origin.name||'地图选点')+' · 起点：'+(job.analysis.origin.name||'地图选点')+' · '+$('#analysis-time').textContent:'尚未分析';
}
function rememberAnalysis(id) {
  const url=new URL(location.href); if(id)url.searchParams.set('analysis',id);else url.searchParams.delete('analysis');
  history.replaceState(null,'',url.pathname+url.search+url.hash);
}

const specialtyHydrationRequests=new Map();
function queueLegacySpecialtyEvidence(job){if(hasCurrentServiceGapEvidence(job,categoryTree)||!['complete','partial'].includes(job.status))return;const key=job.analysisId+':'+job.score.evidenceFingerprint;let request=specialtyHydrationRequests.get(key);if(!request){if(specialtyHydrationRequests.size>=16)specialtyHydrationRequests.delete(specialtyHydrationRequests.keys().next().value);request=hydrateSpecialtyGapEvidence(job,categoryTree,async id=>{const response=await fetch('/api/analyses/'+encodeURIComponent(id));if(!response.ok)throw Error('缓存证据暂不可用');return response.json();}).then(next=>next.serviceGapEvidence);specialtyHydrationRequests.set(key,request);}request.then(projection=>{if(projection&&state.analysisJob===job&&JSON.stringify(projection)!==JSON.stringify(job.serviceGapEvidence))renderFacilityResult({...job,serviceGapEvidence:projection},{reuseLayers:true});}).catch(()=>specialtyHydrationRequests.delete(key));}
function renderFacilityResult(job,{reuseLayers=false,restoring=false}={}){
 if(!job?.analysis||!job.score)return;state.analysisJob=job;state.analysisScore=job.score;hideChartTooltip();queueLegacySpecialtyEvidence(job);
 const firstView=['complete','partial'].includes(job.status)&&state.fittedAnalysisId!==job.analysisId;
 if(firstView){state.fittedAnalysisId=job.analysisId;state.activeCategoryId='all';state.categoryLayers=null;state.focusedLayer='global';state.layerVisibility.range=true;state.blindspot={visible:false};state.blindspotInitializedId=null;}
 state.nearestMarkerKeys=new Set(job.analysis.categories.flatMap(g=>g.subtypeResults.filter(s=>s.accessStatus==='reachable').map(s=>s.nearestReachable?.identityKey)).filter(Boolean));
 if(!reuseLayers){clearPoiLayers();drawAnalysisGeometry(job);addPoiMarkers();}else drawAnalysisGeometry(job);
 const view=reportPresentation(job,categoryTree,{scale:100});
 const display=job.display, missingPaths=(display?.facilities??[]).filter(p=>p.displayStatus==='reachable'&&!p.drawable);
 const pathNote=missingPaths.length?' '+missingPaths.length+'个可达设施缺少有效完整折线，暂未绘制路线：'+missingPaths.map(p=>p.name).join('、')+'。':'';
 const note=[job.searchDiagnostics?.message,walkingRangeNotice(job)+pathNote].filter(Boolean).join(' ');
 $('#results-note').textContent=note;$('#results-note').hidden=!note;
 const all=allFacilityRows(),previous=$('#report-categories'),opened=new Set([...previous.querySelectorAll('details[open]')].map(n=>n.dataset.detailCategory));
 previous.innerHTML=facilityDetailList(view,all,job.analysis.origin,categoryIcon,opened.size?opened:new Set(['education']));
 previous.querySelectorAll('details').forEach(n=>n.querySelector('summary').addEventListener('click',()=>{const id=n.dataset.detailCategory;setTimeout(()=>{if(n.open){state.activeCategoryId=id;state.categoryLayers=new Set([id]);state.activeSubtypeId=null;state.activePoiKeys=null;renderCategoryOptions();applyCategoryFocus();refreshHeatLayer();fitCategoryCamera();}},0);}));
 previous.querySelectorAll('.facility-detail-track').forEach(track=>{track.setAttribute('role','button');track.tabIndex=0;const activate=event=>{event.preventDefault();event.stopPropagation();focusReportCategory(track.closest('[data-detail-category]').dataset.detailCategory);};track.addEventListener('click',activate);track.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key))activate(event);});});
 previous.querySelectorAll('[data-detail-poi]').forEach(button=>button.addEventListener('click',()=>{const row=all.find(p=>p.identityKey===button.dataset.detailPoi);if(!row)return;focusReportCategory(button.closest('[data-detail-category]').dataset.detailCategory,null,null,{fit:false});openPoi(row.identityKey,{focus:true});}));
 if(state.map){specialtyLink??=createSpecialtyMapLink({map:state.map,B:window.BMapGL,cards:$('#blind-list'),legend:$('#map-diagnostic-legend'),detail:$('#map-diagnostic-detail'),getRows:allFacilityRows,onPoi:openPoi,onClosePoi:()=>state.map.closeInfoWindow(),onModeChange:resetCategoryForSpecialty,onClusterVisibility:syncPoiVisibility,onDim:(key,active)=>{state.diagnosticDim=active;state.diagnosticPoiKeys=Array.isArray(key)?key:[key].filter(Boolean);refreshPoiMarkerIcons();},onRouteVisibility:()=>{$('#route-flow-canvas').style.opacity='1';syncAllRoutes();},onRestore:()=>{applyCategoryFocus();state.heatController?.setForeground(heatForeground());},getFocus:()=>state.focusedLayer,onFocus:({id,points,fit=true,onComplete})=>focusLayer(id,points,{fit,onComplete}),onNotice:toast});specialtyLink.update(job,categoryTree,state.priorities);$('#map-diagnostic-legend').hidden=false;}
 $('#report-empty').hidden=true;$('#report-loading').hidden=true;$('#report-ready').hidden=false;$('#cancel-analysis').hidden=!state.activeAnalysisId;
 $('#report-state-label').textContent='生活圈评估报告';$('#map-layer-status').textContent='步行15分钟';applyCategoryFocus();renderMapLegend();$('#map-analysis-legend').hidden=false;
 if(!state.activeAnalysisId)setState('complete');setReportOpen(true);refreshRunButton();refreshReportMeta();updateReportCharts(job);refreshServiceGapReport(job);if(['complete','partial'].includes(job.status)){rememberAnalysis(job.analysisId);if(firstView){refreshLayerControls(job);renderCategoryOptions();applyCategoryFocus();fitCategoryCamera({animate:!restoring});}}recordMapStage('analysis-layers-ready');
}

const unknownReasonLabels={search_incomplete:'检索未完整',invalid_candidate:'地点坐标异常',classification_pending:'分类信息暂缺',
  candidate_limit_reached:'候选预算截断',route_incomplete:'路线未完整',destination_variants_unverified:'入口信息暂缺'};
function updateAnalysisProgress(job) {
  const progress = job.progress || {};
  const names = {
    queued: '排队等待', official_isochrone: '获取官方等时圈',
    matrix_walking_sampling:'正在计算36方向步行边界',
    radial_boundary_sampling:'采样1200米路网边界',walking_sampling: '计算步行采样近似范围', coarse: '路网粗采样',
    refinement: '边界加密采样', reachable_network: '整理15分钟可达路网', facilities: '整理设施',
    context: '整理分析结果',group_search:'检索六大类设施',circle_poi_routes:'计算设施的真实步行路径',reference_walking_sampling:'正在采样真实步行路径', subtype_search:'检索设施', subtype_routes:'计算步行路线',
  };
  const detail = (names[progress.phase] || '正在分析')
    + (Number.isFinite(progress.total) && progress.total > 0
      ? ' · ' + progress.completed + '/' + progress.total : '');
  $('#loading-title').textContent = names[progress.phase] || '正在分析';
  $('#loading-detail').textContent = detail;
  reportStates.update(progress);
  setStatus(detail);
}
async function runAnalysis() {
  clearTimeout(originRecalcTimer);
  if(categoryTree.version!=='facility-categories-v8'){const response=await fetch('/api/facility-categories');if(!response.ok){toast('新版分类加载失败');return;}categoryTree=paletteTree(await response.json());categories=categoryTree.categories;state.priorityModel=null;renderPriorityControls();}
  if (!state.center) return;
  if (!state.categoryReady) return;
  if (state.activeAnalysisId) invalidateExistingAnalysis();
  const runSequence = ++state.runSequence;
  state.analysisJob = null;
  state.analysisScore = null;
  state.activeCategoryId = 'all';
  renderCategoryOptions();
  rememberAnalysis(null);
  refreshReportMeta();
  routeController.clear();
  staticRoutes?.clear();
  clearPoiLayers();
  clearGeometryLayers();
  clearContextLayers();
  $('#report-empty').hidden = true;
  $('#report-ready').hidden = true;
  $('#report-loading').hidden = false;reportStates.update({phase:'queued'});
  $('#cancel-analysis').hidden = true;
  $('#map-analysis-legend').hidden = true;
  $('#run-analysis').querySelector('span').textContent = '正在分析…';
  setState('analyzing');
  setStatus('正在创建路线分析任务…');
  refreshRunButton();
  const center = { ...state.center };

  const body = makeFacilityTask({
    categoryTree, priorities: state.priorities,
    analysisLocation: { id: state.originUid ? String(state.originUid) : 'map-'+center.lng.toFixed(6)+'-'+center.lat.toFixed(6),
      source:state.originSource,uid:state.originUid,name:state.selectedName,address:state.selectedAddress,location:center },
    origin:state.walkingOrigin ?? {id:state.originUid?String(state.originUid):'map-'+center.lng.toFixed(6)+'-'+center.lat.toFixed(6),source:state.originSource,uid:state.originUid,name:state.selectedName,address:state.selectedAddress,location:center},
    walkingModelId:'walking80-v1',samplingConfirmed:true
  });
  try {
    const response = await fetch('/api/analyses', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const created = await response.json();
    if (!response.ok) throw new Error(created.error || '无法创建分析任务');
    if (runSequence !== state.runSequence) {
      fetch('/api/analyses/' + encodeURIComponent(created.analysisId) + '/cancel',
        { method: 'POST' }).catch(() => {});
      return;
    }
    state.activeAnalysisId = created.analysisId;
    $('#cancel-analysis').hidden = false;
    setReportOpen(true);
    let job = created;
    const pollDeadline = Date.now() + 630000;
    while (runSequence === state.runSequence) {
      if (Date.now() > pollDeadline) throw new Error('分析等待超时，请稍后重试。');
      const result = await fetch('/api/analyses/' + encodeURIComponent(created.analysisId)+'?view=ui');
      if (!result.ok) throw new Error('分析任务查询失败');
      job = await result.json();
      if (runSequence !== state.runSequence) return;
      if(job.analysis && job.score && (!state.analysisJob || state.analysisJob.geometrySource!==job.geometrySource)) renderFacilityResult(job);
      updateAnalysisProgress(job);
      if (['complete', 'partial', 'failed', 'cancelled'].includes(job.status)) break;
      await new Promise((resolve) => window.setTimeout(resolve, 700));
    }
    if (runSequence !== state.runSequence) return;
    state.activeAnalysisId = null;
    $('#cancel-analysis').hidden = true;
    if (!['complete', 'partial'].includes(job.status) || !job.analysis || !job.score) {
      throw new Error(job.error || '分析未能完成，请稍后重试。');
    }
    state.activeCategoryId='all';renderCategoryOptions();
    renderFacilityResult(job);
    if (JSON.stringify(job.score.priorities)!==JSON.stringify(state.priorities)) await rescoreCurrent();
    $('#run-analysis').querySelector('span').textContent = '重新评估分析';
    setStatus(job.status === 'partial' ? '评估完成 · 部分信息暂无' : '评估完成 · 路线已获取',
      job.status === 'partial' ? 'error' : 'success');
  } catch (error) {
    if (runSequence !== state.runSequence) return;
    if (state.activeAnalysisId) fetch('/api/analyses/' + encodeURIComponent(state.activeAnalysisId) + '/cancel',
      { method: 'POST' }).catch(() => {});
    state.activeAnalysisId = null;
    $('#cancel-analysis').hidden = true;
    $('#report-loading').hidden = true;
    $('#report-empty').hidden = false;
    $('#report-empty strong').textContent = '分析未完成';
    $('#report-empty p').textContent = error.message;
    $('#run-analysis').querySelector('span').textContent = '重试评估';
    setState('selected');
    setStatus(error.message, 'error');
    refreshRunButton();
  }
}
async function initialize() {
  const restoreId=new URL(location.href).searchParams.get('analysis');
  let prefetchedJob=null;
  const restoredJob=mapBootstrap.report.then(job=>{prefetchedJob=job;return job;});
  const services = mapBootstrap.services;
  state.sdkCorePromise = services.map;
  // Category discovery is independent of the critical SDK loading path.
  const categoryReady=mapBootstrap.category.then(tree=>{
    if(!['facility-categories-v6','facility-categories-v7','facility-categories-v8'].includes(tree.version)||tree.categories?.length!==6
      ||tree.categories.flatMap((group)=>group.subtypes).length!==(['facility-categories-v7','facility-categories-v8'].includes(tree.version)?18:17))throw new Error('设施分类版本不一致，请重启本地服务');
    categoryTree=paletteTree(tree);categories=categoryTree.categories;state.categoryReady=true;
    state.priorities=Object.fromEntries(categories.map((group)=>[group.id,tree.version==='facility-categories-v8'?2:1]));
    renderCategoryOptions();renderPriorityControls();renderMapLegend();refreshRunButton();
  }).catch((error)=>{state.categoryReady=false;setStatus(error.message,'error');});

  // Backend status cannot block the basemap or JSAPI place search.
  services.health.then((health) => {
    state.serviceReady = Boolean(health.placeSearchConfigured);
    recordMapStage('backend-ready');
    $('#connection').textContent = state.serviceReady ? '前后端服务已连接' : '后端设施服务未配置';
    $('#connection').dataset.ready = String(state.serviceReady);
    if (!state.center) $('#analysis-status').textContent = state.serviceReady
      ? '请先搜索并选择中心点' : '服务端地点检索未配置';
    refreshRunButton();
  }).catch(() => {
    state.serviceReady = false;
    $('#connection').textContent = '本地分析服务暂不可用';
    $('#connection').dataset.ready = 'false';
    $('#analysis-status').textContent = '本地分析服务暂不可用，地图仍可使用。';
    refreshRunButton();
  });
  renderCategoryOptions();
  renderPriorityControls();
  renderMapLegend();
  refreshTravelSelection();
 const B = await services.map;
  state.map = new B.Map('map', {
    enableIconClick: false,
    enableWheelZoom: true,
    enableDragging: true,
    fixCenterWhenResize: true,
    enableAutoResize: true,
    forceRenderType: 'webgl',
    displayOptions: { poi: true, poiText: true, poiIcon: true, building: false, overlay: true },
  });
  recordMapStage('map-created');
  state.mapThemeRuntime = createMapThemeRuntime(state.map, {
    styleIds: MAP_STYLE_IDS, waitForBasemap:false, fallbackToDefault:false,
    onTilesReady: () => recordMapStage('tiles-ready'),
    onState: ({ status, reason,styleApplied }) => {
      window.lifeCircleMapStatus = { status, reason };
      // Style response alone can precede a blank SDK grid. Require actual styled
      // tiles as well; cache the response rather than fake readiness.
      const visible=status==='applied';
      $('#map-custom-placeholder').hidden=visible;$('#map').classList.toggle('is-custom-pending',!visible);
      if(visible){requestAnimationFrame(()=>requestAnimationFrame(()=>{recordMapStage('map-first-visible');firstPaintQueue.flush();}));if(state.analysisJob)firstPaintQueue.enqueue('heat',refreshHeatLayer);}
      if(status==='waiting_for_styled_tiles'||status==='applied')recordMapStage('custom-style-ready');
      if(status==='applied')recordMapStage('custom-map-ready');
      const failed = ['fallback', 'style_error', 'basemap_timeout'].includes(status);
      if(failed)firstPaintQueue.flush();
      $('#map-load-notice').hidden = !failed;
      $('#map-load-message').textContent = status === 'basemap_timeout'
        ? '地图资源加载较慢，请检查网络后刷新。'
        : status === 'style_error' ? '地图主题暂不可用，请稍后重试。'
          : '自定义地图样式暂不可用，请点击重试。';
      $('#retry-map-style').textContent = status === 'basemap_timeout' ? '重新加载' : '重试样式';
      if (!state.analysisJob) $('#map-layer-status').textContent = status === 'fallback' ? '基础底图'
        : status === 'applied' ? '底图就绪' : status === 'basemap_timeout' ? '底图待加载' : '底图加载中';
    },
  });
  $('#retry-map-style').addEventListener('click', () => {
    const current=state.mapThemeRuntime.getState();
    if(current.status==='basemap_timeout'&&!current.basemapRendered)window.location.reload();
    else state.mapThemeRuntime.retry();
  });
  window.addEventListener('pagehide', (event) => { if (!event.persisted){state.mapThemeRuntime?.dispose();state.heatController?.destroy();state.serviceGapLayer?.destroy();} });
  applyMapTheme(state.mapTheme);
  const initialPoint=prefetchedJob?.analysis?.origin?.location??fallbackCenter;
  let initialView=null;
  if(prefetchedJob?.analysis&&prefetchedJob?.score&&['complete','partial'].includes(prefetchedJob.status)&&prefetchedJob.categoryMappingVersion===categoryTree.version){
    try{const rows=mapPresentationRows(facilityViewRows(prefetchedJob.analysis,categoryTree,'all',prefetchedJob.display),prefetchedJob,categories,'all').filter(r=>!r.classificationUncertain),points=[...rows.map(r=>r.location),...walkingRangePolygons(prefetchedJob).flatMap(rings=>rings[0].map(([lng,lat])=>({lng,lat}))),initialPoint];
      initialView=state.map.getViewport(points.map(p=>new B.Point(p.lng,p.lat)),{margins:mapFocusMargins()});if(!initialView?.center||!Number.isFinite(initialView.zoom))initialView=null;
    }catch{initialView=null;}
  }
  state.map.centerAndZoom(initialView?.center??new B.Point(initialPoint.lng,initialPoint.lat),initialView?Math.min(18,initialView.zoom):16);
  if(initialView)recordMapStage('initial-view-final');
  recordMapStage('view-requested');
  state.map.enableScrollWheelZoom(true);
  state.mapReady = true;
  window.lifeCircleMapInstance=state.map;
  // GL markers can recreate their DOM/image on repaint. Use actual projected marker positions
  // as a stable, frame-coalesced name-only hover fallback; never changes selection or calls APIs.
  let nameFrame=0,namePointer=null;
  $('#map').addEventListener('pointermove',event=>{
    const r=$('#map').getBoundingClientRect();namePointer={x:event.clientX-r.x,y:event.clientY-r.y};
    if(nameFrame)return;nameFrame=requestAnimationFrame(()=>{nameFrame=0;if(state.draggingOrigin||!namePointer)return;
      let nearest=null,distance=14;const hoverRows=specialtyLink?.getSelection()?specialtyLink.getSelections():visibleRows();for(const row of hoverRows){const pixel=markerProject(row.location);if(!pixel)continue;const d=Math.hypot(pixel.x-namePointer.x,pixel.y-namePointer.y);if(d<distance){nearest=row;distance=d;}}
      nearest?showPoiName(nearest):hidePoiName();
    });
  });
  $('#map').addEventListener('pointerleave',()=>{namePointer=null;hidePoiName();});
  window.addEventListener('pagehide',()=>{if(nameFrame)cancelAnimationFrame(nameFrame);},{once:true});
  staticRoutes=createSelectedRouteViewer({map:state.map,B,canvas:$('#route-flow-canvas'),onClick:selectWalkingRoute,getOrigin:()=>state.analysisJob?.analysis.origin,getPulseOrigin:()=>state.draggingOrigin?null:(state.walkingOrigin?.location??state.analysisJob?.analysis?.origin?.location??state.center),getMaskPoints:()=>{const keys=new Set(visibleRows().map(r=>r.identityKey));return[...state.categoryMarkers.values()].filter(i=>keys.has(i.row.identityKey)).map(i=>({...i.row.location,radius:Math.max(6,(i.marker.getIcon?.()?.size?.width??30)/2+1)}));},onState:s=>{window.lifeCircleStaticRoutes={...s,activeCategory:state.activeCategoryId};}});
  window.lifeCircleRouteFlow={getSnapshot:()=>staticRoutes?.getSnapshot()};
  walkingNavigationLayer=createWalkingNavigationLayer({map:state.map,B,request:async(id,body,signal)=>{const response=await fetch('/api/analyses/'+encodeURIComponent(id)+'/walking-navigation',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal});const result=await response.json();if(!response.ok)throw Error(result.error??'导航步骤暂不可用');return result;},getObstacles:()=>[state.analysisJob?.analysis.origin.location,...visibleRows().map(r=>r.location)].filter(Boolean).map(p=>{const q=state.map.pointToPixel(new B.Point(p.lng,p.lat));return{left:q.x-16,top:q.y-20,width:32,height:40};}),onState:s=>{window.lifeCircleWalkingNavigation=s;}});
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&walkingNavigationLayer?.identity()){walkingNavigationLayer.clear();staticRoutes?.select(null);syncAllRoutes();}});
  window.addEventListener('pagehide',()=>walkingNavigationLayer?.destroy(),{once:true});
  window.addEventListener('pagehide',()=>staticRoutes?.dispose(),{once:true});
  mapRuntime.searchReady().then(() => {
    state.placeSearchReady = true;
  }).catch(() => { state.placeSearchReady = false; });
  state.map.addEventListener('click', event=>{
    if(state.draggingOrigin || performance.now()<ignoreMapClickUntil)return;
    const point=event.latlng ?? event.latLng ?? event.point;
    if(!Number.isFinite(point?.lng)||!Number.isFinite(point?.lat))return;
    if(!state.pickingWalkingOrigin){selectCenter(point,'地图选点');return;}
    if(!state.center){toast('请先选择分析地点。');return;}
    setWalkingOrigin(point,{source:'map_click',name:'独立步行起点'});
  });
  for (const eventName of ['zoomend', 'moveend', 'heading_changed', 'resize', 'load']) {
    state.map.addEventListener(eventName, updateMapNavigation);state.map.addEventListener(eventName,positionOriginPulse);
  }
  state.map.addEventListener('zoomend',refreshPoiMarkerIcons);
  for(const event of ['movestart','zoomstart','moveend','zoomend'])state.map.addEventListener(event,()=>hidePoiName());
  for(const event of ['moving','zoomstart','dragstart'])state.map.addEventListener(event,()=>{$('#origin-pulse').hidden=true;});
  // Container size can change without a window event (remote viewport, CSS reflow, zoom).
  const layoutObserver = observeMapLayout({ map: state.map, container: $('#map'), onResize(size) {
    updateMapNavigation();
    positionOriginPulse();
    refreshPoiMarkerIcons();
    window.lifeCircleViewport = { ...size, visualViewportScale: window.visualViewport?.scale ?? 1 };
  } });
  window.addEventListener('pagehide', () => layoutObserver.dispose(), { once: true });
  updateMapNavigation();
  $('#zoom-in').addEventListener('click', () => state.map.zoomIn());
  $('#zoom-out').addEventListener('click', () => state.map.zoomOut());
  $('#run-analysis').disabled = true;
  refreshRunButton();
  if ($('#location-search').value.trim()) searchAddress($('#location-search').value);
  await categoryReady;
  if(restoreId && state.categoryReady)await restoreExistingReport(restoreId,await restoredJob);
}

let searchTimer;
let originSearchTimer,originRecalcTimer,originSearchSequence=0,ignoreMapClickUntil=0;
function setWalkingOrigin(point,metadata={},options={}) {
  if(!state.center||!Number.isFinite(point?.lng)||!Number.isFinite(point?.lat))return;
  const recalculate=options.recalculate ?? Boolean(state.analysisJob||state.activeAnalysisId);
  const location={lng:Number(point.lng),lat:Number(point.lat)},previous=state.walkingOrigin;
  if(previous&&previous.location.lng===location.lng&&previous.location.lat===location.lat&&(previous.uid??null)===(metadata.uid??null)&&!recalculate)return;
  invalidateExistingAnalysis();
  state.walkingOrigin={id:metadata.uid??'walking-'+location.lng.toFixed(6)+'-'+location.lat.toFixed(6),source:metadata.source??'map_click',
    uid:metadata.uid??null,name:metadata.name??'独立步行起点',address:metadata.address??'',location};
  state.pickingWalkingOrigin=false;$('#pick-origin-map').setAttribute('aria-pressed','false');$('#origin-editor').hidden=true;$('#set-walking-origin').setAttribute('aria-expanded','false');
  $('#origin-search').value=state.walkingOrigin.name;showCenterLayers();refreshRunButton();
  clearTimeout(originRecalcTimer);
  if(recalculate){setStatus('步行起点已改变，正在重新评估。');originRecalcTimer=setTimeout(()=>runAnalysis(),250);}
  else setStatus('步行起点已设置 · 可开始评估');
}
async function searchWalkingOrigin(query) {
  const sequence=++originSearchSequence,box=$('#origin-search-results');box.hidden=true;box.replaceChildren();$('#origin-search-message').textContent='';if(!query.trim())return;
  try{await state.sdkCorePromise;await mapRuntime.searchReady();if(sequence!==originSearchSequence)return;
    const search=new window.BMapGL.LocalSearch(state.map,{pageCapacity:8,renderOptions:{map:null,autoViewport:false},onSearchComplete(results){
      if(sequence!==originSearchSequence)return;const items=[];
      for(let i=0;i<Math.min(8,results?.getCurrentNumPois?.()??0);i++){const p=results.getPoi(i);if(p?.point&&Number.isFinite(p.point.lng)&&Number.isFinite(p.point.lat))items.push(p);}
      box.innerHTML=items.map((p,i)=>'<button type="button" class="search-result" data-origin-result="'+i+'"><strong>'+escapeHtml(p.title||'地点')+'</strong><small>'+escapeHtml(p.address||'')+'</small></button>').join('');box.hidden=!items.length;
      if(!items.length)$('#origin-search-message').textContent='没有匹配起点，可在地图点击或拖动水滴。';
      box.querySelectorAll('[data-origin-result]').forEach(button=>button.addEventListener('click',()=>{const p=items[Number(button.dataset.originResult)];originSearchSequence++;box.hidden=true;setWalkingOrigin(p.point,{source:'baidu_poi',uid:p.uid??null,name:p.title,address:p.address});}));
    }});search.search(query.trim());
  }catch(error){if(sequence===originSearchSequence)$('#origin-search-message').textContent=error.message;}
}
$('#set-walking-origin').addEventListener('click',()=>{if(!state.center){toast('请先选择分析地点。');return;}const open=$('#origin-editor').hidden;$('#origin-editor').hidden=!open;$('#set-walking-origin').setAttribute('aria-expanded',String(open));if(open)$('#origin-search').focus();});
$('#pick-origin-map').addEventListener('click',()=>{if(!state.center)return;state.pickingWalkingOrigin=true;$('#pick-origin-map').setAttribute('aria-pressed','true');$('#origin-editor').hidden=true;$('#set-walking-origin').setAttribute('aria-expanded','false');toast('请在地图点击实际步行起点。');});
$('#origin-search').addEventListener('input',event=>{clearTimeout(originSearchTimer);originSearchSequence++;$('#origin-search-results').hidden=true;originSearchTimer=setTimeout(()=>searchWalkingOrigin(event.target.value),360);});
$('#origin-search').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();clearTimeout(originSearchTimer);searchWalkingOrigin(event.target.value);}});
$('#origin-search-submit').addEventListener('click',()=>{clearTimeout(originSearchTimer);searchWalkingOrigin($('#origin-search').value);});
$('#reset-walking-origin').addEventListener('click',()=>{if(!state.walkingOrigin)return;const recalculate=Boolean(state.analysisJob||state.activeAnalysisId);invalidateExistingAnalysis();state.walkingOrigin=null;state.pickingWalkingOrigin=false;showCenterLayers();refreshRunButton();clearTimeout(originRecalcTimer);if(recalculate)originRecalcTimer=setTimeout(()=>runAnalysis(),250);});
$('#location-search').addEventListener('input', (event) => {
  refreshClearButton();
  clearTimeout(searchTimer);
  state.searchSequence += 1;
  $('#search-results').hidden = true;
  $('#search-results').replaceChildren();
  $('#search-message').textContent = '';
  const query = event.target.value.trim();
  if (!query) {
    return;
  }
  searchTimer = window.setTimeout(() => searchAddress(query), 360);
});
$('#location-search').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); clearTimeout(searchTimer); searchAddress(event.currentTarget.value); }
  if (event.key === 'Escape') { clearTimeout(searchTimer); state.searchSequence += 1; $('#search-results').hidden = true; }
});
$('#clear-search').addEventListener('click', () => {
  clearTimeout(searchTimer);
  state.searchSequence += 1;
  $('#location-search').value = '';refreshClearButton();
  $('#search-results').hidden = true;
  $('#search-results').replaceChildren();
  $('#search-message').textContent = '';
  if (state.center) clearSelection();
  $('#location-search').focus();
});
$('#remove-location').addEventListener('click', clearSelection);
$('#priority-toggle').addEventListener('click', () => {
  const panel = $('#priority-panel');
  panel.hidden = !panel.hidden;
  $('#priority-toggle').setAttribute('aria-expanded', String(!panel.hidden));
});
$('#reset-priorities').addEventListener('click', () => {
  state.priorityModel = categoryTree.version==='facility-categories-v8'?p123Default(categories.map(g=>g.id)):equalPriorityTiers(categories.map(g=>g.id));
  renderPriorityControls();
  handleScoreSelectionChange();
});
$('#cancel-analysis').addEventListener('click', () => {
  invalidateExistingAnalysis();
  setStatus('分析已取消。');
});
$('#run-analysis').addEventListener('click', runAnalysis);
document.addEventListener('click', (event) => {
  if (!event.target.closest('.search-section')) $('#search-results').hidden = true;
});

initialize().catch((error) => {
  $('#connection').textContent = '服务连接异常';
  $('#connection').dataset.ready = 'false';
  $('#analysis-status').textContent = error.message;
  $('#analysis-status').dataset.tone = 'error';
  toast(error.message);
});

$('#search-submit').addEventListener('click',()=>{
  clearTimeout(searchTimer);searchAddress($('#location-search').value);
});


async function restoreExistingReport(id,preloaded=null) {
  if(!/^fa-[0-9a-f-]+$/.test(id??''))return;
  try{
    let job=preloaded;
    if(!job){const response=await fetch('/api/analyses/'+encodeURIComponent(id)+'?view=ui');if(!response.ok)throw new Error('此前任务已过期，请重新评估。');job=await response.json();}
    if(!job.analysis||!job.score||!['complete','partial'].includes(job.status))return;
    if(job.categoryMappingVersion!==categoryTree.version){const response=await fetch('/api/facility-categories?version='+encodeURIComponent(job.categoryMappingVersion));if(!response.ok)throw new Error('历史分类无法恢复。');categoryTree=paletteTree(await response.json());categories=categoryTree.categories;}
    job=await hydrateSpecialtyGapEvidence(job,categoryTree,async auditId=>{const response=await fetch('/api/analyses/'+encodeURIComponent(auditId));if(!response.ok)throw Error('缓存证据暂不可用');return response.json();}).catch(()=>job);
    const weights=job.score.priorities,positive=[...new Set(Object.values(weights).filter(n=>n>0))].sort((a,b)=>b-a);
    state.priorityModel=categoryTree.version==='facility-categories-v8'?{order:categories.map(g=>g.id),levels:Object.fromEntries(categories.map(g=>[g.id,4-weights[g.id]]))}:{tiers:positive.map(weight=>categories.filter(g=>weights[g.id]===weight).map(g=>g.id)),excluded:categories.filter(g=>weights[g.id]===0).map(g=>g.id)};
    renderPriorityControls();state.priorities={...weights};
    const origin=job.analysis.analysisLocation ?? job.analysis.origin;
    selectCenter(new window.BMapGL.Point(origin.location.lng,origin.location.lat),origin.name,origin.address,{source:origin.source,uid:origin.uid,preserveViewport:true});
    state.walkingOrigin=job.analysis.origin.location.lng!==origin.location.lng || job.analysis.origin.location.lat!==origin.location.lat || (job.analysis.origin.uid ?? null)!==(origin.uid ?? null)?job.analysis.origin:null;showCenterLayers();
    renderFacilityResult(job,{restoring:true});rememberAnalysis(job.analysisId);
    $('#run-analysis').querySelector('span').textContent='重新评估分析';
    setStatus('已恢复同一任务证据 · 未重新查询','success');
  }catch(error){toast(error.message);}
}

$('#envelope-toggle').addEventListener('click',()=>{state.layerVisibility.envelope=state.layerVisibility.envelope===false;drawAnalysisGeometry(state.analysisJob);refreshLayerControls(state.analysisJob);});
$('#heat-toggle').addEventListener('click',()=>{if(!state.analysisJob){toast('请先完成地点分析。');return;}const model=poiFacilityHeatData(state.analysisJob,allMapRows(),state.activeCategoryId);if(!state.layerVisibility.heat&&!model.data?.length){toast('该分类暂无确认可达设施热力。');return;}state.layerVisibility.heat=!state.layerVisibility.heat;drawAnalysisGeometry(state.analysisJob);if(state.layerVisibility.heat)focusLayer('heat',model.data.map(p=>({lng:p.geometry.coordinates[0],lat:p.geometry.coordinates[1]})));else{state.focusedLayer='global';updateLayerEmphasis();refreshServiceGapLayer();}});

$('#range-toggle').addEventListener('click',()=>{const pts=rangePoints();if(!pts.length){toast('步行范围暂无完整有效证据。');return;}state.layerVisibility.range=!state.layerVisibility.range;drawAnalysisGeometry(state.analysisJob);refreshLayerControls(state.analysisJob);if(state.layerVisibility.range)focusLayer('range',pts);else{state.focusedLayer='global';updateLayerEmphasis();refreshServiceGapLayer();}});
$('#service-gap-toggle').addEventListener('click',()=>applyBlindspotAction({type:'visibility',visible:!state.blindspot.visible}));
$('#recenter-map').addEventListener('click',()=>{
  if(!state.center||!state.map)return;
  const actual=state.walkingOrigin?.location ?? state.center;const point=new window.BMapGL.Point(actual.lng,actual.lat);
  if(typeof state.map.panTo==='function')state.map.panTo(point);
  else state.map.centerAndZoom(point,state.map.getZoom());
});

function refreshClearButton(){$('#clear-search').hidden=!$('#location-search').value.length;}
refreshClearButton();

function heatForeground(){const special=specialtyLink?.getSelection(),specials=specialtyLink?.getSelections()??[];return{rows:special?visibleRows().filter(r=>specials.some(s=>s.identityKey===r.identityKey)):visibleRows(),routes:special?specials.filter(s=>s.geometry).map(s=>({geometry:s.geometry})):[...(state.activeCategoryId==='all'?[]:displayRoutes()),...(state.directionSelection?.geometry?[{geometry:state.directionSelection.geometry}]:[])],highlights:[...specials.filter(s=>s.location).map(s=>s.location),...(state.directionSelection?[state.directionSelection.location]:[])],origin:state.analysisJob?.analysis?.origin?.location};}
function clearDirectionHighlight(){for(const o of state.directionOverlays)state.map?.removeOverlay(o);state.directionOverlays=[];state.directionSelection=null;window.lifeCircleDirectionSelection=null;state.heatController?.setForeground(heatForeground());}
function focusReportCategory(id,keys=null,subtype=null,{fit=true}={}){clearDirectionHighlight();state.activeCategoryId=id;state.categoryLayers=new Set([id]);state.activeSubtypeId=subtype;state.activePoiKeys=keys?new Set(keys):null;specialtyLink?.setCategoryScope([id]);renderCategoryOptions();applyCategoryFocus();refreshHeatLayer();if(fit)fitCategoryCamera();
 const group=$('#report-categories').querySelector('[data-detail-category="'+id+'"]');if(group){group.open=true;if(subtype)group.querySelector('[data-detail-subtype="'+subtype+'"]')?.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});}}
function highlightDirection(d){clearDirectionHighlight();const B=window.BMapGL,point=d.sample?.location;if(!point||!state.map)return;
 const marker=new B.Circle(new B.Point(point.lng,point.lat),18,{fillColor:'#159bcf',fillOpacity:.35,strokeColor:'#137ab1',strokeWeight:3});marker.lifeCircleLayer='selected-direction-sample';state.map.addOverlay(marker);state.directionOverlays.push(marker);
 const origin=state.analysisJob.analysis.origin.location,geometry=d.sample.geometry,lines=geometry?.type==='LineString'?[geometry.coordinates]:geometry?.type==='MultiLineString'?geometry.coordinates:[];
 const valid=lines.length&&lines.every(l=>l.length>=2&&l.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90));
 const near=(p,q)=>p&&Math.hypot((p[0]-q.lng)*96000,(p[1]-q.lat)*111320)<=150;
 if(valid&&near(lines[0][0],origin)&&near(lines.at(-1).at(-1),point))for(const l of lines){const path=new B.Polyline(l.map(([lng,lat])=>new B.Point(lng,lat)),{strokeColor:'#157fbc',strokeWeight:4,strokeOpacity:.85});state.map.addOverlay(path);state.directionOverlays.push(path);}else toast('已高亮真实方向采样点；该样本未提供有效路线折线。');
 const drawable=Boolean(valid&&near(lines[0][0],origin)&&near(lines.at(-1).at(-1),point));state.directionSelection={location:point,geometry:drawable?geometry:null};state.heatController?.setForeground(heatForeground());state.map.setViewport([new B.Point(origin.lng,origin.lat),new B.Point(point.lng,point.lat)],{margins:[85,85,85,85]});window.lifeCircleDirectionSelection={sector:d.sector,bearing:d.bearing,location:point,evidenceId:d.sample.evidenceId,geometryDrawn:drawable};}
let serviceGapReportModule=null,serviceGapReportSequence=0;
function refreshServiceGapReport(job){const sequence=++serviceGapReportSequence;firstPaintQueue.enqueue('service-gap-summary',async()=>{try{const M=await(serviceGapReportModule??=import('./service-gap-stacked-report.js?v=a86'));if(sequence!==serviceGapReportSequence||job!==state.analysisJob)return;const rows=allFacilityRows(),models=state.map?ensureGapLayer().getModels(job,rows,categoryTree):undefined;M.renderServiceGapReport($('#service-gap-report-content'),job,rows,categoryTree,models);refreshServiceGapLayer();}catch(error){if(sequence===serviceGapReportSequence){const node=$('#service-gap-report-content');node.gapStackCleanup?.();node.innerHTML='';node.closest('.service-gap-report-section').hidden=true;window.lifeCircleServiceGapSummary={status:'error',reason:error.message};}}});}
let reportChartModule=null;
function updateReportCharts(job){const sequence=++state.reportChartSequence;firstPaintQueue.enqueue('charts',()=>{reportChartModule??=import('./report-charts-a37.js?v=a43-20261013');reportChartModule.then(async({loadEcharts,createReportCharts})=>{const E=await loadEcharts();if(sequence!==state.reportChartSequence)return;state.reportCharts??=createReportCharts(E,{gaugeNode:$('#overall-ring'),mainNode:$('#report-main-chart'),radarNode:$('#report-contribution-chart'),captionNode:$('#chart-context-caption'),legendNode:$('#chart-extra-legend'),onCategory:(id,keys)=>focusReportCategory(id,keys),onSubtype:(id,subtype,keys)=>focusReportCategory(id,keys,subtype),onReset:()=>{state.activeCategoryId='all';state.categoryLayers=null;state.activeSubtypeId=null;state.activePoiKeys=null;clearDirectionHighlight();renderCategoryOptions();applyCategoryFocus();refreshHeatLayer();fitCategoryCamera();}});state.reportCharts.update(job,categoryTree);recordMapStage('charts-ready');}).catch(e=>{reportChartModule=null;$('#chart-load-message').hidden=false;$('#chart-load-message').textContent='图表加载失败：'+e.message;});});}
function selectReportTab(tab){$('#report-main-chart').setAttribute('aria-label',({contribution:'优先级权重与贡献占比雷达图',composition:'设施数量旭日图',balance:'服务覆盖率柱状图',directions:'36方向采样玫瑰图'})[tab]);document.querySelectorAll('[data-report-tab]').forEach(n=>n.setAttribute('aria-selected',String(n.dataset.reportTab===tab)));state.reportCharts?.selectTab(tab);}
document.querySelectorAll('[data-report-tab]').forEach(n=>n.addEventListener('click',()=>selectReportTab(n.dataset.reportTab)));
$('#reset-report-chart')?.addEventListener('click',()=>state.reportCharts?.reset());
window.addEventListener('pagehide',()=>{state.reportCharts?.destroy();clearDirectionHighlight();});
