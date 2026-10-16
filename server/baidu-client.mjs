import{createRequestScheduler}from'./request-scheduler.mjs';
const BASE_URL = 'https://api.map.baidu.com';
export const BAIDU_SERVICE_IDS = Object.freeze([
  'isochrone', 'place', 'route_matrix', 'direction_lite',
  'traffic', 'aoi_boundary', 'traffic_events', 'geocoding', 'weather',
]);
const SERVICES = new Set(BAIDU_SERVICE_IDS);
const PERMISSION_STATUSES = new Set([3, 5, 9, 101, 200, 201, 202, 203, 210, 211, 240]);
const QUOTA_STATUSES = new Set([4, 302]);

export class BaiduApiError extends Error {
  constructor(code, { service, httpStatus = null, apiStatus = null, retryable = false, retryAfterMs } = {}) {
    super(service + ': ' + code);
    this.name = 'BaiduApiError';
    this.code = code;
    this.service = service;
    this.httpStatus = httpStatus;
    this.apiStatus = apiStatus;
    this.retryable = retryable;
    if(retryAfterMs!==undefined)this.retryAfterMs=retryAfterMs;
  }
  toJSON() {
    return {
      code: this.code, service: this.service,
      httpStatus: this.httpStatus, apiStatus: this.apiStatus,
      retryable: this.retryable,
      ...(this.retryAfterMs!==undefined?{retryAfterMs:this.retryAfterMs}:{}),
    };
  }
}

function fromHttpStatus(service, status) {
  if (status === 401 || status === 403) {
    return new BaiduApiError('permission_denied', { service, httpStatus: status });
  }
  if (status === 429) {
    return new BaiduApiError('rate_limited', { service, httpStatus: status, retryable: true });
  }
  if (status === 408 || status === 504) {
    return new BaiduApiError('timeout', { service, httpStatus: status, retryable: true });
  }
  if (status >= 500) {
    return new BaiduApiError('upstream_error', { service, httpStatus: status, retryable: true });
  }
  return new BaiduApiError('http_error', { service, httpStatus: status });
}

function fromApiStatus(service, status) {
  if(service==='weather'){
    if([1,3,4].includes(status))return new BaiduApiError('invalid_request',{service,apiStatus:status});
    if(status===2)return new BaiduApiError('upstream_error',{service,apiStatus:status,retryable:true});
    if(status===102)return new BaiduApiError('rate_limited',{service,apiStatus:status});
  }
  if (PERMISSION_STATUSES.has(status)) {
    return new BaiduApiError('permission_denied', { service, apiStatus: status });
  }
  if (QUOTA_STATUSES.has(status)) {
    return new BaiduApiError('quota_exhausted', { service, apiStatus: status });
  }
  if (status === 401) {
    return new BaiduApiError('rate_limited', { service, apiStatus: status, retryable: true });
  }
  if (status === 1) {
    return new BaiduApiError('upstream_error', { service, apiStatus: status, retryable: true });
  }
  if (status === 2 || status === 8) {
    return new BaiduApiError('invalid_request', { service, apiStatus: status });
  }
  if (status === 260 || status === 261) {
    return new BaiduApiError('service_unavailable', { service, apiStatus: status });
  }
  return new BaiduApiError('provider_error', { service, apiStatus: status });
}

export function createBaiduCacheKey(service, path, params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params).sort(([a], [b]) => a.localeCompare(b))) {
    if (key.toLowerCase() === 'ak') throw new TypeError('AK must be supplied by the client, not request params.');
    if (value != null) query.set(key, String(value));
  }
  return service + '|' + path + '|' + query.toString();
}

