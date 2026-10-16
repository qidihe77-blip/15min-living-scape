import test from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import{spawn}from'node:child_process';import{createServer}from'node:net';
import{productionIsochroneAlgorithm}from'../server/isochrone-algorithms.mjs';
test('production retains walking36 and draws exactly the server geometry, without experimental UI state',async()=>{
 assert.equal(productionIsochroneAlgorithm().id,'walking36');assert.throws(()=>productionIsochroneAlgorithm('adaptive-idw'));
 const source=await readFile('web/console.js','utf8'),html=await readFile('web/console.html','utf8');assert.doesNotMatch(source,/mountIsochrone|isochroneExperiment|smoothDisplayBoundary/);assert.doesNotMatch(html,/isochrone-study|isochrone-experiment/);assert.match(source,/path=rings.length===1\?rings\[0\]\.map\(point\)/);
});
test('retired experiment routes are absent even when an old environment flag is still set',async()=>{
 const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));const child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,PORT:String(port),BAIDU_SERVER_AK:'',VITE_BAIDU_MAP_AK:'',BAIDU_WALKING_SAMPLING_FALLBACK_ENABLED:'false',BAIDU_ISOCHRONE_ENABLED:'false',BAIDU_ISODISTANCE_ENABLED:'false',BAIDU_TRAFFIC_ENABLED:'false',ENABLE_ISOCHRONE_EXPERIMENT:'true'},windowsHide:true,stdio:'ignore'}),base='http://127.0.0.1:'+port;
 try{let ready=false;for(let i=0;i<80;i++){try{ready=(await fetch(base+'/api/health')).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,100));}assert.ok(ready);const config=await(await fetch(base+'/api/config')).json();assert.equal(config.productionIsochroneAlgorithm,'walking36');assert.equal(config.features?.isochroneExperimentEnabled,undefined);
  for(const route of['isochrone-study','isochrone-balanced-study','isochrone-recall-study','isochrone-experiment','time-field-validation'])for(const method of['GET','POST','DELETE'])assert.ok([404,405].includes((await fetch(base+'/api/analyses/fa-11111111-2222-3333-4444-555555555555/'+route,{method})).status));
 }finally{child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));}
});
