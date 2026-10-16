import { validBd09ll } from './walking-provider.mjs';

const empty = Object.freeze({ type: 'FeatureCollection', features: [] });
const iso = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const point = (pair) => Array.isArray(pair) && pair.length === 2
  && validBd09ll({ lng: pair[0], lat: pair[1] });
const ring = (value) => Array.isArray(value) && value.length >= 4 && value.length <= 10000
  && value.every(point) && value[0][0] === value.at(-1)[0] && value[0][1] === value.at(-1)[1];
const polygon = (geometry) => geometry?.type === 'Polygon'
  ? Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0 && geometry.coordinates.every(ring)
  : geometry?.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)
    && geometry.coordinates.length > 0 && geometry.coordinates.every((part) =>
      Array.isArray(part) && part.length > 0 && part.every(ring));

export function normalizeAoiBoundary(raw, uid) {
  if (!raw) return { status: 'empty', uid, geojson: empty };
  if (raw.uid !== uid || raw.coordinateSystem !== 'BD-09LL' || !polygon(raw.geometry)) {
    throw new TypeError('AOI must match the selected POI UID and contain verified BD-09LL polygon geometry.');
  }
  return { status: 'available', source: 'baidu_aoi_boundary', uid,
    coordinateSystem: 'BD-09LL', geojson: { type: 'FeatureCollection', features: [
      { type: 'Feature', geometry: raw.geometry, properties: { uid, source: 'baidu_aoi_boundary' } },
    ] }, note: 'AOI 是百度 POI 边界，与路线等时圈分开显示。' };
}

const eventTypes = new Set(['accident', 'construction', 'closure', 'control']);
export function normalizeTrafficEvents(raw, { retrievedAt, ttlMs = 120000 } = {}) {
  if (!Array.isArray(raw?.events) || !iso(retrievedAt) || !Number.isInteger(ttlMs)
    || ttlMs < 1000 || ttlMs > 300000) throw new TypeError('Invalid traffic events response.');
  const events = raw.events.slice(0, 100).map((event) => {
    if (!eventTypes.has(event?.type) || !validBd09ll(event.location)
      || (event.observedAt != null && !iso(event.observedAt))) {
      throw new TypeError('Invalid traffic event or coordinate system.');
    }
    return { type: event.type, title: String(event.title ?? '').slice(0, 120),
      location: { lng: event.location.lng, lat: event.location.lat },
      observedAt: event.observedAt ?? null };
  });
  if (raw.coordinateSystem !== 'BD-09LL') throw new TypeError('Traffic events must be BD-09LL.');
  return { status: events.length ? 'available' : 'empty', source: 'baidu_traffic_events',
    coordinateSystem: 'BD-09LL', retrievedAt, timestampMeaning: 'response_retrieval_time',
    expiresAt: new Date(Date.parse(retrievedAt) + ttlMs).toISOString(), events,
    geojson: { type: 'FeatureCollection', features: events.map((event) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [event.location.lng, event.location.lat] },
      properties: { type: event.type, title: event.title, observedAt: event.observedAt },
    })) }, note: '动态交通事件仅供驾车情景解释，不二次修正路线耗时。' };
}

export function createContextLayerManager({ trafficProvider = null, aoiProvider = null,
  eventsProvider = null, trafficEnabled = false, aoiEnabled = false, eventsEnabled = false,
  trafficRequestLimit = 0, aoiRequestLimit = 0, eventsRequestLimit = 0,
  now = () => Date.now() } = {}) {
  const limits = [trafficRequestLimit, aoiRequestLimit, eventsRequestLimit];
  if (limits.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new RangeError('Context request limits must be nonnegative integers.');
  }
  const counts = { traffic: 0, aoi: 0, events: 0 };
  async function load({ mode, origin, signal }) {
    const context = {
      traffic: { status: mode === 'driving' ? 'permission_unverified' : 'not_applicable' },
      aoi: { status: origin?.source === 'baidu_poi' && origin?.uid ? 'permission_unverified' : 'no_uid' },
      events: { status: mode === 'driving' ? 'permission_unverified' : 'not_applicable' },
    };
    if (mode === 'driving' && trafficEnabled && trafficProvider?.around) {
      if (counts.traffic >= trafficRequestLimit) context.traffic = { status: 'budget_exhausted' };
      else {
        counts.traffic += 1;
        try { context.traffic = await trafficProvider.around({ center: origin.location, radiusMeters: 1000, signal }); }
        catch (error) { context.traffic = { status: 'failed', code: error?.code ?? 'upstream_unavailable' }; }
      }
    }
    if (origin?.source === 'baidu_poi' && origin?.uid && aoiEnabled && aoiProvider?.getBoundary) {
      if (counts.aoi >= aoiRequestLimit) context.aoi = { status: 'budget_exhausted' };
      else {
        counts.aoi += 1;
        try { context.aoi = normalizeAoiBoundary(await aoiProvider.getBoundary({ uid: origin.uid, signal }), origin.uid); }
        catch (error) { context.aoi = { status: 'failed', code: error?.code ?? 'invalid_response' }; }
      }
    }
    if (mode === 'driving' && eventsEnabled && eventsProvider?.getEvents) {
      if (counts.events >= eventsRequestLimit) context.events = { status: 'budget_exhausted' };
      else {
        counts.events += 1;
        try {
          const raw = await eventsProvider.getEvents({ center: origin.location, radiusMeters: 1000, signal });
          context.events = normalizeTrafficEvents(raw, { retrievedAt: raw.retrievedAt });
        } catch (error) { context.events = { status: 'failed', code: error?.code ?? 'invalid_response' }; }
      }
    }
    return freshen(context);
  }
  function freshen(context) {
    if (!context) return null;
    return Object.fromEntries(Object.entries(context).map(([key, layer]) => {
      if (layer?.expiresAt && Date.parse(layer.expiresAt) <= now()) {
        return [key, { ...layer, status: 'stale', geojson: empty,
          note: '查询结果已过有效期，当前状态未知；请重新分析。' }];
      }
      return [key, layer];
    }));
  }
  return Object.freeze({ load, freshen, stats: () => ({ ...counts }) });
}
