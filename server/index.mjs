import {productionIsochroneAlgorithm} from './isochrone-algorithms.mjs';
import{createWalkingCache}from'./walking-cache.mjs';
import{refineAdaptiveDirections}from'./adaptive-directions.mjs';
import{sampleWalkingTimeField,WALKING_TIME_FIELD_VERSION}from'./walking-time-field.mjs';
import{previousWalkingRequests}from'./time-field-refinement.mjs';
import{createAuthorizedWalkingProvider,walkingTaskAllowance}from'./authorized-walking.mjs';
import{createBatchWalkingProvider}from'./batch-walking.mjs';
import{createTimeFieldStore}from'./time-field-store.mjs';
import{createServiceFunctionStore}from'./service-function-store.mjs';
import{createServiceFunctionPlaceProvider}from'./service-function-provider.mjs';
import{createServiceFunctionManager}from'./service-function-manager.mjs';
import{createHash}from'node:crypto';
import {createMapStyleCache} from './map-style-cache.mjs';
import {sampleCenteredWalkingRange,CENTERED_RANGE_VERSION} from './centered-walking-range.mjs';

import{createBaiduIsodistanceProvider}from'./baidu-isodistance.mjs';
import{sampleWalking80Range}from'./walking80-sampling.mjs';
import{ADAPTIVE_SAMPLING_VERSION}from'./adaptive-sampling.mjs';
import{FACILITY_ADAPTIVE_VERSION}from'./facility-analysis.mjs';
import{RECALL_SCHEDULE_VERSION}from'./recall-schedule.mjs';
import{sampleReferenceWalkingRange,REFERENCE_RANGE_VERSION}from'./reference-walking-range.mjs';
import{FACILITY_GROUP_RECALL_VERSION}from'./facility-analysis.mjs';
import{GROUP_RECALL_VERSION}from'./group-recall.mjs';
import{createRequestScheduler}from'./request-scheduler.mjs';
import{createStaticAssets,acceptsGzip}from'./static-assets.mjs';
import{gzipSync}from'node:zlib';
import{createAnalysisArchive}from'./analysis-archive.mjs';
import { appendFile, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWalkingValidation } from './walking-validation.mjs';
import { createAnalysisManager } from './analysis-job.mjs';
import { createFacilityJobManager, validateFacilityV3Input } from './facility-job.mjs';
import { createBaiduRouteProvider } from './baidu-route.mjs';
import { createBaiduIsochroneProvider } from './baidu-isochrone.mjs';
import { buildIsochrone } from './isochrone.mjs';
import { createWalkingProvider } from './walking-provider.mjs';
import { WalkingCostCache } from './travel-cost-analysis.mjs';
import { getFacilityCategory, FACILITY_MAPPING_VERSION, publicFacilityCategoryTree, FACILITY_V5_MAPPING_VERSION, FACILITY_V6_MAPPING_VERSION,FACILITY_V7_MAPPING_VERSION, FACILITY_V8_MAPPING_VERSION } from './facility-categories.mjs';
import {createBaiduWeatherProvider} from './baidu-weather.mjs';
import { createBaiduClient } from './baidu-client.mjs';
import{createWalkingNavigationManager,createNavigationStore}from'./walking-navigation.mjs';
import { createBaiduPlaceProvider } from './baidu-place.mjs';
import { createBaiduTrafficProvider } from './baidu-traffic.mjs';
import { createContextLayerManager } from './context-layers.mjs';
import { getServerConfig, loadLocalEnv, publicMapFeatureFlags, FACILITY_TASK_CONTRACT } from './config.mjs';
import { isValidBd09ll, sampleWalkingNetwork } from './walking-samples.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const webRoot = join(root, 'web');
const staticAssets=createStaticAssets();
await loadLocalEnv(root);
const config = getServerConfig();
const analysisArchive=createAnalysisArchive(root,{adaptiveDirectionsEnabled:config.adaptiveDirections});
const productionRangeAlgorithm=productionIsochroneAlgorithm(config.productionIsochroneAlgorithm);
const walkingCache=config.walkingAcceleration?createWalkingCache({path:join(root,'data/runtime/walking-od-cache.json'),ttlMs:config.walkingCacheTtlSeconds*1000}):null;
await walkingCache?.ready;
const mapStyleCache=createMapStyleCache({root,browserMapAk:config.browserMapAk});
const port = config.port;
const baiduClient = config.serverAk
  ? createBaiduClient({ serverAk: config.serverAk, maxRetries: 0, timeoutMs: config.apiTimeoutMs,minStartIntervalMs:config.serviceMinIntervalMs,serviceIntervals:{place:config.placeMinIntervalMs,geocoding:210},serviceConcurrency:{place:config.placeConcurrency},
      cacheMaxEntries:512,failureCooldownMs:5000,transientFailureThreshold:3 })
  : null;
