import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapRuntime, startMapServices } from '../web/map-runtime.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const response = (json, ok = true) => ({ ok, json: async () => json });
function sdkHarness() {
  const scripts = [], timers = new Map(), stages = [];
  let nextId = 0;
  const windowRef = {
    setTimeout(callback, delay) { timers.set(++nextId, { callback, delay }); return nextId; },
    clearTimeout(id) { timers.delete(id); },
  };
  const documentRef = { head: { append(script) { scripts.push(script); } },
    createElement: () => ({ removed: false, remove() { this.removed = true; } }) };
  const runtime = createMapRuntime({ windowRef, documentRef, onStage: (stage) => stages.push(stage) });
  return { runtime, windowRef, scripts, timers, stages };
}

test('map starts as soon as configuration is ready, while backend health is still pending', async () => {
  const health = deferred(), loads = [], stages = [];
  const services = startMapServices({
    fetcher: (path) => path === '/api/health' ? health.promise
      : Promise.resolve(response({ browserMapAk: 'offline-fixture-key' })),
    runtime: { load: (ak) => { loads.push(ak); return Promise.resolve({ Map: class {} }); } },
    onStage: (stage) => stages.push(stage),
  });
  let healthFinished = false;
  services.health.then(() => { healthFinished = true; });
  assert.ok((await services.map).Map);
  assert.equal(healthFinished, false);
  assert.deepEqual(loads, ['offline-fixture-key']);
  assert.deepEqual(stages, ['config-ready']);
  health.resolve(response({ placeSearchConfigured: true }));
  assert.equal((await services.health).placeSearchConfigured, true);
});

test('backend failure does not reject map loading; failed config never starts an SDK request', async () => {
  const services = startMapServices({
    fetcher: async (path) => response(path === '/api/config' ? { browserMapAk: 'offline-key' } : {}, path !== '/api/health'),
    runtime: { load: async () => ({ Map: class {} }) },
  });
  const healthResult = assert.rejects(services.health, /分析服务/);
  assert.ok((await services.map).Map); await healthResult;
  let requests = 0;
  const failed = startMapServices({ fetcher: async (path) => response({}, path !== '/api/config'),
    runtime: { load: () => { requests += 1; } } });
  await assert.rejects(failed.map, /地图配置/); await failed.health;
  assert.equal(requests, 0);
});

test('SDK injection is shared and core readiness does not wait for LocalSearch', async () => {
  const h = sdkHarness();
  const first = h.runtime.load('offline-key');
  assert.equal(h.runtime.load('offline-key'), first);
  assert.equal(h.scripts.length, 1);
  h.windowRef.BMapGL = { Map: class {}, Point: class {} };
  h.windowRef.__onLifeCircleMapCoreReady();
  assert.equal(await first, h.windowRef.BMapGL);
  assert.equal(h.windowRef.BMapGL.LocalSearch, undefined);
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.stages, ['sdk-requested', 'sdk-core-ready']);
  const search = h.runtime.searchReady();
  assert.equal(h.timers.size, 2);
  h.windowRef.BMapGL.LocalSearch = class {};
  const [checkId, check] = [...h.timers].find(([, timer]) => timer.delay === 150);
  h.timers.delete(checkId); check.callback();
  assert.equal(await search, h.windowRef.BMapGL);
  assert.equal(h.timers.size, 0);
});

test('SDK and search timeout terminate cleanly, permit manual retry and tolerate late callbacks', async () => {
  const h = sdkHarness();
  const first = h.runtime.load('offline-key');
  const rejected = assert.rejects(first, /加载超时/);
  const [id, timer] = [...h.timers][0]; h.timers.delete(id); timer.callback();
  await rejected;
  assert.equal(h.scripts[0].removed, true); assert.equal(h.timers.size, 0);
  assert.doesNotThrow(() => h.windowRef.__onLifeCircleMapCoreReady());
  const retry = h.runtime.load('offline-key');
  assert.equal(h.scripts.length, 2);
  h.windowRef.BMapGL = { Map: class {}, Point: class {} };
  h.windowRef.__onLifeCircleMapCoreReady(); await retry;
  const search = h.runtime.searchReady();
  const searchRejected = assert.rejects(search, /搜索暂不可用/);
  const [timeoutId, timeout] = [...h.timers].find(([, value]) => value.delay === 10000);
  h.timers.delete(timeoutId); timeout.callback(); await searchRejected;
  assert.equal(h.timers.size, 0);
});
