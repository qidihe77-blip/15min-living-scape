const escapeXml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[char]);

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const point = (value) => value && finite(value.lng) && finite(value.lat)
  ? [value.lng, value.lat] : null;

function coordinatesOf(geometry) {
  if (!geometry?.coordinates) return [];
  const walk = (value, result = []) => {
    if (Array.isArray(value) && value.length >= 2 && value.every(finite)) {
      result.push(value);
    } else if (Array.isArray(value)) {
      value.forEach((item) => walk(item, result));
    }
    return result;
  };
  return walk(geometry.coordinates);
}

function featurePoints(feature) {
  return coordinatesOf(feature?.geometry);
}

function linePath(points, project) {
  const projected = points.map(project).filter(Boolean);
  return projected.length >= 2
    ? projected.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
    : '';
}

function polygonPath(points, project) {
  const projected = points.map(project).filter(Boolean);
  return projected.length >= 3
    ? projected.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ') + ' Z'
    : '';
}

function categoryColor(categoryId) {
  return ({
    education: '#416DE1', medical: '#08A887', commerce: '#EA8E34',
    transport: '#8B5CF6', eldercare: '#D65A78', leisure: '#159BCF',
  })[categoryId] ?? '#6D8EA5';
}

function routeGeometry(route) {
  return route?.geometry ?? route;
}

function specialRoutes(report) {
  return (report.serviceGaps?.specialties ?? []).map((row) => {
    const evidence = row.walking_1km_gap?.nearestWithinOneKilometer
      ?? row.walking_1km_gap?.nearestVerified;
    return evidence?.geometry ? { label: row.label, geometry: evidence.geometry } : null;
  }).filter(Boolean);
}

function regionalBlindCells(report) {
  return (report.regionalGaps?.cells ?? []).filter((cell) => cell.insideCircle
    && (cell.blind === true || cell.candidateBlind === true));
}

function median(values) {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
}