const placeProvider = baiduClient ? createBaiduPlaceProvider({ client: baiduClient }) : null;
const weatherProvider=baiduClient?createBaiduWeatherProvider({client:baiduClient,requestLimit:32}):null;
const walkingClient=config.serverAk?createBaiduClient({serverAk:config.serverAk,maxRetries:0,timeoutMs:config.apiTimeoutMs,minStartIntervalMs:config.walkingMinIntervalMs,schedulerConcurrency:config.walkingConcurrency,cacheMaxEntries:512,failureCooldownMs:5000,transientFailureThreshold:3}):null;
const routeProvider=walkingClient?createAuthorizedWalkingProvider({client:walkingClient,intervalMs:config.walkingMinIntervalMs,concurrency:config.walkingConcurrency,processLimit:50000,originNavigation:'coordinates',persistentCache:walkingCache,prioritizeSampling:config.walkingAcceleration}):null;
// Navigation is an on-demand presentation request. It shares Walking's client
// scheduler/cooldown but never writes new costs or geometry into an analysis.
const navigationProvider=walkingClient?createBaiduRouteProvider({client:{requestJson:args=>walkingClient.requestJson({...args,params:Object.fromEntries(Object.entries(args.params).filter(([k])=>k!=='origin_uid'))})},liteRequestLimit:64,requestLimitWindowMs:86400000}):null;
const walkingNavigation=createWalkingNavigationManager({provider:navigationProvider,reuseProvider:routeProvider,store:createNavigationStore(join(root,'data/runtime/walking-navigation'))});
// Matrix and single Walking have independent quotas. The 36-bearing contour
// and 1km contour share radial costs; POIs retain their own true path requests.
const matrixClient=config.serverAk?createBaiduClient({serverAk:config.serverAk,maxRetries:0,
 timeoutMs:config.apiTimeoutMs,minStartIntervalMs:0,schedulerConcurrency:2}):null;
const batchWalking=matrixClient?createBatchWalkingProvider({client:matrixClient,
 enabled:config.batchWalkingEnabled,dailyLimit:config.batchWalkingDailyLimit,
 outputQps:config.batchWalkingOutputQps,expiresAt:config.batchWalkingExpiresAt,
 usagePath:join(root,'data/runtime/batch-walking-usage.json'),persistentCache:walkingCache}):null;
const officialProvider=null,distanceProvider=null;
const rangeMatrixStats=()=>batchWalking?.stats()??{matrixOutputRoutes:0,matrixRequests:0};
function boundedRangeMatrix({budget,maxRequests,signal}){
 // An expired grant forbids new HTTP calls, not replay of still-valid measured
 // costs. The provider's reservation gate refuses every uncached expired OD.
 if(!batchWalking||(!batchWalking.stats().enabled&&!walkingCache))return null;
 const telemetry={};return {samplingBatchSize:config.walkingAcceleration?batchWalking.stats().outputQps:undefined,stats:()=>({...telemetry}),routeMany:async options=>{
  const count=options.destinations.length;
  if(signal.aborted)throw signal.reason;
  const uncached=options.destinations.filter(d=>!batchWalking.peek(options.origin,d)).length;
  if(budget.networkRequests+uncached>maxRequests)return options.destinations.map(()=>({routeStatus:'sampling_budget_exhausted'}));
  const call={};budget.networkRequests+=uncached;
  try{return await batchWalking.routeMany({...options,signal,telemetry:call});}
  finally{budget.networkRequests-=uncached-(call.od??0);for(const[k,v]of Object.entries(call))telemetry[k]=(telemetry[k]??0)+v;}
 }};
}
const timeFieldStore=createTimeFieldStore(root),timeFieldOperations=new Map(),timeFieldCache=new Map();
const serviceFunctionStore=createServiceFunctionStore(root);
const serviceFunctionManager=createServiceFunctionManager({store:serviceFunctionStore,placeProvider:baiduClient?createServiceFunctionPlaceProvider({client:baiduClient}):null,routeProvider,
 budgets:{searchLimit:config.serviceFunctionSearchLimit,detailLimit:config.serviceFunctionDetailLimit,originRouteLimit:config.serviceFunctionOriginRouteLimit},
 remainingWalking:async job=>Math.max(0,config.walkingTaskRequestLimit-previousWalkingRequests(job,await timeFieldStore.read(job)))});
