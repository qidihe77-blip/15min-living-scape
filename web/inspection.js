const sampleCenter = { lng: 120.150993, lat: 30.288902 };
const categories = [
  { id: 'health', label: '医疗健康', icon: '✚', color: '#df6258', minimum: 1 },
  { id: 'education', label: '教育服务', icon: '⌂', color: '#5478dc', minimum: 1 },
  { id: 'grocery', label: '菜场与购物', icon: '▤', color: '#d79838', minimum: 1 },
  { id: 'eldercare', label: '养老与社区', icon: '♡', color: '#8a67c8', minimum: 2 },
];
const walkMetersPerMinute = 70;
const state = { map: null, center: { ...sampleCenter }, centerMarker: null, circles: [], poiMarkers: [], browserAk: '' };
const $ = (selector) => document.querySelector(selector);

function setStatus(text, tone = '') {
  $('#status').textContent = text;
  $('#status').dataset.tone = tone;
}

function setCenter(point, pan = false) {
  state.center = { lng: Number(point.lng), lat: Number(point.lat) };
  $('#longitude').textContent = state.center.lng.toFixed(6);
  $('#latitude').textContent = state.center.lat.toFixed(6);
  $('#run-inspection').disabled = false;
  if (!state.map) return;
  if (state.centerMarker) state.map.removeOverlay(state.centerMarker);
  state.centerMarker = new window.BMapGL.Marker(new window.BMapGL.Point(state.center.lng, state.center.lat));
  state.map.addOverlay(state.centerMarker);
  if (pan) state.map.panTo(new window.BMapGL.Point(state.center.lng, state.center.lat));
}

function clearAnalysisLayers() {
  for (const overlay of [...state.circles, ...state.poiMarkers]) state.map.removeOverlay(overlay);
  state.circles = [];
  state.poiMarkers = [];
}

function drawEstimatedCircles() {
  const B = window.BMapGL;
  const center = new B.Point(state.center.lng, state.center.lat);
  for (const minutes of [15, 10, 5]) {
    if (!$(`#circle-${minutes}`).checked) continue;
    const radius = minutes * walkMetersPerMinute;
    const color = minutes === 15 ? '#4879d8' : minutes === 10 ? '#48a68d' : '#d79838';
    const circle = new B.Circle(center, radius, {
      strokeColor: color, strokeWeight: minutes === 15 ? 2 : 1,
      strokeOpacity: 0.72, fillColor: color, fillOpacity: minutes === 15 ? 0.055 : 0.035,
    });
    state.map.addOverlay(circle);
    state.circles.push(circle);
  }
}

function distanceMeters(a, b) {
  const rad = (degrees) => degrees * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
}

function formatDistance(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${meters} m`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function paintPlaces(category, places) {
  const B = window.BMapGL;
  for (const place of places) {
    const marker = new B.Marker(new B.Point(place.lng, place.lat));
    marker.setTitle(`${category.label}：${place.name}`);
    marker.addEventListener('click', () => {
      const info = new B.InfoWindow(`<div class="map-info"><strong>${escapeHtml(place.name)}</strong><span>${escapeHtml(place.address || '地址暂无')}</span></div>`);
      state.map.openInfoWindow(info, marker.getPosition());
    });
    state.map.addOverlay(marker);
    state.poiMarkers.push(marker);
  }
}

function renderReport(results) {
  const successful = results.filter((item) => item.ok);
  const total = successful.reduce((sum, item) => sum + item.places.length, 0);
  const covered = successful.filter((item) => item.places.length >= item.category.minimum).length;
  $('#coverage-score').textContent = successful.length
    ? `${Math.round(covered / successful.length * 100)}%` : '—';
  $('#facility-total').textContent = String(total);
  $('#coverage-total').textContent = `${covered}/${successful.length}`;
  $('#category-results').innerHTML = results.map(({ category, places, ok, error }) => {
    if (!ok) return `<article class="category-row failed"><span class="category-symbol" style="--category:${category.color}">${category.icon}</span><span class="category-copy"><strong>${category.label}</strong><small>本类检索失败，未纳入结论</small></span><span class="category-count">!</span></article>`;
    const enough = places.length >= category.minimum;
    const message = enough ? `检索到 ${places.length} 处候选设施` : `仅检索到 ${places.length} 处，低于演示阈值 ${category.minimum}`;
    return `<article class="category-row"><span class="category-symbol" style="--category:${category.color}">${category.icon}</span><span class="category-copy"><strong>${category.label}</strong><small>${message}</small></span><span class="category-badge ${enough ? 'ok' : 'watch'}">${enough ? '数量达标' : '建议关注'}</span></article>`;
  }).join('');

  const reach = results.filter((item) => item.ok).flatMap(({ category, places }) => places.map((place) => ({
    category, place, meters: distanceMeters(state.center, place),
  }))).sort((a, b) => a.meters - b.meters).slice(0, 10);
  $('#reachable-list').innerHTML = reach.length ? reach.map(({ category, place, meters }) => `
    <article class="place-row"><span class="place-dot" style="--category:${category.color}"></span><span class="place-copy"><strong>${escapeHtml(place.name)}</strong><small>${category.label} · ${escapeHtml(place.address || '地址暂无')}</small></span><span class="place-distance">${formatDistance(meters)}<small>直线</small></span></article>`).join('')
    : '<p class="empty-state">暂无成功的设施检索结果。</p>';

  const complete = successful.length === categories.length;
  const atRisk = successful.filter((item) => item.places.length < item.category.minimum);
  $('#blind-zone').innerHTML = !complete
    ? '<strong>本次报告不完整</strong><p>有类别检索失败，不能将失败结果视为无设施；请稍后重试。</p>'
    : atRisk.length
      ? `<strong>发现 ${atRisk.length} 类设施数量风险</strong><p>${atRisk.map((item) => escapeHtml(item.category.label)).join('、')}低于演示阈值。该提示仅依据检索到的 POI 数量，不是基于社区边界或人口网格的空间盲区判定。</p>`
      : '<strong>所选类别均达到演示数量阈值</strong><p>这不代表社区整体覆盖充分，POI 数据完整性与服务容量仍未评估。</p>';
  $('#report-note').textContent = complete
    ? '报告基于当前单点周边分类检索与直线距离排序；步行分钟仅由直线距离按 70 米/分钟估算。'
    : '部分类别请求失败，综合覆盖率只按成功类别计算；失败不计为零设施。';
}

async function searchCategory(category) {
  const params = new URLSearchParams({
    lat: String(state.center.lat), lng: String(state.center.lng), radius: '1050', category: category.id,
  });
  const response = await fetch(`/api/places?${params}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '检索服务暂不可用。');
  return data.places || [];
}