export function reportMapSnapshot(report, { width = 920, height = 470 } = {}) {
  const features = report.geojson?.features ?? [];
  const boundary = features.find((feature) => feature.properties?.featureType === 'sampled_boundary');
  const routeFeatures = features.filter((feature) => feature.properties?.featureType === 'reachable_route');
  const facilities = (report.display?.facilities ?? []).filter((facility) => point(facility.location));
  const special = specialRoutes(report);
  const blindCells = regionalBlindCells(report);
  const origin = point(report.origin?.location);
  const allPoints = [
    ...features.flatMap(featurePoints),
    ...facilities.map((facility) => point(facility.location)),
    ...blindCells.map((cell) => point(cell.center)),
    origin,
  ].filter(Boolean);
  if (!allPoints.length) return null;

  const lngs = allPoints.map(([lng]) => lng);
  const lats = allPoints.map(([, lat]) => lat);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const lngSpan = Math.max(0.001, maxLng - minLng);
  const latSpan = Math.max(0.001, maxLat - minLat);
  const paddedLng = lngSpan * 0.08, paddedLat = latSpan * 0.08;
  const west = minLng - paddedLng, east = maxLng + paddedLng;
  const south = minLat - paddedLat, north = maxLat + paddedLat;
  const contentWidth = width - 44, contentHeight = height - 46;
  const scale = Math.min(contentWidth / (east - west), contentHeight / (north - south));
  const project = ([lng, lat]) => [
    22 + (lng - west) * scale,
    height - 24 - (lat - south) * scale,
  ];
  const projectLocation = (location) => {
    const p = point(location);
    return p ? project(p) : null;
  };

  const boundaryPath = boundary ? polygonPath(featurePoints(boundary), project) : '';
  const routeMarkup = routeFeatures.slice(0, 220).map((feature) => {
    const d = linePath(coordinatesOf(routeGeometry(feature)), project);
    return d ? `<path d="${d}" class="route"/>` : '';
  }).join('');
  const specialMarkup = special.map((route) => {
    const d = linePath(coordinatesOf(route.geometry), project);
    return d ? `<path d="${d}" class="special-route"/>` : '';
  }).join('');
  const blindMarkup = blindCells.map((cell) => {
    const location = projectLocation(cell.center);
    if (!location) return '';
    const stepLng = median((report.regionalGaps?.cells ?? []).map((item) => item.center?.lng)
      .filter((value) => finite(value) && Math.abs(value - cell.center.lng) > 1e-7)
      ?? []) ?? lngSpan / 5;
    const stepLat = median((report.regionalGaps?.cells ?? []).map((item) => item.center?.lat)
      .filter((value) => finite(value) && Math.abs(value - cell.center.lat) > 1e-7)
      ?? []) ?? latSpan / 5;
    const cellWidth = Math.max(8, Math.abs(stepLng - cell.center.lng) * scale * 0.72);
    const cellHeight = Math.max(8, Math.abs(stepLat - cell.center.lat) * scale * 0.72);
    return `<rect x="${(location[0] - cellWidth / 2).toFixed(1)}" y="${(location[1] - cellHeight / 2).toFixed(1)}" width="${cellWidth.toFixed(1)}" height="${cellHeight.toFixed(1)}" class="blind-cell"/>`;
  }).join('');
  const poiMarkup = facilities.map((facility) => {
    const location = projectLocation(facility.location);
    if (!location) return '';
    return `<circle cx="${location[0].toFixed(1)}" cy="${location[1].toFixed(1)}" r="2.5" fill="${categoryColor(facility.categoryId)}" class="poi"/>`;
  }).join('');
  const originPoint = projectLocation(report.origin?.location);
  const originMarkup = originPoint
    ? `<circle cx="${originPoint[0].toFixed(1)}" cy="${originPoint[1].toFixed(1)}" r="8" class="origin-halo"/><circle cx="${originPoint[0].toFixed(1)}" cy="${originPoint[1].toFixed(1)}" r="4" class="origin"/><text x="${(originPoint[0] + 11).toFixed(1)}" y="${(originPoint[1] - 9).toFixed(1)}" class="origin-label">起点</text>`
    : '';
  const legend = [
    ['range', '15分钟范围'], ['route', '已核验路线'], ['special', '重点服务路线'],
    ['blind', '盲区候选'], ['origin', '分析起点'],
  ].map(([kind, label], index) => {
    const x = 28 + (index % 3) * 175, y = height - 13 - Math.floor(index / 3) * 16;
    const mark = kind === 'range' ? '<rect x="0" y="-8" width="14" height="10" rx="2" class="legend-range"/>'
      : kind === 'route' ? '<path d="M0,-3 L14,-3" class="legend-route"/>'
        : kind === 'special' ? '<path d="M0,-3 L14,-3" class="legend-special"/>'
          : kind === 'blind' ? '<rect x="1" y="-8" width="12" height="10" class="legend-blind"/>'
            : '<circle cx="7" cy="-3" r="4" class="legend-origin"/>';
    return `<g transform="translate(${x},${y})">${mark}<text x="20" y="1" class="legend-label">${escapeXml(label)}</text></g>`;
  }).join('');
  const labels = [
    ['范围来源', report.geometry?.rangeSource ?? '未取得'],
    ['POI', `${facilities.length}处`],
    ['路线', `${routeFeatures.length}条`],
    ['盲区候选', `${blindCells.length}格`],
  ].map(([label, value], index) => `<text x="${width - 196}" y="${22 + index * 14}" class="map-meta"><tspan class="map-meta-label">${escapeXml(label)}：</tspan>${escapeXml(value)}</text>`).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="生活圈地图空间分布静态快照">
<style>.map-grid path{stroke:#dcecf2;stroke-width:1}.range{fill:#8bded955;stroke:#0baeb5;stroke-width:2}.route{fill:none;stroke:#5f93ad;stroke-width:1;stroke-opacity:.22}.special-route{fill:none;stroke:#e48a37;stroke-width:2.6;stroke-linecap:round;stroke-opacity:.9}.blind-cell{fill:#f09a7255;stroke:#d66d49;stroke-width:1.4;stroke-dasharray:4 3}.poi{stroke:#fff;stroke-width:1;opacity:.88}.origin-halo{fill:#15a9b522;stroke:#15a9b5;stroke-width:1.2}.origin{fill:#0b718d;stroke:#fff;stroke-width:1.4}.origin-label{font:600 11px 'Microsoft YaHei',Arial,sans-serif;fill:#1c5069}.map-title{font:700 13px 'Microsoft YaHei',Arial,sans-serif;fill:#28556d}.map-subtitle{font:10px 'Microsoft YaHei',Arial,sans-serif;fill:#7895a5}.map-meta{font:10px 'Microsoft YaHei',Arial,sans-serif;fill:#557589}.map-meta-label{fill:#2d5b72;font-weight:700}.legend-label{font:10px 'Microsoft YaHei',Arial,sans-serif;fill:#557589}.legend-range{fill:#8bded955;stroke:#0baeb5;stroke-width:1}.legend-route{fill:none;stroke:#5f93ad;stroke-width:1.5}.legend-special{fill:none;stroke:#e48a37;stroke-width:2.4}.legend-blind{fill:#f09a7255;stroke:#d66d49;stroke-width:1;stroke-dasharray:3 2}.legend-origin{fill:#0b718d;stroke:#fff;stroke-width:1}</style>
<rect width="${width}" height="${height}" rx="14" fill="#F4FAFD"/>
<g class="map-grid">${Array.from({ length: 9 }, (_, index) => { const x = 22 + index * (width - 44) / 8; return `<path d="M${x.toFixed(1)},18 V${(height - 30).toFixed(1)}"/>`; }).join('')}${Array.from({ length: 7 }, (_, index) => { const y = 18 + index * (height - 48) / 6; return `<path d="M22,${y.toFixed(1)} H${(width - 22).toFixed(1)}"/>`; }).join('')}</g>
<path d="${boundaryPath}" class="range"/>
<g>${blindMarkup}</g>
<g>${routeMarkup}</g>
<g>${specialMarkup}</g>
<g>${poiMarkup}</g>
<g>${originMarkup}</g>
<g>${labels}</g>
<g>${legend}</g>
<text x="28" y="22" class="map-title">地图空间分布 · 静态数据快照</text>
<text x="28" y="38" class="map-subtitle">不依赖在线地图瓦片，打印时保留分析图层</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}
