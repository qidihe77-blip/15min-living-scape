import test from 'node:test';
import assert from 'node:assert/strict';
import { getServerConfig, loadLocalEnv, publicMapFeatureFlags } from './config.mjs';

test('configuration permits offline mocks without an AK and keeps public flags secret-free', () => {
  const config = getServerConfig({});
  assert.equal(config.serverAk, '');
  assert.equal(config.isochroneEnabled, false);
  assert.equal(config.walkingSamplingFallbackEnabled, false);
  assert.equal(config.apiTimeoutMs, 8000);
  assert.deepEqual(publicMapFeatureFlags(config), {
    isodistanceRequestEnabled: false,
    walkingModelIds: ['baidu-duration-v1','walking80-v1'],
    isochroneRequestEnabled: false,
    walkingSamplingFallbackEnabled: false,
    trafficContextEnabled: false,
    aoiBoundaryEnabled: false,
    trafficEventsEnabled: false,
  });
  assert.equal(JSON.stringify(publicMapFeatureFlags({ ...config, serverAk: 'private-ak' })).includes('private-ak'), false);
});

test('local env loading respects existing host values and does not emit keys', async () => {
  const env = { BAIDU_SERVER_AK: 'host-key' };
  const readFileImpl = async () => 'BAIDU_SERVER_AK=file-key\nVITE_BAIDU_MAP_AK="browser-key"\nBAIDU_ISOCHRONE_ENABLED=false\n';
  assert.equal(await loadLocalEnv('/project', { env, readFileImpl }), true);
  assert.equal(env.BAIDU_SERVER_AK, 'host-key');
  assert.equal(env.VITE_BAIDU_MAP_AK, 'browser-key');
  assert.equal(getServerConfig(env).isochroneEnabled, false);
});

test('invalid flags and live providers without a server AK fail closed', () => {
  assert.throws(() => getServerConfig({ BAIDU_ISOCHRONE_ENABLED: 'yes' }), /true or false/);
  assert.throws(() => getServerConfig({ BAIDU_ISOCHRONE_ENABLED: 'true' }), /server-side map key/);
  assert.throws(() => getServerConfig({ BAIDU_API_MAX_RETRIES: '9' }), /integer/);
  assert.throws(() => getServerConfig({ BAIDU_TRAFFIC_ENABLED: 'true' }), /server-side map key/);
  assert.throws(() => getServerConfig({ BAIDU_TRAFFIC_PROCESS_LIMIT: '-1' }), /integer/);
  const traffic = getServerConfig({ BAIDU_SERVER_AK: 'fake', BAIDU_TRAFFIC_ENABLED: 'true',
    BAIDU_TRAFFIC_ENTITLEMENT_VERIFIED: 'true', BAIDU_TRAFFIC_PROCESS_LIMIT: '2' });
  assert.equal(publicMapFeatureFlags(traffic).trafficContextEnabled, true);
  assert.equal(getServerConfig({ BAIDU_SERVER_AK: 'fake', BAIDU_ISOCHRONE_ENABLED: 'true' }).isochroneEnabled, true);
  assert.equal(getServerConfig({ BAIDU_SERVER_AK: 'fake' }).walkingSamplingFallbackEnabled, true);
  assert.equal(getServerConfig({ BAIDU_SERVER_AK: 'fake', BAIDU_WALKING_SAMPLING_FALLBACK_ENABLED: 'false' }).walkingSamplingFallbackEnabled, false);
});