async function runInspection() {
  const button = $('#run-inspection');
  button.disabled = true;
  button.innerHTML = '<span class="button-icon">…</span> 正在检索';
  setStatus('设施检索中', 'working');
  clearAnalysisLayers();
  drawEstimatedCircles();
  $('#category-results').innerHTML = '<p class="empty-state">正在查询四类周边设施…</p>';
  $('#reachable-list').innerHTML = '<p class="empty-state">正在整理结果…</p>';
  $('#blind-zone').innerHTML = '<p class="empty-state">正在生成数量风险提示…</p>';
  const results = await Promise.all(categories.map(async (category) => {
    try {
      const places = await searchCategory(category);
      paintPlaces(category, places);
      return { category, places, ok: true };
    } catch (error) {
      return { category, places: [], ok: false, error };
    }
  }));
  renderReport(results);
  const failed = results.filter((result) => !result.ok).length;
  setStatus(failed ? `${failed} 类检索失败` : '单点评估完成', failed ? 'warning' : 'success');
  button.innerHTML = '<span class="button-icon">↻</span> 重新评估';
  button.disabled = false;
}

function loadBMapGL(ak) {
  return new Promise((resolve, reject) => {
    if (!ak) return reject(new Error('本地后端未提供浏览器地图配置，请检查 VITE_BAIDU_MAP_AK。'));
    const callback = '__inspectionMapReady';
    window[callback] = () => { delete window[callback]; resolve(); };
    const script = document.createElement('script');
    script.src = `https://api.map.baidu.com/api?v=1.0&type=webgl&ak=${encodeURIComponent(ak)}&callback=${callback}`;
    script.async = true;
    script.onerror = () => reject(new Error('百度地图加载失败，请检查浏览器 AK、域名白名单与网络。'));
    document.head.append(script);
    window.setTimeout(() => {
      if (!window.BMapGL) reject(new Error('百度地图加载超时。'));
    }, 15000);
  });
}

async function initialize() {
  const [healthResponse, configResponse] = await Promise.all([fetch('/api/health'), fetch('/api/config')]);
  if (!healthResponse.ok || !configResponse.ok) throw new Error('无法连接本地后端服务。');
  const health = await healthResponse.json();
  const config = await configResponse.json();
  state.browserAk = config.browserMapAk;
  await loadBMapGL(state.browserAk);
  const B = window.BMapGL;
  state.map = new B.Map('map', { enableIconClick: false });
  const initial = new B.Point(sampleCenter.lng, sampleCenter.lat);
  state.map.centerAndZoom(initial, 16);
  state.map.enableScrollWheelZoom(true);
  state.map.addControl(new B.ZoomControl());
  state.map.addControl(new B.ScaleControl());
  state.map.addEventListener('click', (event) => {
    setCenter(event.point);
    if (health.placeSearchConfigured) runInspection();
  });
  setCenter(sampleCenter);
  $('#map-loading').hidden = true;
  $('#connection').textContent = health.placeSearchConfigured ? '前后端已连接' : '后端检索 AK 未配置';
  $('#connection').dataset.ready = String(health.placeSearchConfigured);
  $('#run-inspection').disabled = !health.placeSearchConfigured;
  if (!health.placeSearchConfigured) setStatus('服务端检索未配置', 'warning');
  else setStatus('地图已就绪', 'success');
  if (health.placeSearchConfigured) runInspection();
}

for (const minute of [15, 10, 5]) $(`#circle-${minute}`).addEventListener('change', drawEstimatedCircles);
$('#run-inspection').addEventListener('click', runInspection);
$('#map-home').addEventListener('click', () => {
  state.map.centerAndZoom(new window.BMapGL.Point(sampleCenter.lng, sampleCenter.lat), 16);
  setCenter(sampleCenter);
});
initialize().catch((error) => {
  setStatus('启动异常', 'error');
  $('#map-loading').hidden = false;
  $('#map-loading').querySelector('strong').textContent = error.message;
  $('#connection').textContent = '服务连接异常';
  $('#connection').dataset.ready = 'false';
});
