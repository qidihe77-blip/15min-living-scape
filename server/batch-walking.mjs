import {createBaiduRouteProvider, facilityRouteCacheKey} from './baidu-route.mjs';
import {createRequestScheduler} from './request-scheduler.mjs';
import {readFile, mkdir, writeFile, rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import{walkingOdCacheKey}from'./walking-cache.mjs';

const dayKey=at=>new Date(at+8*3600000).toISOString().slice(0,10);
const point=p=>p.location??p;
const unknown=code=>({mode:'walking',source:'route_matrix',routeStatus:code,
 distanceMeters:null,durationSeconds:null,geometry:null,coordinateSystem:'BD-09LL'});

// All matrix users share output-route quotas. A batch of ten consumes ten units,
// regardless of its single HTTP request. No retry or silent Lite fallback here.
export function createBatchWalkingProvider({client,enabled=false,dailyLimit=10000,
 outputQps=10,expiresAt=null,usagePath=null,persistentCache=null,now=Date.now,
 sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
 if(!Number.isInteger(dailyLimit)||dailyLimit<0||dailyLimit>10000
  ||!Number.isInteger(outputQps)||outputQps<1||outputQps>10
  ||(expiresAt!==null&&!Number.isFinite(Date.parse(expiresAt))))throw new RangeError('Invalid batch Walking entitlement.');
 let usage={day:dayKey(now()),outputs:0},requests=0,totalOutputs=0,cacheHits=0,haltCode=null;
 const recent=[],cache=new Map(),scopes=new Map();
 let reservation=Promise.resolve();
 const ready=usagePath?readFile(usagePath,'utf8').then(text=>{
  const saved=JSON.parse(text);if(saved.day===usage.day){
   if(!Number.isInteger(saved.outputs)||saved.outputs<0)throw new TypeError('Invalid quota ledger.');
   usage.outputs=saved.outputs;
  }
 }).catch(e=>{if(e.code!=='ENOENT')haltCode='matrix_usage_unavailable';}):Promise.resolve();
 const makeRaw=()=>createBaiduRouteProvider({client,liteRequestLimit:0,matrixEnabled:true,
  matrixVerified:true,matrixOutputLimit:10000,matrixOutputQps:1000,now});
 let raw=makeRaw();
 const schedule=createRequestScheduler({concurrency:2,minStartIntervalMs:0});
 function unavailable(){return !enabled?'matrix_unverified':!expiresAt||now()>Date.parse(expiresAt)
  ?'permission_expired':haltCode;}
 function trim(){while(recent.length&&now()-recent[0].at>=1000)recent.shift();}
 async function reserve(count,signal,telemetry){
  const run=reservation.then(async()=>{
   await ready;
   if(signal?.aborted)throw signal.reason;
   let code=unavailable();if(code)return code;
   if(usage.day!==dayKey(now())){usage={day:dayKey(now()),outputs:0};raw=makeRaw();}
   if(usage.outputs+count>dailyLimit)return 'matrix_daily_limit_reached';
   trim();
   while(recent.reduce((n,r)=>n+r.count,0)+count>outputQps){
    const start=now();await sleep(Math.max(1,1020-(now()-recent[0].at)));
    if(telemetry)telemetry.throttleWaitMs=(telemetry.throttleWaitMs??0)+Math.max(0,now()-start);
    if(signal?.aborted)throw signal.reason;
    code=unavailable();if(code)return code;trim();
   }
   if(usage.day!==dayKey(now())){usage={day:dayKey(now()),outputs:0};raw=makeRaw();}
   usage.outputs+=count;
   // Persist reservations before dispatch, so service restarts do not reset the cap.
   if(usagePath){try{await mkdir(dirname(usagePath),{recursive:true});
     await writeFile(usagePath+'.tmp',JSON.stringify(usage));await rename(usagePath+'.tmp',usagePath);
    }catch{usage.outputs-=count;haltCode='matrix_usage_unavailable';return haltCode;}}
   recent.push({at:now(),count});requests++;totalOutputs+=count;return null;
  });
  reservation=run.catch(()=>{});return run;
 }
 function key(origin,destination){return persistentCache?walkingOdCacheKey(origin,destination,{endpoint:'route_matrix',originNavigation:'coordinates'}):facilityRouteCacheKey(origin,destination,{mode:'walking'});}
 function peek(origin,destination){const k=key(origin,destination),entry=cache.get(k);
  const saved=persistentCache?.get(k);if(saved)return{...saved,requestedOrigin:{location:{...point(origin)},uid:origin.uid??null},requestedDestination:{location:{...point(destination)},uid:destination.uid??null}};
  if(!entry||entry.expires<=now()){cache.delete(k);return null;}
  cache.delete(k);cache.set(k,entry);return structuredClone({...entry.value,cached:true});
 }
 async function routeMany({origin,destinations,mode='walking',signal,telemetry=null}={}) {
  if(mode!=='walking'||!Array.isArray(destinations))throw new TypeError('Walking destinations required.');
  if(signal?.aborted)throw signal.reason;
  await persistentCache?.ready;
  let pending=scopes.get(signal);if(!pending){pending=new Map();scopes.set(signal,pending);}
  const added=[];
  const results=destinations.map(destination=>{
   const cached=peek(origin,destination);if(cached){cacheHits++;if(telemetry)telemetry.cacheHits=(telemetry.cacheHits??0)+1;return Promise.resolve(cached);}
   const k=key(origin,destination);if(pending.has(k))return pending.get(k).promise;
   let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});
   const entry={k,destination,promise,resolve,reject};pending.set(k,entry);added.push(entry);return promise;
  });
  for(let offset=0;offset<added.length;offset+=outputQps){
   const chunk=added.slice(offset,offset+outputQps);
   schedule(async()=>{
    const waitStarted=now(),code=await reserve(chunk.length,signal,telemetry);
    if(telemetry)telemetry.reservationWaitMs=(telemetry.reservationWaitMs??0)+Math.max(0,now()-waitStarted);
    if(code)return chunk.map(()=>unknown(code));
    if(telemetry){telemetry.od=(telemetry.od??0)+chunk.length;telemetry.httpRequests=(telemetry.httpRequests??0)+1;}
    // Community identity remains in evidence; the selected coordinate is the
    // navigation origin, matching the canonical Walking provider's policy.
    const from=point(origin);
    const rows=await raw.routeMatrix({origins:[{lat:from.lat,lng:from.lng}],
     destinations:chunk.map(e=>e.destination),mode,signal});
    if(rows.some(r=>['permission_denied','quota_exhausted'].includes(r.routeStatus)))
     haltCode=rows.find(r=>['permission_denied','quota_exhausted'].includes(r.routeStatus)).routeStatus;
    return rows.map((r,i)=>({...r,requestedOrigin:{location:{...point(origin)},uid:origin.uid??null},
     requestedDestination:{location:{...point(chunk[i].destination)},uid:chunk[i].destination.uid??null},
     originNavigation:'coordinates',requestOriginUidApplied:false}));
   },{signal,onStart:({queueWaitMs})=>{if(telemetry)telemetry.queueWaitMs=(telemetry.queueWaitMs??0)+queueWaitMs;}}).then(rows=>chunk.forEach((entry,i)=>{
    const value=rows[i]??unknown('invalid_response');
    if(value.routeStatus==='ok'){persistentCache?.set(entry.k,value);cache.set(entry.k,{value,expires:now()+300000});
     if(cache.size>512)cache.delete(cache.keys().next().value);}
    entry.resolve(value);
   }),error=>chunk.forEach(entry=>entry.reject(error))).finally(()=>{
    for(const entry of chunk)if(pending.get(entry.k)===entry)pending.delete(entry.k);
    if(!pending.size&&scopes.get(signal)===pending)scopes.delete(signal);
   });
  }
  return Promise.all(results).then(rows=>rows.map((r,i)=>({...r,requestedOrigin:{location:{...point(origin)},uid:origin.uid??null},requestedDestination:{location:{...point(destinations[i])},uid:destinations[i].uid??null}})));
 }
 return {routeMany,peek,ready,stats:()=>({enabled:!unavailable(),reasonCode:unavailable(),
  endpoint:'/routematrix/v2/walking',matrixRequests:requests,matrixOutputRoutes:totalOutputs,
  dailyLimit,usedToday:usage.day===dayKey(now())?usage.outputs:0,outputQps,expiresAt,
  cacheHits,cacheEntries:cache.size,persistentCache:persistentCache?.stats()??null,quotaUnit:'output_route',quotaScope:'local_service'})};
}
