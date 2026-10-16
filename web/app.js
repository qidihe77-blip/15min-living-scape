const $ = (selector) => document.querySelector(selector);
const state = { map: null, center: null, centerMarker: null, radiusCircle: null, placeMarkers: [], browserAk: '' };
const mapNode = $('#map');
const mapLoading = mapNode.querySelector('.map-loading');
// Confirmed project center: 西溪街道文锦社区, 文二路27号, BD-09LL.
const defaultCenter = { lat: 30.288902, lng: 120.150993 };

function setNotice(message, kind = '') {
  const notice = $('#notice');
  notice.textContent = message;
  notice.className = `notice ${kind}`.trim();
}

function setConnection(ready, label) {
  const indicator = $('.connection');
  indicator.className = `connection ${ready ? 'ready' : 'error'}`;
  $('#connection-label').textContent = label;
}

function formatCoordinate(value) {
  return Number(value).toFixed(6);
}

function updateCenter(point) {
  state.center = { lat: point.lat, lng: point.lng };
  $('#longitude').textContent = formatCoordinate(point.lng);
  $('#latitude').textContent = formatCoordinate(point.lat);
  $('#copy-coordinate').disabled = false;
  $('#search-button').disabled = false;

  const B = window.BMapGL;
  if (state.centerMarker) state.map.removeOverlay(state.centerMarker);
  state.centerMarker = new B.Marker(new B.Point(point.lng, point.lat));
  state.map.addOverlay(state.centerMarker);

  if (state.radiusCircle) state.map.removeOverlay(state.radiusCircle);
  state.radiusCircle = new B.Circle(new B.Point(point.lng, point.lat), Number($('#radius').value), {
    strokeColor: '#278f80', strokeWeight: 2, strokeOpacity: 0.8,
    fillColor: '#55b8a4', fillOpacity: 0.1,
  });
  state.map.addOverlay(state.radiusCircle);
}

function clearPlaceMarkers() {
  for (const marker of state.placeMarkers) state.map.removeOverlay(marker);
  state.placeMarkers = [];
}

function loadBaiduMap(ak) {
  return new Promise((resolve, reject) => {
    if (!ak) return reject(new Error('缺少浏览器地图 AK，请在 .env.local 中配置 VITE_BAIDU_MAP_AK。'));
    const callbackName = '__onBaiduMapReady';
    window[callbackName] = () => {
      delete window[callbackName];
      resolve();
    };
    const script = document.createElement('script');
    script.src = `https://api.map.baidu.com/api?v=1.0&type=webgl&ak=${encodeURIComponent(ak)}&callback=${callbackName}`;
    script.async = true;
    script.onerror = () => reject(new Error('百度地图脚本加载失败，请检查浏览器 AK、域名白名单和网络。'));
    document.head.append(script);
    window.setTimeout(() => {
      if (!window.BMapGL) reject(new Error('百度地图加载超时，请检查浏览器 AK 和网络连接。'));
    }, 15000);
  });
}

async function initializeMap(ak) {
  await loadBaiduMap(ak);
  const B = window.BMapGL;
  const start = new B.Point(defaultCenter.lng, defaultCenter.lat);
  state.map = new B.Map('map', { enableMapClick: true });
  state.map.centerAndZoom(start, 14);
  state.map.enableScrollWheelZoom(true);
  state.map.addControl(new B.ScaleControl({ anchor: B.BMAP_ANCHOR_BOTTOM_LEFT }));
  state.map.addControl(new B.ZoomControl({ anchor: B.BMAP_ANCHOR_BOTTOM_RIGHT }));
  state.map.addEventListener('click', (event) => updateCenter(event.latlng));
  mapLoading.classList.add('hidden');
  $('#map-home').addEventListener('click', () => state.map.centerAndZoom(start, 14));
  $('#radius').addEventListener('input', (event) => {
    const radius = Number(event.target.value);
    $('#radius-output').value = `${radius.toLocaleString('zh-CN')} 米`;
    if (state.center) updateCenter(state.center);
  });
}

