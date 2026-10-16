import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { FACILITY_GROUP_IDS } from './facility-categories.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function freePort() {
  const socket = createServer();
  await new Promise((resolveListen) => socket.listen(0, '127.0.0.1', resolveListen));
  const port = socket.address().port;
  await new Promise((resolveClose) => socket.close(resolveClose));
  return port;
}

async function waitForServer(base, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error('Test server exited before becoming ready.');
    try {
      const response = await fetch(base + '/api/health', { signal: AbortSignal.timeout(300) });
      if (response.ok) return;
    } catch { /* The listener is starting. */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error('Test server did not start.');
}

test('version 3 HTTP taxonomy, full evidence, all-zero weights and version isolation use zero upstream budget', async () => {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port), BAIDU_SERVER_AK: 'offline-test-placeholder', VITE_BAIDU_MAP_AK: '',
      BAIDU_ISOCHRONE_ENABLED: 'false', BAIDU_ISOCHRONE_ENTITLEMENT_VERIFIED: 'false',
      BAIDU_ISOCHRONE_REQUEST_LIMIT: '0', BAIDU_WALKING_SAMPLING_FALLBACK_ENABLED: 'false',
      BAIDU_MATRIX_VERIFIED: 'false', BAIDU_MATRIX_OUTPUT_LIMIT: '0',
      BAIDU_PLACE_PROCESS_LIMIT: '0', BAIDU_ROUTE_PROCESS_LIMIT: '0',
      BAIDU_SAMPLING_PROCESS_LIMIT: '0',
      BAIDU_TRAFFIC_ENABLED: 'false', BAIDU_AOI_ENABLED: 'false', BAIDU_TRAFFIC_EVENTS_ENABLED: 'false',
    },
    stdio: 'ignore',
  });
  try {
    await waitForServer(base, child);
    const taxonomy = await (await fetch(base + '/api/facility-categories')).json();
    assert.equal(taxonomy.version, 'facility-categories-v8');
    assert.equal(taxonomy.categories.length, 6);
    assert.equal(taxonomy.categories.flatMap((group) => group.subtypes).length, 18);
    const historical=await(await fetch(base+'/api/facility-categories?version=facility-categories-v6')).json();
    assert.equal(historical.categories.flatMap(g=>g.subtypes).length,17);
    const health=await(await fetch(base+'/api/health')).json();assert.equal(health.featureFlags.isochroneRequestEnabled,false);assert.equal(health.featureFlags.isodistanceRequestEnabled,false);assert.equal(health.analysisLimits.lowSamplingRouteCalls,36);assert.equal(health.analysisLimits.rangeStrategy,'centered_matrix_bisection');
    assert.equal(JSON.stringify(taxonomy).includes('offline-test-placeholder'), false);
    const body = {
      version: 3, categoryMappingVersion: 'facility-categories-v3',
      origin: { id: 'offline-origin', source: 'map_click', name: '离线测试点',
        location: { lat: 30.288902, lng: 120.150993 } },
      categoryIds: [...FACILITY_GROUP_IDS], priorities: Object.fromEntries(FACILITY_GROUP_IDS.map((id) => [id, 0])),
      mode: 'walking', minutes: 15, confirmRealWalkingSampling: false,
    };
    const oldResponse = await fetch(base + '/api/analyses', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, version: 2 }) });
    assert.equal(oldResponse.status, 400);
    assert.equal((await oldResponse.json()).code, 'FACILITY_VERSION_MIGRATION_REQUIRED');
    const createdResponse = await fetch(base + '/api/analyses', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(createdResponse.status, 202);
    const created = await createdResponse.json();
    let job;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      job = await (await fetch(base + '/api/analyses/' + created.analysisId)).json();
      if (['partial', 'complete', 'failed'].includes(job.status)) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
    assert.equal(job.status, 'failed');
    assert.equal(job.analysis.categories.length, 6);
    assert.equal(job.analysis.categories.flatMap((group) => group.subtypeResults).length, 25);
    assert.ok(job.analysis.categories.flatMap((group) => group.subtypeResults).every((row) => row.accessStatus === 'unknown'));
    assert.equal(job.score.scoreStatus, 'not_requested');
    assert.equal(job.score.S_low, null);
    assert.equal(job.score.S_high, null);
    assert.equal(job.requestStats.placeRequests, 0);
    assert.equal(job.requestStats.routeDecisions, 0);
    assert.equal(job.requestStats.samplingRequests, 0);

    const geoResponse = await fetch(base + '/api/analyses/' + created.analysisId + '/geojson');
    assert.equal(geoResponse.status, 409);
    const geojson = await geoResponse.json();
    assert.equal(geojson.status, 'failed');
    assert.equal(job.geometryStatus, 'unknown');

    const scoreResponse = await fetch(base + '/api/analyses/' + created.analysisId + '/score', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ evidenceFingerprint: job.score.evidenceFingerprint,
        priorities: { medical: 3, education: 1 } }),
    });
    // No search budget is a failed task with retained unknown evidence, not a successful report.
    assert.equal(scoreResponse.status, 409);
    assert.equal((await fetch(base + '/api/reports/' + created.analysisId)).status,409);
    assert.equal((await fetch(base + '/api/analyses/' + created.analysisId + '/metrics')).status,409);
    const nextBody={...body,version:4,categoryMappingVersion:'facility-categories-v4',
      analysisLocation:body.origin,origin:{...body.origin,id:'independent',location:{...body.origin.location,lng:body.origin.location.lng+.003}}};
    const nextResponse=await fetch(base+'/api/analyses',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(nextBody)});
    assert.equal(nextResponse.status,202);const next=await nextResponse.json();let current;
    for(let attempt=0;attempt<80;attempt++){
      current=await (await fetch(base+'/api/analyses/'+next.analysisId)).json();
      if(!['queued','running'].includes(current.status))break;await new Promise(r=>setTimeout(r,20));
    }
    assert.equal(current.status,'failed');
    assert.equal(current.analysis.categories.flatMap(g=>g.subtypeResults).length,23);
    assert.deepEqual(current.origin.location,nextBody.origin.location);assert.deepEqual(current.analysisLocation.location,body.origin.location);
    const reps=await fetch(base+'/api/analyses/'+next.analysisId+'/representative-routes');
    assert.equal(reps.status,404);
    const details=await fetch(base+'/api/analyses/'+next.analysisId+'/representative-routes',{method:'POST',
      headers:{'content-type':'application/json'},body:JSON.stringify({includeGeometry:true,evidenceFingerprint:current.score.evidenceFingerprint})});
    assert.equal(details.status,409);assert.equal(current.requestStats.routeDecisions,0);
    assert.equal((await fetch(base+'/api/reports/'+next.analysisId)).status,409);
    const oldTree=await (await fetch(base+'/api/facility-categories?version=facility-categories-v3')).json();
    assert.equal(oldTree.categories.flatMap(g=>g.subtypes).length,25);
  } finally {
    child.kill();
  }
});