async function runInternalTimeField({analysis,geometry,display,signal,onProgress,walkingAllowance,reuse=null}){
 const key=createHash('sha256').update(JSON.stringify([WALKING_TIME_FIELD_VERSION,analysis.origin,geometry?.geojson,geometry?.samples?.map(s=>s.evidenceId),reuse?.samples?.map(s=>s.evidenceId),display?.facilities?.map(p=>p.routeEvidence?.evidenceId)])).digest('hex'),cached=timeFieldCache.get(key);
 if(cached&&cached.expires>Date.now())return{...structuredClone(cached.value),cacheHit:true,requestStats:{httpRequests:0,walkingRequests:0,walkingGeometryRequests:0,cachedOutputs:cached.value.samples.length,outputRoutes:0}};
 const field=await sampleWalkingTimeField({job:{analysis,display,geojson:geometry?.geojson,rangeSamples:geometry?.samples},provider:routeProvider,reuse,maxSamples:18,walkingAllowance,signal,onProgress});
 if(timeFieldCache.size>=8)timeFieldCache.delete(timeFieldCache.keys().next().value);timeFieldCache.set(key,{expires:Date.now()+300000,value:structuredClone(field)});return field;
}
const trafficProvider = baiduClient && config.trafficEnabled && config.trafficEntitlementVerified
  && config.trafficRequestLimit > 0 ? createBaiduTrafficProvider({ client: baiduClient }) : null;
