import{createBaiduRouteProvider,facilityRouteCacheKey}from'./baidu-route.mjs';import{createRequestScheduler}from'./request-scheduler.mjs';
import{walkingMetric}from'./walking-metrics.mjs';
import{walkingOdCacheKey}from'./walking-cache.mjs';
export function walkingTaskAllowance(limit=220){return{limit,used:0,cacheHits:0,retries:0};}
// One queue/cache for direction samples, facility costs/details, heat and validation.
export function createAuthorizedWalkingProvider({client,intervalMs=110,concurrency=10,retryDelayMs=5200,processLimit=50000,requestLimitWindowMs=86400000,originNavigation='uid',persistentCache=null,prioritizeSampling=true,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 if(!['uid','coordinates'].includes(originNavigation))throw new TypeError('Invalid origin navigation policy.');
 // The selected map point defines the walking origin. Community UIDs can snap to
 // different distant entrances; retain their identity without overriding that point.
 const schedule=createRequestScheduler({concurrency,minStartIntervalMs:Math.max(110,intervalMs)}),adapter={requestJson:args=>client.requestJson({...args,path:'/direction/v2/walking',params:Object.fromEntries(Object.entries(args.params).filter(([k])=>k!=='steps_info'&&!(originNavigation==='coordinates'&&k==='origin_uid')))})};
 const raw=createBaiduRouteProvider({client:adapter,liteRequestLimit:processLimit,requestLimitWindowMs,now,matrixEnabled:false,matrixVerified:false,persistentCache,cacheEndpoint:'direction_v2',originNavigation}),present=r=>({...r,source:'direction_v2',endpoint:'/direction/v2/walking',originNavigation,requestOriginUidApplied:originNavigation==='uid'&&Boolean(r.requestedOrigin?.uid),walkingRequestAttempts:0}),unknown=()=>({mode:'walking',coordinateSystem:'BD-09LL',routeStatus:'walking_task_budget_exhausted',durationSeconds:null,distanceMeters:null,walkingRequestAttempts:0});
 const scopes=new Map();function peek(a,b,o={}){const r=raw.peek(a,b,o);return r?present(r):null;}
 async function route(a,b,o={}){await raw.ready;if(o.signal?.aborted)throw o.signal.reason;if(o.mode&&o.mode!=='walking')return{...unknown(),routeStatus:'unsupported_mode'};const cached=peek(a,b,o);if(cached){if(o.walkingAllowance)o.walkingAllowance.cacheHits++;walkingMetric(o,'cacheHits');return {...cached,cached:true};}
  const key=walkingOdCacheKey(a,b,{...o,originNavigation,endpoint:'direction_v2'})+':'+!!(o.captureGeometry||o.includeGeometry);let pending=scopes.get(o.walkingAllowance??o.signal);if(!pending){pending=new Map();scopes.set(o.walkingAllowance??o.signal,pending);}if(pending.has(key)){walkingMetric(o,'coalesced');const r=structuredClone(await pending.get(key));return {...r,requestedOrigin:{location:{...(a.location??a)},uid:o.originUid??a.uid??null},requestedDestination:{location:{...(b.location??b)},uid:o.destinationUid??b.uid??null},walkingRequestAttempts:0,cached:true};}
  // A backoff timer must not occupy a network concurrency slot. Each attempt
  // rejoins the shared FIFO and pays the same QPS/task allowance as a first try.
  const promise=(async()=>{let r,attempts=0;for(let i=0;i<2;i++){
   r=await schedule(async()=>{if(o.signal?.aborted)throw o.signal.reason;const hit=peek(a,b,o);if(hit){walkingMetric(o,'cacheHits');return{...hit,cached:true,walkingRequestAttempts:attempts};}const budget=o.walkingAllowance,extra=o.requestAllowance;if(extra&&extra.used>=extra.limit)return{...unknown(),routeStatus:'sampling_budget_exhausted',walkingRequestAttempts:attempts};if(budget&&budget.used>=budget.limit)return{...unknown(),walkingRequestAttempts:attempts};if(budget)budget.used++;if(extra)extra.used++;attempts++;const result=present(await raw.route(a,b,o));if(result.cached){attempts--;if(extra)extra.used--;if(budget){budget.used--;budget.cacheHits++;}walkingMetric(o,'cacheHits');}else walkingMetric(o,'od');return{...result,walkingRequestAttempts:attempts};},{signal:o.signal,priority:prioritizeSampling&&o.telemetryPhase==='sampling'?1:0,onStart:({queueWaitMs,throttleWaitMs})=>{walkingMetric(o,'queueWaitMs',queueWaitMs);walkingMetric(o,'throttleWaitMs',throttleWaitMs);}});
   if(i||!['timeout','upstream_error','upstream_unavailable','service_cooldown','rate_limited'].includes(r.routeStatus))return r;
   if(o.walkingAllowance){if(o.walkingAllowance.used>=o.walkingAllowance.limit)return r;o.walkingAllowance.retries++;}
   const retryStart=now();await sleep(retryDelayMs);walkingMetric(o,'retryWaitMs',Math.max(0,now()-retryStart));
  }return r;})();pending.set(key,promise);try{return structuredClone(await promise);}finally{pending.delete(key);if(!pending.size)scopes.delete(o.walkingAllowance??o.signal);}
 }
 return{route,peek,ready:raw.ready,flush:()=>persistentCache?.flush(),stats:()=>({...raw.stats(),persistentCache:persistentCache?.stats()??null,originNavigation,queueConcurrency:concurrency,minStartIntervalMs:Math.max(110,intervalMs),matrixEnabled:false,endpoint:'/direction/v2/walking'})};
}