function renderPlaces(data) {
  const list = $('#results-list');
  $('#result-count').textContent = `${data.count} 个`;
  $('#results-footnote').hidden = false;
  if (!data.places.length) {
    list.innerHTML = '<div class="empty-state"><strong>这个范围内没有检索到设施</strong><span>试试扩大搜索半径或切换类别。</span></div>';
    return;
  }
  list.innerHTML = data.places.map((place, index) => `
    <article class="place-card" data-place-index="${index}">
      <span class="place-index">${String(index + 1).padStart(2, '0')}</span>
      <div class="place-copy"><strong title="${escapeHtml(place.name)}">${escapeHtml(place.name)}</strong><span title="${escapeHtml(place.address || '地址暂无')}">${escapeHtml(place.address || '地址暂无')}</span></div>
      <span class="place-distance">${formatDistance(place.distanceMeters)}</span>
    </article>`).join('');

  clearPlaceMarkers();
  for (const place of data.places) {
    const marker = new window.BMapGL.Marker(new window.BMapGL.Point(place.lng, place.lat));
    state.map.addOverlay(marker);
    state.placeMarkers.push(marker);
  }
  list.querySelectorAll('.place-card').forEach((card) => {
    card.addEventListener('click', () => {
      const place = data.places[Number(card.dataset.placeIndex)];
      state.map.panTo(new window.BMapGL.Point(place.lng, place.lat));
    });
  });
}

function formatDistance(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${meters} m`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

async function runSearch() {
  if (!state.center) return;
  const button = $('#search-button');
  button.disabled = true;
  button.querySelector('span').textContent = '正在检索…';
  setNotice('正在通过后端查询百度地点服务，并计算距离排序…');
  $('#result-count').textContent = '检索中';
  try {
    const params = new URLSearchParams({
      lat: String(state.center.lat),
      lng: String(state.center.lng),
      radius: $('#radius').value,
      category: $('#category').value,
    });
    const response = await fetch(`/api/places?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '设施检索失败。');
    renderPlaces(data);
    setNotice(`检索完成：${data.count} 个${data.categoryLabel}设施，已按直线距离排序。`, 'success');
  } catch (error) {
    $('#result-count').textContent = '检索失败';
    setNotice(error.message, 'error');
  } finally {
    button.disabled = !state.center;
    button.querySelector('span').textContent = '检索周边设施';
  }
}

async function start() {
  $('#search-button').addEventListener('click', runSearch);
  $('#copy-coordinate').addEventListener('click', async () => {
    if (!state.center) return;
    await navigator.clipboard.writeText(`${formatCoordinate(state.center.lng)}, ${formatCoordinate(state.center.lat)}`);
    showToast('BD-09LL 坐标已复制');
  });
  $('#radius-output').value = '1,000 米';

  try {
    const [healthResponse, configResponse] = await Promise.all([fetch('/api/health'), fetch('/api/config')]);
    if (!healthResponse.ok || !configResponse.ok) throw new Error('无法连接本地后端。');
    const health = await healthResponse.json();
    const config = await configResponse.json();
    state.browserAk = config.browserMapAk;
    setConnection(true, health.placeSearchConfigured ? '前后端已连接' : '前端已连接 · 后端待配置');
    if (!health.placeSearchConfigured) setNotice('服务端地图服务尚未配置；地图仍可使用，检索需配置后端 AK。');
    await initializeMap(state.browserAk);
    setNotice('地图已就绪。点击地图选择分析中心点。');
    if (!health.placeSearchConfigured) setNotice('地图已就绪；请确认服务端密钥已配置后再检索。');
  } catch (error) {
    setConnection(false, '服务连接异常');
    mapLoading.querySelector('#map-status').textContent = error.message;
    setNotice(error.message, 'error');
  }
}

let toastTimer;
function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2400);
}

start();