// AOI and event endpoints remain absent until exact entitlements and response contracts are verified.
const contextManager = createContextLayerManager({
  trafficProvider, trafficEnabled: Boolean(trafficProvider),
  trafficRequestLimit: config.trafficRequestLimit,
  aoiEnabled: false, eventsEnabled: false,
});
const samplingCache = new WalkingCostCache();
let facilityManager;
function getFacilityManager() {
  if (!placeProvider || !routeProvider) return null;
  facilityManager ||= createFacilityJobManager({
    repeatableTasks:true,placeProvider, routeProvider, officialProvider,distanceProvider,distanceEnabled:false,distanceEntitlementVerified:false,completeFacilityPaths:config.completeFacilityPaths,
    walkingTaskRequestLimit:config.walkingTaskRequestLimit,rangeStrategy:'walking_batch',timeFieldRunner:null,distanceLastFailure:null,newModelMinIntervalMs:0,placeConcurrency:config.placeConcurrency,routeConcurrency:config.walkingConcurrency,facilityPrefetch:config.facilityPrefetch,
    regionalRunner:null,walkingAcceleration:config.walkingAcceleration,
    boundaryRefiner:config.adaptiveDirections?options=>refineAdaptiveDirections({...options,provider:batchWalking,maxOD:config.adaptiveDirectionODBudget}):null,
    contextManager,
    officialEnabled:false,officialEntitlementVerified:false,
    walkingSamplingEnabled: config.walkingSamplingFallbackEnabled,
    placeRequestLimit: config.placeRequestLimit,
    routeDecisionLimit: config.routeDecisionLimit,
    circleRouteLimit:config.circleRouteLimit, taskPlaceLimit: config.taskPlaceLimit, taskCostLimit: config.taskCostLimit,
    taskDetailLimit: config.taskDetailLimit, taskRouteLimit: config.taskRouteLimit,
    officialRequestLimit:0,
    samplingRequestLimit: config.samplingRequestLimit,
    jobTimeoutMs: config.analysisTimeoutMs,
    samplingRunner: config.walkingSamplingFallbackEnabled ? async ({
      center, origin, walkingModelId, maxRouteCalls, onProgress, budget, maxRequests, signal, onTerminalError,walkingAllowance,
    }) => {
      const requestAllowance={get used(){return budget.networkRequests;},set used(value){budget.networkRequests=value;},limit:maxRequests};
      const provider={route:async(a,b,o={})=>routeProvider.route(a,b,{...o,captureGeometry:true,includeGeometry:true,walkingAllowance,requestAllowance,signal,telemetryPhase:'sampling'}),stats:routeProvider.stats};
      if(walkingModelId==='walking80-v1'){
        const before=rangeMatrixStats(),matrixProvider=boundedRangeMatrix({budget,maxRequests,signal});
        const pathSamplingFactory=()=>sampleReferenceWalkingRange({center,originUid:origin?.uid??null,provider,maxRouteCalls,sampleCount:36,maxRepairCalls:8,signal,onProgress:matrixProvider?()=>{}:onProgress});
        const pathSamplingPromise=config.walkingAcceleration?null:pathSamplingFactory();
        pathSamplingPromise?.catch(()=>{});
        const geometry=await productionRangeAlgorithm.sample({center,originUid:origin?.uid??null,matrixProvider,
         walkingProvider:provider,pathSamplingPromise,pathSamplingFactory,maxRouteCalls,maxMatrixOutputs:matrixProvider?108:0,signal,onProgress});
        const after=rangeMatrixStats(),metrics=matrixProvider?.stats?.();geometry.matrixRequestStats=metrics?{httpRequests:metrics.httpRequests??0,outputRoutes:metrics.od??0,...metrics}:{httpRequests:after.matrixRequests-before.matrixRequests,outputRoutes:after.matrixOutputRoutes-before.matrixOutputRoutes};
        geometry.samplingDiagnostics.matrixTelemetry=metrics??null;
        geometry.samplingDiagnostics.matrixLogicalRounds=geometry.samplingDiagnostics.matrixRequests;
        geometry.samplingDiagnostics.matrixRequests=geometry.matrixRequestStats.httpRequests;
        geometry.samplingDiagnostics.matrixOutputs=geometry.matrixRequestStats.outputRoutes;return geometry;
      }
      return buildIsochrone({ center, provider, maxRouteCalls, onProgress, signal,
        strictEvidence:true,originUid:origin?.uid ?? null });
    } : null,
  });
  return facilityManager;
}
const wenjinValidationCenter = Object.freeze({ lat: 30.288902, lng: 120.150993 });
let analysisManager;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function json(response, statusCode, payload) {
  const text=JSON.stringify(payload),encoded=text.length>16384&&acceptsGzip(response.req?.headers),body=encoded?gzipSync(text):text;
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...(encoded?{'content-encoding':'gzip','vary':'Accept-Encoding'}:{}),
  });
  response.end(body);
}

function haversineMeters(a, b) {
  const rad = (degrees) => degrees * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

async function searchPlaces(url, response) {
  if (!placeProvider) return json(response, 503, { error: '服务端地图服务尚未配置。请检查本地环境配置。' });

  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  const radius = Number(url.searchParams.get('radius') || 1000);
  const categoryId = url.searchParams.get('category') || 'medical';
  const category = getFacilityCategory(categoryId);
  if (!url.searchParams.has('lat') || !url.searchParams.has('lng')
    || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return json(response, 400, { error: '请先在地图上选择有效的中心点。' });
  }
  if (!Number.isFinite(radius) || radius < 100 || radius > 5000) {
    return json(response, 400, { error: '检索半径需在 100–5000 米之间。' });
  }
  if (!category) return json(response, 400, { error: '未知的设施类别。' });

  const center = { lat, lng };
  let result;
  try {
    result = await placeProvider.searchAround({
      center, radiusMeters: radius, categoryId,
      maxRequests: 8, maxPagesPerShard: 4, maxShardDepth: 1,
    });
  } catch {
    return json(response, 502, { error: '地点检索暂不可用。', searchComplete: false, status: 'failed' });
  }
  if (result.status === 'failed') {
    return json(response, 502, {
      error: '地点检索未获得可核验结果，请检查服务端权限、额度和网络。',
      searchComplete: false, status: 'failed', errors: result.errors,
    });
  }
  const candidates = result.candidates.filter((place) => place.classification.candidateStatus !== 'excluded_by_rule');
  const places = candidates.map((place) => ({
    uid: place.uid, name: place.name, address: place.address,
    lat: place.location.lat, lng: place.location.lng,
    location: place.location, naviLocation: place.naviLocation,
    rawCategory: place.rawCategory, matchedQueries: place.matchedQueries,
    category: category.label, categoryId,
    categoryMappingVersion: FACILITY_MAPPING_VERSION,
    candidateStatus: place.classification.candidateStatus,
    distanceMeters: Math.round(haversineMeters(center, place.location)),
  })).sort((a, b) => a.distanceMeters - b.distanceMeters);
  return json(response, 200, {
    category: categoryId, categoryLabel: category.label,
    categoryMappingVersion: FACILITY_MAPPING_VERSION,
    center, radiusMeters: Math.round(radius), coordinateSystem: 'BD-09LL',
    sort: 'straight_line_distance_ascending',
    status: result.status, searchComplete: result.searchComplete,
    truncated: result.truncated, pages: result.pages,
    errors: result.errors, requestStats: result.requestStats,
    candidatesRetrieved: result.candidatesFound,
    excludedByRule: result.candidatesFound - candidates.length,
    count: places.length, places,
  });
}
async function readJsonBody(request, maxBytes = 8192) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('REQUEST_TOO_LARGE'), { statusCode: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('INVALID_JSON'), { statusCode: 400 });
  }
}

