import { validBd09ll } from './walking-provider.mjs';

const EMPTY_COLLECTION = Object.freeze({ type: 'FeatureCollection', features: [] });
const CONGESTION_LABELS = ['未知', '畅通', '缓行', '拥堵', '严重拥堵'];

function parseLinkPath(path) {
  if (typeof path !== 'string') return null;
  const points = path.split(';').map((token) => {
    const pair = token.split(',');
    if (pair.length !== 2 || !pair.every((value) => value.trim() !== '')) return null;
    const [lng, lat] = pair.map(Number);
    return validBd09ll({ lng, lat }) ? [lng, lat] : null;
  });
  return points.length >= 2 && points.length <= 200 && points.every(Boolean) ? points : null;
}

export function parseTrafficAround(data, meta, { ttlMs = 120000 } = {}) {
  if (!data || typeof data !== 'object'
    || (data.road_traffic != null && !Array.isArray(data.road_traffic))) {
    throw new TypeError('Traffic around response has invalid road_traffic.');
  }
  const status = data.evaluation?.status;
  if (!Number.isInteger(status) || status < 0 || status > 4) {
    throw new TypeError('Traffic around response has no valid evaluation.');
  }
  const retrievedAt = meta?.retrievedAt;
  const stamp = Date.parse(retrievedAt);
  if (!Number.isFinite(stamp)) throw new TypeError('Traffic retrieval time is missing.');
  if (!Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > 300000) {
    throw new RangeError('Invalid traffic TTL.');
  }
  const features = [];
  const roads = [];
  for (const road of (data.road_traffic ?? []).slice(0, 80)) {
    if (!road || typeof road !== 'object') continue;
    const roadName = String(road.road_name ?? '').slice(0, 100);
    const sections = Array.isArray(road.congestion_sections) ? road.congestion_sections : [];
    roads.push({ roadName, congestedSections: sections.length });
    // traffic_detail is an additional entitlement. The basic response can have no path.
    for (const detail of (Array.isArray(road.traffic_detail) ? road.traffic_detail : []).slice(0, 50)) {
      if (features.length >= 500) break;
      const coordinates = parseLinkPath(detail?.path);
      if (!coordinates || !Number.isInteger(detail.status) || detail.status < 1 || detail.status > 4) continue;
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates },
        properties: { source: 'baidu_traffic_around', coordinateSystem: 'BD-09LL',
          roadName, congestionStatus: detail.status, congestionLabel: CONGESTION_LABELS[detail.status],
          retrievedAt } });
    }
  }
  return {
    status: status === 0 ? 'unknown' : 'available', source: 'baidu_traffic_around',
    coordinateSystem: 'BD-09LL', evaluationStatus: status,
    evaluationLabel: CONGESTION_LABELS[status],
    description: String(data.description ?? '').slice(0, 500),
    retrievedAt, timestampMeaning: 'response_retrieval_time',
    expiresAt: new Date(stamp + ttlMs).toISOString(), roads,
    geojson: features.length ? { type: 'FeatureCollection', features } : EMPTY_COLLECTION,
    detailStatus: features.length ? 'link_paths_available' : 'no_link_paths',
    note: '路况是驾车情景的独立解释图层，不修正设施路线耗时或官方等时圈。',
  };
}

export function createBaiduTrafficProvider({ client, ttlMs = 120000 } = {}) {
  if (!client?.requestJson) throw new TypeError('An injectable Baidu client is required.');
  return Object.freeze({
    async around({ center, radiusMeters = 1000, signal } = {}) {
      if (!validBd09ll(center) || !Number.isInteger(radiusMeters)
        || radiusMeters < 1 || radiusMeters > 1000) {
        throw new TypeError('A BD-09LL center and radius from 1 to 1000m are required.');
      }
      const { data, meta } = await client.requestJson({
        service: 'traffic', path: '/traffic/v1/around', signal,
        params: { center: center.lat.toFixed(6) + ',' + center.lng.toFixed(6),
          radius: radiusMeters, coord_type_input: 'bd09ll', coord_type_output: 'bd09ll' },
        cacheTtlMs: 60000,
      });
      return parseTrafficAround(data, meta, { ttlMs });
    },
  });
}
