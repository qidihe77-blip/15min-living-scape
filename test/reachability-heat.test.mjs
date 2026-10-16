import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { measuredHeatCells, routeTimeColor, createMeasuredHeatOverlay, paintMeasuredHeat } from '../web/reachability-heat.js';

function cell(seconds = 500, changes = {}) {
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[1, 1], [1, 3], [3, 3], [3, 1], [1, 1]]] },
    properties: { evidenceId: 'route-1', featureType: 'sample_cell', geometrySource: 'walking_sampling_fallback',
      coordinateSystem: 'BD-09LL', routeStatus: 'ok', decisionSource: 'baidu_walking_duration',
      coverageStatus: seconds <= 900 ? 'covered' : 'over_threshold', durationSeconds: seconds, ...changes } };
}
function recordingContext() {
  const calls = [];
  const context = Object.fromEntries(['clearRect', 'save', 'restore', 'beginPath', 'closePath',
    'moveTo', 'lineTo', 'clip', 'fillRect', 'arc', 'fill', 'setTransform'].map((method) =>
    [method, (...args) => calls.push([method, ...args])]));
  context.createRadialGradient = (...args) => {
    calls.push(['gradient', ...args]);
    return { addColorStop: (...stop) => calls.push(['stop', ...stop]) };
  };
  return { context, calls };
}

test('time bands preserve the inclusive 900-second walking threshold', () => {
  assert.equal(routeTimeColor(300), '#28d9f5');
  assert.equal(routeTimeColor(301), '#488eff');
  assert.equal(routeTimeColor(600), '#488eff');
  assert.equal(routeTimeColor(601), '#9475f5');
  assert.equal(routeTimeColor(900), '#9475f5');
  assert.equal(routeTimeColor(901), '#f2aa57');
  for (const seconds of [null, undefined, NaN, Infinity, -1, '500']) assert.equal(routeTimeColor(seconds), null);
});

test('unknown, failed, origin-identity and inconsistent evidence never becomes measured heat', () => {
  const good = cell();
  const input = [good, cell(null), cell(500, { coverageStatus: 'unknown' }),
    cell(500, { routeStatus: 'permission_denied' }), cell(0, { decisionSource: 'local_origin_identity' }),
    cell(901, { coverageStatus: 'covered' }), cell(500, { geometrySource: 'baidu_isochrone' }),
    cell(500, { coordinateSystem: 'WGS84' }), cell(500, { featureType: 'unsampled_study_disk' })];
  const snapshot = JSON.stringify(input);
  assert.equal(measuredHeatCells(input).length, 1);
  assert.deepEqual(measuredHeatCells(input)[0].center, [2, 2]);
  assert.equal(JSON.stringify(input), snapshot);
  const malformed = cell(); malformed.geometry.coordinates[0][0][0] = Infinity;
  assert.deepEqual(measuredHeatCells([malformed]), []);
});

test('sparse heat is clipped per evidence polygon and preserves holes, without joining destinations', () => {
  const feature = cell();
  feature.geometry.coordinates.push([[1.5, 1.5], [1.5, 1.8], [1.8, 1.8], [1.8, 1.5], [1.5, 1.5]]);
  const far = cell(1000); far.geometry.coordinates = far.geometry.coordinates.map((ring) =>
    ring.map(([x, y]) => [x + 20, y]));
  const { context, calls } = recordingContext();
  assert.equal(paintMeasuredHeat(context, measuredHeatCells([feature, far]),
    ([x, y]) => ({ x: x * 10, y: y * 10 }), { width: 500, height: 300 }), 2);
  assert.equal(calls.filter(([method]) => method === 'gradient').length, 2);
  assert.deepEqual(calls.filter(([method]) => method === 'clip'), [['clip', 'evenodd'], ['clip', 'evenodd']]);
  // No rectangle or heat kernel spans the unsupported 200-pixel gap.
  assert.deepEqual(calls.filter(([method]) => method === 'fillRect'),
    [['fillRect', 10, 10, 20, 20], ['fillRect', 210, 10, 20, 20]]);
});

test('overlay follows current projection and resize; disposing cancels frames and removes map listeners', () => {
  const { context, calls } = recordingContext();
  const frames = new Map(), cancelled = [], listeners = new Map();
  let nextId = 0, removed = false, canvas;
  const B = { Overlay: class {}, Point: class { constructor(lng, lat) { Object.assign(this, { lng, lat }); } },
    Pixel: class { constructor(x, y) { Object.assign(this, { x, y }); } } };
  const map = {
    offset: 100, scale: 10, size: { width: 300, height: 200 },
    getSize() { return this.size; },
    getPanes: () => ({ markerPane: { prepend(node) { canvas = node; } } }),
    pointToOverlayPixel(point) { return { x: this.offset + point.lng * this.scale, y: this.offset + point.lat * this.scale }; },
    pixelToPoint(pixel) { return new B.Point(pixel.x / this.scale, pixel.y / this.scale); },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
  };
  const overlay = createMeasuredHeatOverlay(B, [cell()], {
    documentRef: { createElement: () => ({ style: {}, setAttribute() {}, getContext: () => context,
      remove() { removed = true; } }) }, pixelRatio: () => 2,
    requestFrame: (callback) => { frames.set(++nextId, callback); return nextId; },
    cancelFrame: (id) => { cancelled.push(id); frames.delete(id); },
  });
  overlay.initialize(map); overlay.draw(); overlay.draw();
  assert.equal(frames.size, 1);
  const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback()); };
  flush();
  assert.equal(canvas.width, 600); assert.equal(canvas.height, 400);
  assert.equal(canvas.style.left, '100px'); assert.equal(canvas.style.pointerEvents, 'none');
  const before = calls.filter(([method]) => method === 'fillRect').at(-1);
  map.scale = 20; map.offset = 240; map.size.width = 500;
  listeners.get('zoomend')(); overlay.setTheme('light'); flush();
  assert.equal(canvas.width, 1000); assert.equal(canvas.style.left, '240px');
  assert.deepEqual(before, ['fillRect', 10, 10, 20, 20]);
  assert.deepEqual(calls.filter(([method]) => method === 'fillRect').at(-1), ['fillRect', 20, 20, 40, 40]);
  overlay.draw(); overlay.dispose();
  assert.equal(cancelled.length, 1); assert.equal(frames.size, 0);
  assert.equal(listeners.size, 0); assert.equal(removed, true);
  overlay.draw(); assert.equal(frames.size, 0);
});

test('recorded Wenjin data yields only its 48 measured route destinations, with no fabricated contour', async () => {
  const result = JSON.parse(await readFile(new URL('./fixtures/wenjin-measured-heat.json', import.meta.url)));
  const cells = measuredHeatCells(result.sampling.geojson.features);
  assert.equal(cells.length, 48);
  const routes = new Map(result.sampling.samples.map((sample) => [sample.evidenceId, sample]));
  for (const sample of cells) {
    assert.equal(sample.seconds, routes.get(sample.evidenceId).durationSeconds);
    assert.equal(sample.color, routeTimeColor(sample.seconds));
  }
  assert.equal(createMeasuredHeatOverlay({ Overlay: class {} }, [cell(null)]), null);
});