async function walkingSamples(request, response) {
  const serverAk = config.serverAk;
  if (!serverAk) return json(response, 503, { error: '服务端地图服务尚未配置。请检查本地环境配置。' });

  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    return json(response, error.statusCode || 400, {
      error: error.message === 'REQUEST_TOO_LARGE' ? '请求内容过大。' : '请求必须是有效的 JSON。',
    });
  }
  const center = { lat: Number(body?.center?.lat), lng: Number(body?.center?.lng) };
  if (!isValidBd09ll(center)) {
    return json(response, 400, { error: '请提供有效的百度经纬度中心点（BD-09LL）。' });
  }

  const result = await sampleWalkingNetwork(center, serverAk);
  if (result.sampleCount === 0) {
    const onlyTimedOut = result.failures.length > 0 && result.failures.every((failure) => failure.reason === 'timeout');
    return json(response, onlyTimedOut ? 504 : 502, {
      code: onlyTimedOut ? 'WALKING_ROUTE_TIMEOUT' : 'NO_WALKING_ROUTES',
      error: onlyTimedOut ? '步行路线请求超时，请稍后重试。' : '百度未返回可用步行路线。',
      ...result,
    });
  }
  return json(response, 200, { status: result.failedCount ? 'partial' : 'ok', ...result });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if(request.method==='POST'&&url.pathname==='/api/map-style'){
    try{let text='',size=0;for await(const chunk of request){size+=chunk.length;if(size>65536)throw Object.assign(new Error('Style body too large'),{statusCode:413});text+=chunk.toString();}
      const value=await mapStyleCache.get(new URLSearchParams(text),{refresh:request.headers['x-refresh-map-style']==='1'});
      const gzip=/\bgzip\b/.test(request.headers['accept-encoding']??'');response.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'private, max-age=600','vary':'Accept-Encoding','x-map-style-source':value.source,...(gzip?{'content-encoding':'gzip'}:{})});response.end(gzip?value.gzip:value.body);
    }catch(e){json(response,e.statusCode??502,{status:1,message:'Published custom style temporarily unavailable'});}return;
  }
  if (request.method === 'GET' && url.pathname === '/api/health') {
    return json(response, 200, {
      ok: true,
      service: 'neighborhood-access-api',
      browserMapConfigured: Boolean(config.browserMapAk),
      placeSearchConfigured: Boolean(config.serverAk),
      featureFlags: publicMapFeatureFlags({...config,isochroneEnabled:false,isodistanceEnabled:false}),
      walkingRuntime:{endpoint:'/direction/v2/walking',matrixEnabled:Boolean(batchWalking?.stats().enabled),batchWalking:batchWalking?.stats()??null,facilityPrefetch:config.facilityPrefetch,taskLimit:config.walkingTaskRequestLimit,facilityPathBudgetMode:config.completeFacilityPaths?'actual_endpoints_with_one_retry':'fixed_task_limit',facilityEndpointCap:config.circleRouteLimit,heatMode:'weighted_poi',heatInternalSamples:0,queueConcurrency:config.walkingConcurrency,minStartIntervalMs:config.walkingMinIntervalMs,qpsEntitlement:10},
      algorithmVersions:{analysis:FACILITY_GROUP_RECALL_VERSION,sampling:CENTERED_RANGE_VERSION,timeField:'direction-internal-time-grid-61-v2',recall:GROUP_RECALL_VERSION,geometry:'boundary-validation-v2'},
      analysisLimits: { ...FACILITY_TASK_CONTRACT, maxPlaceRequestsPerSubtype: 8,
        circleRouteLimit:config.circleRouteLimit, taskPlaceRequestLimit: config.taskPlaceLimit, taskCostRouteLimit: config.taskCostLimit,
        taskRouteDetailLimit: config.taskDetailLimit, currentTaskRouteDecisionLimit: config.taskRouteLimit,
        budgetScope:'task',processPlaceRequestLimit: config.placeRequestLimit, processRouteDecisionLimit: config.routeDecisionLimit,
        lowSamplingRouteCalls:36,rangeStrategy:'centered_matrix_bisection',officialCircleRequests:0,rangeMatrixVerified:Boolean(batchWalking?.stats().enabled),rangeMatrixOutputLimit:108,rangeMatrixOutputQps:config.batchWalkingOutputQps,rangeMatrixStats:rangeMatrixStats() },
    });
  }
  if (request.method === 'GET' && url.pathname === '/api/config') {
    // Only the browser-scoped AK is ever sent to the page; the server AK is never serialized.
    return json(response, 200, { browserMapAk: config.browserMapAk || '',
      productionIsochroneAlgorithm:productionRangeAlgorithm.id });
  }
  if (request.method === 'GET' && url.pathname === '/api/facility-categories') {
    try{return json(response,200,publicFacilityCategoryTree(url.searchParams.get('version') ?? FACILITY_V8_MAPPING_VERSION));}
    catch{return json(response,400,{error:'不支持的分类版本。'});}
  }
  if (request.method === 'GET' && url.pathname === '/api/places') {
    return searchPlaces(url, response);
  }
  if(request.method==='GET'&&url.pathname==='/api/weather'){
    const point={lng:Number(url.searchParams.get('lng')),lat:Number(url.searchParams.get('lat'))};
    if(!url.searchParams.has('lng')||!url.searchParams.has('lat')||!isValidBd09ll(point))return json(response,400,{status:'unavailable',reasonCode:'invalid_location'});
    if(!weatherProvider)return json(response,503,{status:'unavailable',reasonCode:'weather_unconfigured'});
    return json(response,200,await weatherProvider.query(point));
  }
  if (request.method === 'POST' && url.pathname === '/api/walking-samples') {
    return walkingSamples(request, response);
  }
  if (request.method === 'POST' && url.pathname === '/api/walking-validation') {
    return json(response,410,{code:'LEGACY_VALIDATION_RETIRED',error:'旧八类核验入口已停用，请使用当前六类分析与离线验证脚本。'});
  }
  if (url.pathname === '/api/analyses' && request.method === 'POST') {
    let body;
    try { body = await readJsonBody(request); }
    catch (error) {
      return json(response, error.statusCode || 400, { error: '请求必须是有效且不超过 8 KB 的 JSON。' });
    }
    if (body?.version === 2) return json(response, 400, {
      code: 'FACILITY_VERSION_MIGRATION_REQUIRED',
      error: '八类 version=2 新任务已停用，请迁移到 version=6、六大类／17小类和步行15分钟。',
      requiredContract: FACILITY_TASK_CONTRACT,
    });
    if ([3,4,5,6,7,8].includes(body?.version)) {
      try { validateFacilityV3Input(body); }
      catch (error) { return json(response, 400, { error: error.message, requiredContract: FACILITY_TASK_CONTRACT }); }
      const manager = getFacilityManager();
      if (!manager) return json(response, 503, { error: '服务端地图服务尚未配置。' });
      try { return json(response, 202, manager.create(body)); }
      catch (error) {
        return json(response, error.message === 'Too many active analyses.' ? 429 : 400,
          { error: error.message });
      }
    }
    if (!config.walkingSamplingFallbackEnabled) return json(response, 503, { error: '步行采样回退未启用。' });
    if (!config.serverAk) return json(response, 503, { error: '服务端地图服务尚未配置。' });
    try {
      analysisManager ||= createAnalysisManager({ serverAk: config.serverAk });
      return json(response, 202, analysisManager.create(body));
    } catch (error) {
      const budgetExhausted = error instanceof RangeError && error.message === 'Process walking request budget exhausted.';
      return json(response, budgetExhausted ? 429 : 400,
        { error: budgetExhausted ? '本进程步行路线预算已耗尽。' : '请提供有效 BD-09LL 中心点、采样档位并明确确认真实步行采样。' });
    }
  }
  const serviceFunctionMatch=url.pathname.match(/^\/api\/analyses\/(fa-[0-9a-f-]+)\/service-functions$/);
  if(serviceFunctionMatch&&['GET','POST'].includes(request.method)){
   const id=serviceFunctionMatch[1],job=getFacilityManager()?.get(id)??(await analysisArchive.find(id))?.job;
   if(!job?.analysis||!job.score)return json(response,404,{error:'分析证据不存在。'});
   if(!['complete','partial'].includes(job.status))return json(response,409,{error:'请等待设施评估完成。'});
   const op=await serviceFunctionManager.get(job,{start:request.method==='POST'}),{done,...payload}=op;
   return json(response,op.status==='running'?202:200,payload);
  }
  const timeFieldMatch=url.pathname.match(/^\/api\/analyses\/(fa-[0-9a-f-]+)\/time-field$/);
  if(timeFieldMatch&&['GET','POST'].includes(request.method)){
   const id=timeFieldMatch[1],live=getFacilityManager()?.get(id),job=live??(await analysisArchive.find(id))?.job;if(!job?.analysis)return json(response,404,{error:'分析证据不存在。'});
   const saved=await timeFieldStore.read(job)??job.timeField,key=JSON.stringify([id,job.analysis.origin,job.score.evidenceFingerprint]),active=timeFieldOperations.get(key);
   if(active)return json(response,active.status==='sampling'?202:200,active);
   if(saved?.version===WALKING_TIME_FIELD_VERSION)return json(response,200,{status:'complete',field:saved,sourceEvidenceSnapshotId:job.score.evidenceFingerprint});
   if(request.method==='GET')return json(response,200,{status:saved?'legacy_evidence':'not_sampled',field:saved??null,reasonCode:'walking_heat_not_sampled'});
   if(url.searchParams.has('refine'))return json(response,409,{status:'unavailable',reasonCode:'matrix_sampling_not_authorized'});
   const operation={status:'sampling',progress:{phase:'internal_walking_time_samples',completed:0,total:18}},controller=new AbortController(),timer=setTimeout(()=>controller.abort(Error('walking_heat_timeout')),90000);timeFieldOperations.set(key,operation);
   const allowance=walkingTaskAllowance(Math.min(18,Math.max(0,config.walkingTaskRequestLimit-previousWalkingRequests(job,saved))));
   runInternalTimeField({analysis:job.analysis,geometry:{geojson:job.geojson,samples:job.heatSamples??job.rangeSamples},display:job.display,reuse:saved,walkingAllowance:allowance,signal:controller.signal,onProgress:p=>operation.progress=p}).then(async field=>{operation.field=field;operation.status='complete';operation.sourceEvidenceSnapshotId=job.score.evidenceFingerprint;operation.savedPath=await timeFieldStore.write(job,field);}).catch(e=>{operation.status='failed';operation.reasonCode=e.message;}).finally(()=>clearTimeout(timer));
   return json(response,202,operation);
  }
  const navigationMatch=url.pathname.match(/^\/api\/analyses\/(fa-[0-9a-f-]+)\/walking-navigation$/);
  if(request.method==='POST'&&navigationMatch){try{const id=navigationMatch[1],job=getFacilityManager()?.get(id)??(await analysisArchive.find(id))?.job;if(!job)return json(response,404,{error:'分析记录不存在'});const body=await readJsonBody(request),result=await walkingNavigation.get(job,body);return json(response,200,result);}catch(error){return json(response,error.statusCode??400,{error:error.message});}}
  const actionMatch = url.pathname.match(/^\/api\/analyses\/(fa-[0-9a-f-]+)\/(score|cancel|route|representative-routes)$/);
  if (request.method === 'POST' && actionMatch) {
    const manager = getFacilityManager();
    if(manager&&!manager.get(actionMatch[1])){try{const archived=await analysisArchive.find(actionMatch[1]);if(archived?.job&&!archived.job.presentationOnly)manager.restoreCompleted(archived.job);}catch{return json(response,409,{error:'保存的分析暂不能恢复交互，请重新评估该地点。',reasonCode:'archived_task_restore_unavailable'});}}
    if (!manager?.get(actionMatch[1])) return json(response, 404, { error: '分析任务不存在或服务已重启。' });
    if (actionMatch[2] === 'cancel') return json(response, 200, manager.cancel(actionMatch[1]));
    try {
      const body = await readJsonBody(request);
      if (actionMatch[2] === 'representative-routes') {const payload=await manager.representativeRoutes(actionMatch[1],body);return payload?json(response,200,payload):json(response,409,{error:'路线证据尚未完成。'});}
      if (actionMatch[2] === 'route') {
        const controller = new AbortController();
        const disconnected = () => { if (!response.writableEnded) controller.abort(); };
        response.on('close', disconnected);
        try {
          const detail = await manager.routeDetail(actionMatch[1], body, controller.signal);
          return detail ? json(response, 200, detail) : json(response, 409, { error: '路线证据尚未完成。' });
        } finally { response.off('close', disconnected); }
      }
      const score = manager.rescore(actionMatch[1], body);
      return score ? json(response, 200, score)
        : json(response, 409, { error: '分析尚未产生可复用的路线证据。' });
    } catch (error) {
      return json(response, error.statusCode || (error.message === 'Evidence snapshot has changed.' ? 409 : 400),
        { error: error.message });
    }
  }
  const representativeMatch=url.pathname.match(/^\/api\/analyses\/(fa-[0-9a-f-]+)\/representative-routes$/);
  if(request.method==='GET' && representativeMatch){const payload=await getFacilityManager()?.representativeRoutes(representativeMatch[1]);return payload?json(response,200,payload):json(response,404,{error:'分析不存在或未完成。'});}
  const analysisMatch = url.pathname.match(/^\/api\/analyses\/((?:ar|fa)-[0-9a-f-]+)(?:\/(geojson|metrics))?$/);
  if (request.method === 'GET' && analysisMatch) {
    const manager = analysisMatch[1].startsWith('fa-') ? getFacilityManager() : analysisManager;
    const view=!analysisMatch[2]&&url.searchParams.get('view')==='ui'?'ui':'full';
    const job = manager?.get(analysisMatch[1],{view});
    if (!job){const archived=await analysisArchive.find(analysisMatch[1],{view});if(archived){if(!analysisMatch[2])return json(response,200,archived.job);if(analysisMatch[2]==='geojson')return json(response,200,archived.job.geojson);return json(response,200,{archiveReplay:true,status:archived.job.status,requestStats:archived.job.requestStats});}return json(response, 404, { error: '分析任务不存在或服务已重启。' });}
    if (!analysisMatch[2]) return json(response, 200, job);
    const payload = analysisMatch[2] === 'geojson'
      ? manager.geojson(analysisMatch[1]) : manager.metrics(analysisMatch[1]);
    return payload
      ? json(response, 200, payload)
      : json(response, ['failed', 'cancelled'].includes(job.status) ? 409 : 202,
        { status: job.status, progress: job.progress });
  }
  const reportMatch = url.pathname.match(/^\/api\/reports\/(fa-[0-9a-f-]+)$/);
  if (request.method === 'GET' && reportMatch) {
    const manager=getFacilityManager(), liveJob=manager?.get(reportMatch[1]);
    const archived=!liveJob?await analysisArchive.find(reportMatch[1]):null;
    const report=liveJob?manager.report(reportMatch[1]):archived?.report;
    if(!report)return json(response,liveJob?(['failed','cancelled'].includes(liveJob.status)?409:202):404,{status:liveJob?.status,error:liveJob?undefined:'报告不存在或服务已重启。'});
    return json(response,200,report);
  }
  if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed' });

  const isApplicationPage=['/','/console.html','/index.html','/inspection.html'].includes(url.pathname);
  const requestedPath = isApplicationPage&&url.searchParams.get('layout-frame')!=='1'
    ? '/display-shell.html' : url.pathname === '/' ? '/console.html' : decodeURIComponent(url.pathname);
  const filePath = normalize(join(webRoot, requestedPath));
  if (!filePath.startsWith(webRoot)) return json(response, 403, { error: 'Forbidden' });
  try {
    await staticAssets.send(request,response,filePath,mimeTypes[extname(filePath)]||'application/octet-stream');
  } catch {
    json(response, 404, { error: 'Not found' });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`WebGIS starter ready at http://localhost:${port}`);
});