function validateRequest(service, path, params, cacheTtlMs) {
  if (!SERVICES.has(service)) throw new TypeError('Unknown Baidu service.');
  if (typeof path !== 'string' || !/^\/[A-Za-z0-9_/-]+$/.test(path)
    || path.startsWith('//') || path.split('/').includes('..')) {
    throw new TypeError('Invalid Baidu API path.');
  }
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new TypeError('Baidu request params must be an object.');
  }
  if (!Number.isInteger(cacheTtlMs) || cacheTtlMs < 0 || cacheTtlMs > 300000) {
    throw new RangeError('Invalid in-memory cache TTL.');
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function withAbort(promise,signal){
 if(signal.aborted)return Promise.reject(signal.reason);
 return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});
  Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
}

// Standard endpoint only. A mock must inject its own fetch and never needs a real AK.
export function createBaiduClient({
  serverAk = '', mode = 'live', fetchImpl, timeoutMs = 8000,
  maxRetries = 1, baseDelayMs = 120, minStartIntervalMs=0, now = Date.now,
  schedulerConcurrency=2,serviceIntervals={},serviceConcurrency={},sleep = delay, logger = () => {}, cacheMaxEntries=512, failureCooldownMs=0, transientFailureThreshold=3,
} = {}) {
  if (mode !== 'live' && mode !== 'mock') throw new TypeError('Invalid Baidu client mode.');
  if (mode === 'live' && !serverAk) throw new TypeError('A server-side map key is required.');
  if (mode === 'mock' && typeof fetchImpl !== 'function') {
    throw new TypeError('Mock mode requires an injected fetch implementation.');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new RangeError('Invalid timeout.');
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 3) throw new RangeError('Invalid retry count.');
  if (!Number.isInteger(baseDelayMs) || baseDelayMs < 0 || baseDelayMs > 2000) throw new RangeError('Invalid retry delay.');
  if(!Number.isInteger(cacheMaxEntries)||cacheMaxEntries<1||cacheMaxEntries>10000||!Number.isInteger(failureCooldownMs)||failureCooldownMs<0||failureCooldownMs>60000
    ||!Number.isInteger(transientFailureThreshold)||transientFailureThreshold<1||transientFailureThreshold>20)throw new RangeError('Invalid bounded cache or failure cooldown.');
  const requestFetch = fetchImpl || fetch;
  const memoryCache = new Map(),pending=new Map(),schedulers=new Map(),failures=new Map();
  const gateKey=(service,path)=>service+'|'+path;
  function pruneCache(){for(const[k,v]of memoryCache)if(v.expiresAt<=now())memoryCache.delete(k);while(memoryCache.size>cacheMaxEntries)memoryCache.delete(memoryCache.keys().next().value);}
  function checkGate(service,path){const state=failures.get(gateKey(service,path));if(!state?.until)return;
   if(state.until!==Infinity&&state.until<=now()){failures.delete(gateKey(service,path));return;}
   throw new BaiduApiError(state.terminal?state.code:'service_cooldown',{service,apiStatus:state.apiStatus,httpStatus:state.httpStatus,retryAfterMs:state.until===Infinity?null:Math.max(0,state.until-now())});}
  function recordFailure(error,path){if(!failureCooldownMs||error.code==='cancelled'||error.code==='service_cooldown')return;
   const key=gateKey(error.service,path),previous=failures.get(key);if(previous?.until>now())return;
   const terminal=['permission_denied','quota_exhausted'].includes(error.code),transient=['timeout','upstream_error','upstream_unavailable','invalid_response','service_unavailable','rate_limited'].includes(error.code);
   if(!terminal&&!transient)return;
   const count=(previous?.count??0)+1,until=terminal?Infinity:error.code==='rate_limited'||count>=transientFailureThreshold?now()+failureCooldownMs:0;
   failures.set(key,{count,until,terminal,code:error.code,apiStatus:error.apiStatus,httpStatus:error.httpStatus});}

  async function performRequest({ service, path, params = {}, cacheTtlMs = 0, signal } = {}) {
    validateRequest(service, path, params, cacheTtlMs);
    const cacheKey = createBaiduCacheKey(service, path, params);
    const cached = memoryCache.get(cacheKey);
    if (cacheTtlMs && cached && cached.expiresAt > now()) {
      memoryCache.delete(cacheKey);memoryCache.set(cacheKey,cached);
      return { data: cached.data, meta: { ...cached.meta, cached: true, attempts: 0 } };
    }
    if(cached?.expiresAt<=now())memoryCache.delete(cacheKey);
    const url = new URL(path, BASE_URL);
    const query = new URLSearchParams(cacheKey.split('|').slice(2).join('|'));
    query.set('ak', mode === 'mock' ? 'mock-ak' : serverAk);
    url.search = query.toString();

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      let failure;
      try {
        if(!schedulers.has(service))schedulers.set(service,createRequestScheduler({concurrency:serviceConcurrency[service]??schedulerConcurrency,minStartIntervalMs:serviceIntervals[service]??minStartIntervalMs}));
        // The deadline starts when a slot is acquired. The slot includes headers AND body parsing.
        const data = await schedulers.get(service)(async()=>{
          checkGate(service,path);
          const timeoutSignal=AbortSignal.timeout(timeoutMs),combinedSignal=signal?AbortSignal.any([timeoutSignal,signal]):timeoutSignal;
          const response=await withAbort(requestFetch(url.toString(),{signal:combinedSignal}),combinedSignal);
          if(!response.ok)throw fromHttpStatus(service,response.status);
          let payload;try{payload=await withAbort(response.json(),combinedSignal);}catch(error){
            if(combinedSignal.aborted)throw combinedSignal.reason;
            throw new BaiduApiError('invalid_response',{service,httpStatus:response.status});}
          if(!payload||!Number.isInteger(payload.status))throw new BaiduApiError('invalid_response',{service,httpStatus:response.status});
          if(payload.status!==0)throw fromApiStatus(service,payload.status);return payload;
        },{signal});
        failures.delete(gateKey(service,path));
        const meta = { service, retrievedAt: new Date(now()).toISOString(), cached: false, attempts: attempt + 1 };
        if (cacheTtlMs){memoryCache.set(cacheKey,{data,meta,expiresAt:now()+cacheTtlMs});pruneCache();}
        return { data, meta };
      } catch (error) {
        if (error instanceof BaiduApiError) failure = error;
        else if (signal?.aborted) failure = new BaiduApiError('cancelled', { service });
        else if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
          failure = new BaiduApiError('timeout', { service, retryable: true });
        } else failure = new BaiduApiError('upstream_unavailable', { service, retryable: true });
      }
      // This event intentionally excludes request URL, query values, upstream message and AK.
      logger({
        service, code: failure.code, attempt: attempt + 1,
        httpStatus: failure.httpStatus, apiStatus: failure.apiStatus,
      });
      if (!failure.retryable || attempt === maxRetries){recordFailure(failure,path);throw failure;}
      await sleep(Math.min(2000, baseDelayMs * (2 ** attempt)));
    }
    throw new BaiduApiError('upstream_unavailable', { service });
  }

  async function requestJson(options={}){
    validateRequest(options.service,options.path,options.params??{},options.cacheTtlMs??0);
    const key=createBaiduCacheKey(options.service,options.path,options.params);
    let scopes=pending.get(key);if(!scopes){scopes=new Map();pending.set(key,scopes);}
    if(scopes.has(options.signal))return structuredClone(await scopes.get(options.signal));
    const promise=performRequest(options);scopes.set(options.signal,promise);
    try{return structuredClone(await promise);}finally{if(scopes.get(options.signal)===promise)scopes.delete(options.signal);if(!scopes.size)pending.delete(key);}
  }
  return Object.freeze({requestJson,resetFailureGate:({service,path})=>failures.delete(gateKey(service,path)),
    stats:()=>({cacheEntries:memoryCache.size,pendingScopes:[...pending.values()].reduce((n,m)=>n+m.size,0),failureGates:failures.size,cacheMaxEntries,maxRetries,minStartIntervalMs})});
}
