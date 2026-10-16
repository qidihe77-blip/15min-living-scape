// Route-time colours describe measured destinations, never POI density or population coverage.
export const ROUTE_TIME_BANDS = Object.freeze([
  { maxSeconds: 300, label: '≤5 分钟', color: '#28d9f5' },
  { maxSeconds: 600, label: '5–10 分钟', color: '#488eff' },
  { maxSeconds: 900, label: '10–15 分钟', color: '#9475f5' },
  { maxSeconds: Infinity, label: '>15 分钟', color: '#f2aa57' },
]);

export function routeTimeColor(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return ROUTE_TIME_BANDS.find((band) => seconds <= band.maxSeconds).color;
}

function validRing(ring) {
  return Array.isArray(ring) && ring.length >= 4 && ring.every((point) =>
    Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])
    && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90)
    && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1];
}

export function measuredHeatCells(features) {
  if (!Array.isArray(features)) return [];
  return features.flatMap((feature) => {
    const props = feature.properties || {};
    const seconds = props.durationSeconds;
    // Origin identity (0 seconds) is not a measured route to neighbouring locations.
    if (props.sampleStage === 'unsampled'
      || (props.distanceMeters != null && (!Number.isFinite(props.distanceMeters) || props.distanceMeters < 0))
      || !['sample_cell', 'refined_sample_cell'].includes(props.featureType)
      || props.geometrySource !== 'walking_sampling_fallback'
      || props.coordinateSystem !== 'BD-09LL'
      || props.routeStatus !== 'ok' || props.decisionSource !== 'baidu_walking_duration'
      || !Number.isFinite(seconds) || seconds < 0
      || props.coverageStatus !== (seconds <= 900 ? 'covered' : 'over_threshold')
      || feature.geometry?.type !== 'Polygon'
      || !feature.geometry.coordinates?.length
      || !feature.geometry.coordinates.every(validRing)) return [];
    const rings = feature.geometry.coordinates;
    const vertices = rings[0].slice(0, -1);
    const center = vertices.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0])
      .map((sum) => sum / vertices.length);
    return [{ evidenceId: props.evidenceId, seconds, color: routeTimeColor(seconds),
      rings, center, refined: props.featureType === 'refined_sample_cell' }];
  });
}

function rgba(hex, alpha) {
  return 'rgba(' + [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)).join(',')
    + ',' + alpha + ')';
}

// Exported separately so projection, clipping and unknown-area handling can be verified offline.
export function paintMeasuredHeat(context, cells, project, { width, height, theme = 'dark' }) {
  context.clearRect(0, 0, width, height);
  let painted = 0;
  for (const cell of cells) {
    const rings = cell.rings.map((ring) => ring.map(project));
    const center = project(cell.center);
    const points = rings.flat();
    if (![center, ...points].every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) continue;
    const left = Math.min(...points.map((point) => point.x));
    const right = Math.max(...points.map((point) => point.x));
    const top = Math.min(...points.map((point) => point.y));
    const bottom = Math.max(...points.map((point) => point.y));
    if (right < 0 || left > width || bottom < 0 || top > height) continue;
    const radius = Math.min(right - left, bottom - top) * 0.5;
    if (!(radius > 0)) continue;
    context.save();
    context.beginPath();
    for (const ring of rings) {
      ring.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
      context.closePath();
    }
    // Restrict each soft spot to its original sample proxy, including any holes.
    // Never blur, interpolate or join across unmeasured roads, water or blocks.
    context.clip('evenodd');
    const gradient = context.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
    gradient.addColorStop(0, rgba(cell.color, theme === 'light' ? 0.72 : 0.82));
    gradient.addColorStop(0.38, rgba(cell.color, theme === 'light' ? 0.48 : 0.56));
    gradient.addColorStop(1, rgba(cell.color, 0));
    context.fillStyle = gradient;
    context.fillRect(left, top, right - left, bottom - top);
    // The small centre explicitly identifies the tested destination.
    context.beginPath();
    context.arc(center.x, center.y, 2.6, 0, Math.PI * 2);
    context.fillStyle = theme === 'light' ? '#163e68' : '#d7faff';
    context.fill();
    context.restore();
    painted += 1;
  }
  return painted;
}

export function createMeasuredHeatOverlay(B, features, {
  theme = 'dark', documentRef = globalThis.document,
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
  pixelRatio = () => globalThis.devicePixelRatio || 1,
} = {}) {
  const cells = measuredHeatCells(features);
  if (!cells.length || !B?.Overlay || !B?.Point || !B?.Pixel || !requestFrame || !cancelFrame) return null;
  class MeasuredHeatOverlay extends B.Overlay {
    constructor() {
      super();
      this.theme = theme;
      this.frame = null;
      this.disposed = false;
      this.events = ['moving', 'moveend', 'zooming', 'zoomend', 'resize', 'heading_changed', 'tilt_changed'];
      this.schedule = () => this.draw();
    }
    initialize(map) {
      this.map = map;
      this.canvas = documentRef.createElement('canvas');
      this.canvas.className = 'reachability-heat-canvas';
      this.canvas.setAttribute('aria-hidden', 'true');
      Object.assign(this.canvas.style, { position: 'absolute', pointerEvents: 'none', zIndex: '0' });
      this.context = this.canvas.getContext('2d');
      if (!this.context) throw new Error('Route-time heat requires a 2D canvas.');
      map.getPanes().markerPane.prepend(this.canvas);
      for (const name of this.events) map.addEventListener(name, this.schedule);
      return this.canvas;
    }
    draw() {
      if (this.disposed || this.frame !== null || !this.context) return;
      this.frame = requestFrame(() => {
        this.frame = null;
        if (!this.disposed) this.paint();
      });
    }
    paint() {
      const size = this.map.getSize();
      if (!(size.width > 0 && size.height > 0)) return;
      // Both origin and vertices use the same public overlay projection, including map rotation.
      const origin = this.map.pointToOverlayPixel(this.map.pixelToPoint(new B.Pixel(0, 0)));
      if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y)) return;
      const ratio = Math.min(2, Math.max(1, Number(pixelRatio()) || 1));
      const width = Math.ceil(size.width * ratio), height = Math.ceil(size.height * ratio);
      if (this.canvas.width !== width) this.canvas.width = width;
      if (this.canvas.height !== height) this.canvas.height = height;
      Object.assign(this.canvas.style, { left: origin.x + 'px', top: origin.y + 'px',
        width: size.width + 'px', height: size.height + 'px' });
      this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
      paintMeasuredHeat(this.context, cells, ([lng, lat]) => {
        const point = this.map.pointToOverlayPixel(new B.Point(lng, lat));
        return { x: point.x - origin.x, y: point.y - origin.y };
      }, { width: size.width, height: size.height, theme: this.theme });
    }
    setTheme(value) { this.theme = value; this.draw(); }
    dispose() {
      this.disposed = true;
      if (this.frame !== null) cancelFrame(this.frame);
      this.frame = null;
      for (const name of this.events) this.map?.removeEventListener(name, this.schedule);
      this.canvas?.remove();
      this.context = null;
    }
  }
  return new MeasuredHeatOverlay();
}
