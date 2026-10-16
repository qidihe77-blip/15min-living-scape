import{facilitySearchDiagnostics}from'./search-diagnostics.mjs';
import{serviceGapEvidence}from'./service-gap-evidence.mjs';
import{createFacilityPrefetch}from'./facility-prefetch.mjs';
import{walkingTaskAllowance}from'./authorized-walking.mjs';
import{walkingModel,WALKING80_MODEL,BAIDU_TIME_MODEL,withinWalkingLimit}from'../web/walking-model.js';
import{createRequestScheduler}from'./request-scheduler.mjs';
import {representativeRoutes} from './representative-routes.mjs';
import {buildFacilityDisplay,fivePointScore} from './facility-display.mjs';
import {reasonDetail} from './evidence-diagnostics.mjs';
import { randomUUID } from 'node:crypto';
import { createFacilityAnalysis, createLegacyFacilityAnalysis, prepareFacilitySearches } from './facility-analysis.mjs';
import { FACILITY_CATEGORY_IDS, FACILITY_MAPPING_VERSION, FACILITY_GROUP_IDS,
  FACILITY_V3_MAPPING_VERSION, FACILITY_V4_MAPPING_VERSION, FACILITY_V5_MAPPING_VERSION, FACILITY_V6_MAPPING_VERSION, FACILITY_V7_MAPPING_VERSION, FACILITY_V8_MAPPING_VERSION, facilityCategoryTree } from './facility-categories.mjs';
import { scoreFacilityPriorities, scoreSixGroupPriorities } from './priority-score.mjs';
import { createFacilityBudget } from './facility-budget.mjs';
import { applyFacilityRouteDetail } from './facility-route-detail.mjs';
import { decideReachabilitySource } from './reachability-policy.mjs';
import { SAMPLING_BUDGET_PROFILES } from './isochrone.mjs';
import { validBd09ll } from './walking-provider.mjs';
import { buildFacilityReport } from './report.mjs';
import { assessServiceGaps } from './service-gaps.mjs';
import {reweightRegionalGaps} from './regional-gaps.mjs';
import {uiSnapshot} from './ui-snapshot.mjs';
import { validOfficialWalkingRange, validOfficialDistanceRange, validWalkingSamplingSnapshot, reachabilityEvidence } from './reachability-evidence.mjs';

const TERMINAL_ROUTE_ERRORS = new Set(['rate_limited', 'quota_exhausted', 'permission_denied']);
const TERMINAL_SEARCH_ERRORS = new Set(['rate_limited', 'quota_exhausted', 'permission_denied']);
const UNKNOWN_ROUTE = (mode, code) => ({ mode, source: 'none', routeStatus: code,
  durationSeconds: null, distanceMeters: null });

function validateLegacyInput(body) {
  const origin = body?.origin;
  const ids = body?.categoryIds;
  const priorities = body?.priorities;
  if (body?.version !== 2 || !validBd09ll(origin?.location)
    || typeof origin.id !== 'string' || !origin.id || origin.id.length > 100
    || !['baidu_poi', 'map_click', 'adjusted_entrance'].includes(origin.source)
    || !Array.isArray(ids) || ids.length < 1 || ids.length > 8
    || new Set(ids).size !== ids.length || ids.some((id) => !FACILITY_CATEGORY_IDS.includes(id))
    || !['walking', 'cycling', 'driving'].includes(body.mode)
    || ![15, 20, 30].includes(body.minutes)
    || !Number.isInteger(body.searchRadiusMeters ?? 1500)
    || (body.searchRadiusMeters ?? 1500) < 100 || (body.searchRadiusMeters ?? 1500) > 5000
    || !Number.isInteger(body.maxRouteCandidates ?? 3)
    || (body.maxRouteCandidates ?? 3) < 1 || (body.maxRouteCandidates ?? 3) > 4
    || !Object.hasOwn(SAMPLING_BUDGET_PROFILES, body.samplingBudget ?? 'low')
    || !priorities || typeof priorities !== 'object' || Array.isArray(priorities)) {
    throw new TypeError('Invalid version 2 analysis request.');
  }
  for (const [id, value] of Object.entries(priorities)) {
    if (!FACILITY_CATEGORY_IDS.includes(id) || !Number.isInteger(value) || value < 0 || value > 5) {
      throw new RangeError('Priority values must be integers from 0 to 5.');
    }
  }
  if (!ids.some((id) => (priorities[id] ?? (body.version>=8?2:1)) > 0)) {
    throw new RangeError('At least one selected category needs positive priority.');
  }
  if (body.confirmRealWalkingSampling !== true && body.confirmRealWalkingSampling !== false
    && body.confirmRealWalkingSampling !== undefined) {
    throw new TypeError('Sampling confirmation must be a boolean.');
  }
  return {
    origin: {
      id: origin.id, source: origin.source, uid: origin.uid ?? null,
      name: String(origin.name ?? '').slice(0, 160),
      address: String(origin.address ?? '').slice(0, 240),
      location: { lat: origin.location.lat, lng: origin.location.lng },
    },
    categoryIds: [...ids], priorities: { ...priorities },
    mode: body.mode, minutes: body.minutes,
    searchRadiusMeters: body.searchRadiusMeters ?? 1500,
    maxRouteCandidates: body.maxRouteCandidates ?? 3,
    samplingBudget: body.samplingBudget ?? 'low',
    confirmRealWalkingSampling: body.confirmRealWalkingSampling === true,
  };
}

export function validateFacilityV3Input(body) {
  if (body?.version === 2) throw new TypeError('Version 2 tasks are retired; migrate to version 3, six groups and walking 15 minutes.');
  const origin = body?.origin ?? body?.analysisLocation, ids = body?.categoryIds;
  const walkingModelId=body?.walkingModelId??(body?.version>=7?WALKING80_MODEL:BAIDU_TIME_MODEL);walkingModel(walkingModelId);
  if(walkingModelId===WALKING80_MODEL&&![6,7,8].includes(body?.version))throw new TypeError('80m/min model requires the v6/v7 classification.');
  const current = body?.version >= 4;
  const mappingVersion = body?.version===8?FACILITY_V8_MAPPING_VERSION:body?.version===7?FACILITY_V7_MAPPING_VERSION:body?.version===6?FACILITY_V6_MAPPING_VERSION:body?.version===5?FACILITY_V5_MAPPING_VERSION:current?FACILITY_V4_MAPPING_VERSION:FACILITY_V3_MAPPING_VERSION;
  const analysisLocation = body?.analysisLocation ?? origin;
  const pointValid = point => validBd09ll(point?.location) && typeof point.id==='string' && point.id.length>0 && point.id.length<=100
    && ['baidu_poi','map_click','adjusted_entrance'].includes(point.source)
    && (point.uid==null || (typeof point.uid==='string' && point.uid.trim() && point.uid.length<=200));
  if (![3,4,5,6,7,8].includes(body?.version) || body.categoryMappingVersion !== mappingVersion || !pointValid(analysisLocation)
    || !validBd09ll(origin?.location) || typeof origin.id !== 'string' || !origin.id || origin.id.length > 100
    || !['baidu_poi', 'map_click', 'adjusted_entrance'].includes(origin.source)
    || (origin.uid != null && (typeof origin.uid !== 'string' || !origin.uid.trim() || origin.uid.length > 200))
    || !Array.isArray(ids) || ids.length !== 6 || new Set(ids).size !== 6
    || ids.some((id) => !FACILITY_GROUP_IDS.includes(id))
    || body.mode !== 'walking' || body.minutes !== 15 || (body.subtypeScope ?? 'all') !== 'all'
    || ['activeCategoryId', 'activeSubtypeId', 'selectedCategoryIds', 'subtypeIds', 'subtypeId', 'maxRouteCandidates'].some((key) => Object.hasOwn(body, key))
    || !Number.isInteger(body.searchRadiusMeters ?? 1500) || (body.searchRadiusMeters ?? 1500) < 100
    || (body.searchRadiusMeters ?? 1500) > 5000
    || !Number.isInteger(body.maxRouteCandidatesPerSubtype ?? (body.version>=6?3:1))
    || (body.maxRouteCandidatesPerSubtype ?? (body.version>=6?3:1)) < 1 || (body.maxRouteCandidatesPerSubtype ?? (body.version>=6?3:1)) > 3
    || !Object.hasOwn(SAMPLING_BUDGET_PROFILES, body.samplingBudget ?? 'low')
    || (body.region != null && (typeof body.region !== 'string' || body.region.length > 100))) {
    throw new TypeError('Invalid version 3 request: all six groups, all subtypes, walking 15 minutes and current mapping are required.');
  }
  if (body.includeReachableNetwork != null && typeof body.includeReachableNetwork !== 'boolean') throw new TypeError('Network option must be boolean.');
  if(body.version>=6 && !['all_candidates','nearest_candidates','circle_candidates'].includes(body.routeScope ?? (body.version>=7?'circle_candidates':'all_candidates')))throw new TypeError('Invalid route scope.');
  if(body.version<6 && body.routeScope!==undefined)throw new TypeError('Route scope requires v6.');
  const priorities = body.priorities ?? {};
  validateV3Priorities(priorities,body.version);
  if (body.confirmRealWalkingSampling != null && typeof body.confirmRealWalkingSampling !== 'boolean') {
    throw new TypeError('Sampling confirmation must be a boolean.');
  }
  return { version: body.version, walkingModelId, categoryMappingVersion: mappingVersion,
    analysisLocation:{id:analysisLocation.id,source:analysisLocation.source,uid:analysisLocation.uid?.trim() ?? null,name:String(analysisLocation.name ?? '').slice(0,160),address:String(analysisLocation.address ?? '').slice(0,240),location:{...analysisLocation.location}},
    origin: { id: origin.id, source: origin.source, uid: origin.uid?.trim() ?? null,
      name: String(origin.name ?? '').slice(0, 160), address: String(origin.address ?? '').slice(0, 240),
      location: { lat: origin.location.lat, lng: origin.location.lng } },
    categoryIds: [...FACILITY_GROUP_IDS], region: body.region ?? '', subtypeScope: 'all',
    includeReachableNetwork: body.includeReachableNetwork === true, routeScope:body.version>=6?(body.routeScope ?? (body.version>=7?'circle_candidates':'all_candidates')):'nearest_candidates',
    mode: 'walking', minutes: 15, searchRadiusMeters: body.searchRadiusMeters ?? 1500,
    maxRouteCandidatesPerSubtype: body.maxRouteCandidatesPerSubtype ?? (body.version>=6?3:1),
    priorities: Object.fromEntries(FACILITY_GROUP_IDS.map((id) => [id, priorities[id] ?? (body.version>=8?2:1)])),
    samplingBudget: body.samplingBudget ?? 'low', confirmRealWalkingSampling: body.confirmRealWalkingSampling === true };
}
function validateV3Priorities(priorities,version=3) {
  if (!priorities || typeof priorities !== 'object' || Array.isArray(priorities)
    || Object.entries(priorities).some(([id, value]) => !FACILITY_GROUP_IDS.includes(id)
      || !Number.isInteger(value) || value < (version>=8?1:0) || value > (version>=8?3:6))) throw new RangeError('Six-group priorities must be integers from 0 to 6.');
}
export function createFacilityJobManager({
  placeProvider, routeProvider, officialProvider = null, samplingRunner = null,
  distanceProvider=null,distanceEnabled=false,distanceEntitlementVerified=false,distanceLastFailure=null,newModelMinIntervalMs=500,
  officialEnabled = false, officialEntitlementVerified = false,
  walkingSamplingEnabled = false,
  placeRequestLimit = 64, routeDecisionLimit = 96,
  circleRouteLimit=1000, taskPlaceLimit = 30, taskCostLimit = 25, taskDetailLimit = 6, taskRouteLimit = 31,
  officialRequestLimit = 0, samplingRequestLimit = 176,
  contextManager = null,
  jobTimeoutMs = 600000,
  legacyReplay = false, pipelineSearch = true,
  repeatableTasks=false,placeConcurrency=2,routeConcurrency=2,rangeStrategy='official_first',regionalRunner=null,timeFieldRunner=null,walkingTaskRequestLimit=null,facilityPrefetch=false,completeFacilityPaths=false,walkingAcceleration=false,boundaryRefiner=null,
} = {}) {
  if (!placeProvider?.searchAround || !routeProvider?.route) {
    throw new TypeError('Place and route providers are required.');
  }
  for (const limit of [placeRequestLimit, routeDecisionLimit, officialRequestLimit, samplingRequestLimit,
    taskPlaceLimit, taskCostLimit, taskDetailLimit, taskRouteLimit,circleRouteLimit]) {
    if (!Number.isInteger(limit) || limit < 0) throw new RangeError('Invalid process request budget.');
  }
  if (!Number.isInteger(jobTimeoutMs) || jobTimeoutMs < 1000) throw new RangeError('Invalid job timeout.');

  const modelRouteQueue=createRequestScheduler({concurrency:routeConcurrency,minStartIntervalMs:newModelMinIntervalMs});
  const jobs = new Map();
  const uiCache=new WeakMap();
  const queue = [];
  const process = { placeRequests: 0, routeDecisions: 0, officialRequests: 0, samplingRequests: 0 };
  const lifetime={...process};
  function recordBudget(job){if(!repeatableTasks)return;const old=job.accountedBudget??{};for(const key of Object.keys(lifetime))lifetime[key]+=Math.max(0,(job.executionBudget?.[key]??0)-(old[key]??0));job.accountedBudget={...job.executionBudget};if(job.requestStats)job.requestStats.lifetime={...lifetime};}
  let active = false;
  let routeQueue = Promise.resolve();
  const runRoute = (operation) => {
    const promise = routeQueue.then(operation, operation);
    routeQueue = promise.catch(() => {});
    return promise;
  };

  function publicJob(job) {
    if (!job) return null;
    const { controller, input, budget, executionBudget, accountedBudget, detailQueue, searchPromise, prefetchPromise, ...safe } = job;
    const display=!legacyReplay&&job.analysis?buildFacilityDisplay(job):null;
    return structuredClone({ ...safe, reachability: !legacyReplay && job.analysis ? reachabilityEvidence(job) : undefined, context: contextManager?.freshen(job.context) ?? job.context,
      analysisLocation:input.analysisLocation ?? input.origin, representativeRoutes:job.analysis && !legacyReplay ? representativeRoutes(job.analysis) : undefined,
      display,serviceGapEvidence:!legacyReplay&&job.analysis&&job.score?serviceGapEvidence({...job,display}):null,scoreDisplay:input.version>=6&&job.score?fivePointScore(job.score):undefined,
      origin: input.origin, categoryIds: input.categoryIds,
      mode: input.mode, minutes: input.minutes,
      samplingConfirmed: input.confirmRealWalkingSampling });
  }

  async function execute(job) {
    const signal = job.controller.signal;
    const input = job.input;
    const taskBudget=repeatableTasks?(job.executionBudget??={placeRequests:0,routeDecisions:0,officialRequests:0,samplingRequests:0}):process;
    const fixed80=input.walkingModelId===WALKING80_MODEL,batchMode=rangeStrategy==='walking_batch'&&fixed80,referenceMode=batchMode||rangeStrategy==='walking_reference'||input.version>=7, officialService=fixed80?'isodistance':'isochrone', officialSource=fixed80?'baidu_isodistance':'baidu_isochrone';
    const activeOfficial=referenceMode?null:fixed80?distanceProvider:officialProvider, activeOfficialEnabled=!referenceMode&&(fixed80?distanceEnabled:officialEnabled), activeVerified=!referenceMode&&(fixed80?distanceEntitlementVerified:officialEntitlementVerified);
    let searchHalted = false;
    let routeHalted = false;
    let requestStats = { placeRequests: 0, routeDecisions: 0,
      matrixOutputRoutes: 0, liteRequests: 0, samplingRequests: 0, officialRequests: 0 };
    let scopedPlace = { searchAround: async (options) => {
      const remaining = Math.min(8, placeRequestLimit - taskBudget.placeRequests);
      if (signal.aborted || searchHalted || remaining <= 0) {
        const code = signal.aborted ? 'cancelled' : searchHalted ? 'service_halted' : 'place_request_limit_reached';
        return { status: 'failed', searchComplete: false, truncated: true,
          candidates: [], pages: [], errors: [{ code }], requestStats: { logicalRequests: 0 } };
      }
      const result = await placeProvider.searchAround({ ...options, maxRequests: remaining, signal });
      const used = Math.min(remaining, Math.max(0, result.requestStats?.logicalRequests ?? 0));
      taskBudget.placeRequests += used;
      requestStats.placeRequests += used;
      if (result.errors?.some((error) => TERMINAL_SEARCH_ERRORS.has(error.code))) searchHalted = true;
      return result;
    } };
    let scopedRoute = {
      route: async (origin, destination, options = {}) => {
        if (signal.aborted) return UNKNOWN_ROUTE(input.mode, 'cancelled');
        if (routeHalted) return UNKNOWN_ROUTE(input.mode, 'service_halted');
        if (requestStats.routeDecisions >= 24 || taskBudget.routeDecisions >= routeDecisionLimit) {
          return UNKNOWN_ROUTE(input.mode, 'route_request_limit_reached');
        }
        taskBudget.routeDecisions += 1;
        requestStats.routeDecisions += 1;
        const before = routeProvider.stats?.().liteRequests ?? 0;
        const route = await routeProvider.route(origin, destination, { ...options, signal });
        requestStats.liteRequests += Math.max(0, (routeProvider.stats?.().liteRequests ?? 0) - before);
        if (TERMINAL_ROUTE_ERRORS.has(route?.routeStatus)) routeHalted = true;
        return route;
      },
      canBatch: (mode, count) => Boolean(routeProvider.routeMany && routeProvider.canBatch
        && !signal.aborted && !routeHalted && count <= 24 - requestStats.routeDecisions
        && count <= routeDecisionLimit - taskBudget.routeDecisions
        && routeProvider.canBatch(mode, count)),
      routeMany: async ({ origin, destinations, mode }) => {
        const count = destinations.length;
        if (!scopedRoute.canBatch(mode, count)) {
          return destinations.map(() => UNKNOWN_ROUTE(mode, 'route_request_limit_reached'));
        }
        taskBudget.routeDecisions += count;
        requestStats.routeDecisions += count;
        const before = routeProvider.stats?.() ?? {};
        const results = await routeProvider.routeMany({ origin, destinations, mode, signal });
        const after = routeProvider.stats?.() ?? {};
        requestStats.matrixOutputRoutes += Math.max(0, (after.matrixOutputRoutes ?? 0) - (before.matrixOutputRoutes ?? 0));
        requestStats.liteRequests += Math.max(0, (after.liteRequests ?? 0) - (before.liteRequests ?? 0));
        if (results.some((route) => TERMINAL_ROUTE_ERRORS.has(route?.routeStatus))) routeHalted = true;
        return results;
      },
    };

    if (!legacyReplay) {
      job.walkingAllowance=walkingTaskRequestLimit===null?null:walkingTaskAllowance(walkingTaskRequestLimit);
      job.budget = createFacilityBudget({completeFacilityPaths,walkingAllowance:job.walkingAllowance, placeProvider, routeProvider, processBudget: taskBudget, input, signal, runRoute:fixed80?operation=>modelRouteQueue(operation,{signal}):runRoute,
        limits: { place: placeRequestLimit, route: routeDecisionLimit,
          circleRoute:circleRouteLimit, taskPlace: taskPlaceLimit, taskCost: taskCostLimit, taskDetail: taskDetailLimit, taskRoute: taskRouteLimit } });
      scopedPlace = job.budget.place; scopedRoute = job.budget.route; requestStats = job.budget.stats;
      job.requestStats = requestStats;
    }
    const rangeStarted=performance.now();
    // Place searches use the analysis location, independent of range geometry.
    // Preserve serial Place and Lite request rates; only overlap independent services.
    const preparedSearches=!legacyReplay&&input.version>=6&&(!fixed80||batchMode)&&pipelineSearch?Promise.resolve().then(()=>prepareFacilitySearches({placeProvider:scopedPlace,analysisLocation:input.analysisLocation,categoryMappingVersion:input.categoryMappingVersion,searchRadiusMeters:input.searchRadiusMeters,concurrency:fixed80?placeConcurrency:1,signal})):null;
    preparedSearches?.catch(()=>{});
    job.searchPromise=preparedSearches;
    const prefetch=facilityPrefetch&&batchMode&&input.routeScope==='circle_candidates'&&preparedSearches
      ?createFacilityPrefetch({preparedSearches,origin:input.origin,mappingVersion:input.categoryMappingVersion,
       provider:routeProvider,walkingAllowance:job.walkingAllowance,walkingModelId:input.walkingModelId,signal,maxCandidates:circleRouteLimit,optimized:walkingAcceleration}):null;
    job.prefetchPromise=prefetch?.promise;
    const canonicalRoute=scopedRoute.route;
    if(prefetch){scopedRoute.route=async(a,b,o={})=>{
      if(signal.aborted)throw signal.reason;
      const hit=await prefetch.claim(a,b,o);
      if(hit){job.walkingAllowance.cacheHits++;return hit;}
      return canonicalRoute(a,b,o);
    };}
    let geometry = null;
    let analysis;
    async function runFacilities() {
      const analyzeFactory = legacyReplay ? createLegacyFacilityAnalysis : createFacilityAnalysis;
      analysis = await analyzeFactory({ placeProvider: scopedPlace, routeProvider: scopedRoute,concurrency:fixed80?placeConcurrency:1 }).analyze({
        origin: input.origin, analysisLocation: input.analysisLocation, categoryMappingVersion:input.categoryMappingVersion, categoryIds: input.categoryIds, mode: input.mode, minutes: input.minutes,
        searchRadiusMeters: input.searchRadiusMeters, maxRouteCandidates: input.maxRouteCandidates,
        region: input.region, subtypeScope: input.subtypeScope,
        maxRouteCandidatesPerSubtype: input.maxRouteCandidatesPerSubtype, routeScope:input.routeScope, walkingModelId:input.walkingModelId, geometry, preparedSearches, signal,
        onProgress: (value) => { job.progress = value; } });
      if (signal.aborted) throw signal.reason;
      analysis.analysisId = job.analysisId;
      job.analysis = analysis;
      if (!legacyReplay) job.serviceGaps = assessServiceGaps(analysis);
      job.score = legacyReplay ? scoreFacilityPriorities({ analysis, priorities: input.priorities })
        : scoreSixGroupPriorities({ analysis, priorities: input.priorities });
    }
    // Publish the facility snapshot before optional geometry starts.
    if (!legacyReplay && input.version<6) await runFacilities();
    const policyInput = {
      mode: input.mode, samplingBudget: input.samplingBudget,
      allowWalkingSamplingFallback: input.confirmRealWalkingSampling && walkingSamplingEnabled && input.mode === 'walking' && input.minutes === 15,
      walkingRouteAvailable: Boolean(samplingRunner),
      walkingRemainingRequests: Math.max(0, samplingRequestLimit - taskBudget.samplingRequests),
    };
    let decision = decideReachabilitySource({ ...policyInput,
      officialEnabled: activeOfficialEnabled && Boolean(activeOfficial) && !job.budget?.halted(officialService),
      officialEntitlementVerified:activeVerified,
      officialRemainingRequests: Math.max(0, officialRequestLimit - taskBudget.officialRequests),
      serviceHalted: false,
    });
    if(decision.geometrySource==='baidu_isochrone')decision={...decision,geometrySource:officialSource};
    if(referenceMode&&decision.geometrySource==='walking_sampling_fallback')decision={...decision,reason:batchMode?'batch_walking_sampling':'reference_walking_sampling',maxRouteCalls:Math.min(batchMode?36:32,policyInput.walkingRemainingRequests)};
    if(fixed80&&!activeVerified&&!referenceMode)job.rangeFailures.push(reasonDetail(distanceLastFailure?.reasonCode??'permission_unverified',{service:'isodistance',apiStatus:distanceLastFailure?.apiStatus??null}));
    job.reachabilityDecision = { ...decision,walkingModelId:input.walkingModelId, samplingConfirmed: input.confirmRealWalkingSampling,
      officialEntitlementVerified:activeVerified, officialRemainingRequests: Math.max(0, officialRequestLimit - taskBudget.officialRequests) };
    if(!referenceMode&&taskBudget[officialService+'Failure'])job.rangeFailures.push({...taskBudget[officialService+'Failure'],reusedPreviousFailure:true});
    if (decision.geometrySource === officialSource && !job.budget?.halted(officialService)) {
      taskBudget.officialRequests += 1;
      requestStats.officialRequests += 1;
      job.progress = { phase: 'official_isochrone', completed: 0, total: 1 };
      try {
        geometry = fixed80?await activeOfficial.getIsodistance({center:input.origin.location,signal}):await activeOfficial.getIsochrone({ center: input.origin.location,mode: input.mode, minutes: input.minutes, signal });
        if (geometry?.geometrySource !== officialSource
          || !Array.isArray(geometry.geojson?.features) || geometry.geojson.features.length === 0
          || (!legacyReplay && !(fixed80?validOfficialDistanceRange(geometry,input.origin.location):validOfficialWalkingRange(geometry, input.origin.location)))) {
          throw new Error('Empty or invalid official geometry.');
        }
      } catch (error) {
        // Isochrone permission/quota is scoped to that service, not Walking/Place.
        job.rangeFailures.push(reasonDetail(error?.code ?? 'invalid_geometry',{service:officialService,apiStatus:error?.apiStatus ?? null,httpStatus:error?.httpStatus ?? null,
          ...(error?.geometryReasonCode?{geometryReasonCode:error.geometryReasonCode}:{})}));
        if(['permission_denied','permission_expired','quota_exhausted'].includes(error?.code)){
          taskBudget.haltCodes??={};taskBudget.haltCodes[officialService]=error.code;
          taskBudget[officialService+'Failure']=reasonDetail(error.code,{service:officialService,apiStatus:error.apiStatus??null,httpStatus:error.httpStatus??null});
        }
        job.warnings.push('official_isochrone_unavailable');
        geometry = null;
        decision = decideReachabilitySource({ ...policyInput, serviceHalted: Boolean(job.budget?.halted()) });
        job.reachabilityDecision = { ...decision, samplingConfirmed: input.confirmRealWalkingSampling,
          officialEntitlementVerified:activeVerified, walkingModelId:input.walkingModelId, officialFailure: error?.code ?? 'upstream_unavailable' };
      }
    }
    if (!geometry && decision.geometrySource === 'walking_sampling_fallback' && samplingRunner && !job.budget?.halted()) {
      job.progress = { phase: 'walking_sampling', completed: 0, total: decision.maxRouteCalls };
      const before = taskBudget.samplingRequests;
      const samplingBudget = { networkRequests: taskBudget.samplingRequests };
      try {
        geometry = await samplingRunner({ center: input.origin.location,
          origin:input.origin,walkingModelId:input.walkingModelId,walkingAllowance:job.walkingAllowance,
          maxRouteCalls: decision.maxRouteCalls, signal,
          onProgress: (value) => { job.progress = value; },
          budget: samplingBudget, maxRequests: samplingRequestLimit,
          onTerminalError: (code) => { if (!legacyReplay && TERMINAL_ROUTE_ERRORS.has(code)){if(input.version>=4){taskBudget.haltCodes ??={};taskBudget.haltCodes.route=code;}else taskBudget.haltCode=code;} } });
        if (!legacyReplay && !validWalkingSamplingSnapshot(geometry, input.origin.location,input.version>=4?input.origin.uid:undefined)) {
          throw new Error('Invalid walking sampling snapshot.');
        }
      } catch (error) {
        job.rangeFailures.push(reasonDetail(error?.code ?? 'invalid_sampling_geometry',{service:'walking_sampling'}));
        geometry = null;
        job.warnings.push('walking_sampling_unavailable');
      }
      taskBudget.samplingRequests = samplingBudget.networkRequests;
      requestStats.samplingRequests = taskBudget.samplingRequests - before;
      if(geometry?.matrixRequestStats){requestStats.samplingMatrixRequests=geometry.matrixRequestStats.httpRequests;requestStats.samplingMatrixOutputRoutes=geometry.matrixRequestStats.outputRoutes;}
      if(batchMode){requestStats.samplingBudgetUnit='output_route';requestStats.samplingOutputRoutes=requestStats.samplingRequests;requestStats.samplingHttpRequests=(requestStats.samplingRequests-(requestStats.samplingMatrixOutputRoutes??0))+(requestStats.samplingMatrixRequests??0);}
    }
    if (!geometry) job.warnings.push('geometry_unknown');
    if(geometry?.sampleMetrics?.providerFailure)job.rangeFailures.push(reasonDetail(geometry.sampleMetrics.providerFailure.reasonCode,
      {service:'walking_sampling',apiStatus:geometry.sampleMetrics.providerFailure.apiStatus,httpStatus:geometry.sampleMetrics.providerFailure.httpStatus}));
    job.rangeDiagnostics={status:geometry?.geometryStatus ?? (geometry?'available':'unknown'),source:geometry?.geometrySource ?? 'none',
      origin:input.origin,mode:'walking',thresholdSeconds:900,coordinateSystem:'BD-09LL',
      reasonCode:geometry?.geometryStatus==='unknown'?geometry.samplingDiagnostics?.boundaryReasonCode??'insufficient_sampling':!geometry?decision.reason:null,
      samplingDiagnostics:geometry?.samplingDiagnostics??null,strategy:batchMode?'walking_batch':referenceMode?'reference_walking':'official_first',
      failures:job.rangeFailures,decision,unknownRegions:geometry?.unknownRegions ?? (['baidu_isochrone','baidu_isodistance'].includes(geometry?.geometrySource)
        ?{continuousRangeAvailable:true,source:'official_range',outsideReturnedGeometry:'outside_official_range',individualEntrancesVerified:false}
        :{scope:'all_unverified',continuousRangeAvailable:false}),
      walkingModel:fixed80?walkingModel(WALKING80_MODEL):walkingModel(BAIDU_TIME_MODEL),
      officialConfiguration:{service:officialService,enabled:activeOfficialEnabled,entitlementVerified:activeVerified,
        haltedReason:taskBudget.haltCodes?.[officialService]??null,
        requestLimit:officialRequestLimit,remainingRequests:Math.max(0,officialRequestLimit-taskBudget.officialRequests),
        reasonCode:referenceMode?'official_skipped_by_user_strategy':!activeOfficialEnabled?'official_disabled':!activeVerified?'official_entitlement_unverified':officialRequestLimit===0?'official_budget_exhausted':null},
      limits:{official:officialRequestLimit,samplingProcess:samplingRequestLimit,maxSamplingCalls:decision.maxRouteCalls},
      note:referenceMode?'32方向按真实路径及1200米距离份额估计边界点；这些点并非独立路线核验的目的地，未测内部未知，POI仍单独核验真实成本。':geometry?.geometrySource==='baidu_isodistance'?'官方1200米步行等距范围；按80m/min估算15分钟，设施仍需独立真实路线核验。':geometry?.geometryStatus==='sampled_approximation'?'连接已实测可达方向点形成采样近似边界；未测内部与方向之间区域未知，不代表完整路网等时圈。':'采样仅是实测目的地代理；未生成连续边界、未插值空白区域。'};
    if (signal.aborted) throw signal.reason;

    const rangeMs=performance.now()-rangeStarted;
    prefetch?.stop();
    if (legacyReplay || input.version>=6) await runFacilities();
    await prefetch?.promise;
    scopedRoute.route=canonicalRoute;
    if(batchMode&&fixed80&&geometry&&boundaryRefiner){
      const snapshot={analysis,geojson:geometry.geojson,geometrySource:geometry.geometrySource};
      try{geometry=await boundaryRefiner({geometry,origin:input.origin,facilities:buildFacilityDisplay(snapshot)?.facilities??[],signal});}
      catch(error){if(signal.aborted)throw error;geometry={...geometry,adaptiveDirections:{status:'fallback',reasonCode:'adaptive_refinement_failed',requests:{},elapsedMs:0}};}
      job.adaptiveDirections=geometry.adaptiveDirections??null;
      requestStats.adaptiveMatrixRequests=job.adaptiveDirections?.requests?.httpRequests??0;
      requestStats.adaptiveMatrixOutputRoutes=job.adaptiveDirections?.requests?.od??0;
      job.rangeDiagnostics.adaptiveDirections=job.adaptiveDirections;
      job.adaptiveBoundaryEstimates=geometry.adaptiveBoundaryEstimates??[];
      job.baseGeojson=geometry.baseGeojson??null;
    }
    if(batchMode){job.rangeDiagnostics.engine=geometry?.engine??null;job.rangeDiagnostics.degraded=geometry?.degraded??false;
      job.rangeDiagnostics.originContained=geometry?.samplingDiagnostics?.originContained??null;
      job.rangeDiagnostics.note=geometry?.referenceOnly?'仅理论参考圈，未作为可达或评分证据。'
       :geometry?.samplingDiagnostics?.matrixUsed?'36方向三轮矩阵步行成本二分、径向外推与原始折线；起点包含校验已通过。'
        :'36方向真实步行成本径向外推近似；设施仍独立核验真实成本。';}
    job.performance={...analysis.performance,rangeMs,adaptiveMs:job.adaptiveDirections?.elapsedMs??0,pipelineSearch:Boolean(preparedSearches),perServiceConcurrency:{place:fixed80?placeConcurrency:1,facilityRoute:fixed80?routeConcurrency:1,sampling:routeProvider.stats?.().queueConcurrency??2},modelMinIntervalMs:fixed80?newModelMinIntervalMs:0,matrixActivated:Boolean(geometry?.samplingDiagnostics?.matrixUsed)};
    job.progress = { phase: 'context', completed: 0, total: 1 };
    job.context = contextManager ? await contextManager.load({ mode: input.mode,
      origin: input.origin, signal }) : null;
    if (signal.aborted) throw signal.reason;
    job.geometrySource = geometry?.geometrySource ?? 'none';
    job.geometryStatus = geometry?.geometryStatus ?? (geometry ? 'available' : 'unknown');
    job.geojson = geometry?.geojson ?? null;
    job.sampleMetrics = geometry?.sampleMetrics ?? null;
    job.rangeSamples=referenceMode?(geometry?.samples??[]).map(s=>({...s,boundaryEstimate:s.boundaryEstimate?{...s.boundaryEstimate,prefix:undefined}:undefined})):undefined;
    job.boundaryEstimates=geometry?.boundaryEstimates;
    job.geometryWarnings = geometry?.warnings ?? [];
    job.geometryProvenance = geometry ? { source: job.geometrySource,
      algorithmVersion: geometry.algorithmVersion ?? null, coordinateSystem: geometry.coordinateSystem,
      mode: input.mode, thresholdSeconds: input.minutes * 60, center: geometry.center ?? null,
      providerRetrievedAt: geometry.retrievedAt ?? null, computedAt: new Date().toISOString() } : null;
    // Explicit task option: supplement a finite network after the core evidence.
    // Same detail budget as user-opened paths, never six additional free calls.
    if (!legacyReplay && input.includeReachableNetwork) {
      const seen = new Set();
      const requestsBefore = requestStats.detailRequests;
      const selected = analysis.categories.flatMap((group) => {
        const candidates = group.subtypeResults.flatMap((sub) => sub.routes).filter((row) =>
          row.routeStatus === 'ok' && row.classification?.candidateStatus === 'confirmed_by_rule'
          && withinWalkingLimit(row) && !row.geometry && !seen.has(row.identityKey));
        candidates.sort((a,b)=>a.distanceMeters-b.distanceMeters || a.durationSeconds-b.durationSeconds);
        const route = candidates[0];
        if (route) seen.add(route.identityKey);
        return route ? [route] : [];
      });
      let processed = 0;
      job.progress = { phase: 'reachable_network', completed: 0, total: selected.length };
      for (const previous of selected) {
        if (signal.aborted) throw signal.reason;
        if (job.budget.halted()) break;
        const result = await scopedRoute.route(previous.origin, previous.destination, {
          mode: 'walking', originUid: previous.originUid, destinationUid: previous.destinationUid,
          includeGeometry: true, signal,
        });
        if (signal.aborted) throw signal.reason;
        if (['route_detail_limit_reached', 'route_request_limit_reached', 'service_halted'].includes(result.routeStatus)) break;
        if (result.routeStatus === 'ok') {
          analysis = await applyFacilityRouteDetail(analysis, previous, result);
          job.analysis = analysis;
          job.score = scoreSixGroupPriorities({ analysis, priorities: input.priorities });
        }
        processed++;
        job.progress = { phase: 'reachable_network', completed: processed, total: selected.length };
      }
      job.networkEvidence = { source: 'verified_walking_paths', completeness: 'partial',
        durationScope: 'whole_route', supplementDetailRequests: requestStats.detailRequests - requestsBefore,
        attemptedEndpoints: processed, requestedEndpoints: selected.length,
        representativeRoutes:representativeRoutes(analysis),
        unknownReason: job.budget.halted() ? 'service_halted' : processed < selected.length ? 'detail_budget_exhausted' : null };
    }
    if (!legacyReplay) job.serviceGaps = assessServiceGaps(analysis);
    if(batchMode&&timeFieldRunner){job.timeField=await timeFieldRunner({analysis,geometry,walkingAllowance:job.walkingAllowance,display:buildFacilityDisplay(job),signal,onProgress:value=>{job.progress=value;}});requestStats.internalGridMatrixRequests=job.timeField.requestStats?.httpRequests??0;requestStats.internalGridMatrixOutputs=job.timeField.requestStats?.outputRoutes??0;requestStats.internalGridCachedOutputs=job.timeField.requestStats?.cachedOutputs??0;requestStats.internalGridWalkingGeometryRequests=job.timeField.requestStats?.walkingGeometryRequests??0;}
    if(batchMode&&regionalRunner){const regionalStarted=performance.now();job.regionalGaps=await regionalRunner({analysis,geometry,weights:job.score.priorities,signal,walkingAllowance:job.walkingAllowance});job.performance.regionalMs=performance.now()-regionalStarted;requestStats.regionalMatrixRequests=job.regionalGaps.verificationService==='direction_v2'?0:job.regionalGaps.requestStats?.matrixRequests??job.regionalGaps.requestStats?.httpRequests??0;requestStats.regionalMatrixOutputRoutes=job.regionalGaps.requestStats?.matrixOutputRoutes??0;requestStats.regionalWalkingRequests=job.regionalGaps.requestStats?.walkingRequests??0;}
    if(prefetch){const prefetchStats=prefetch.stats();job.performance.facilityPrefetch=prefetchStats;
      requestStats.prefetchWalkingRequests=prefetchStats.walkingRequests;
      requestStats.liteRequests+=prefetchStats.walkingRequests;}
    requestStats.walkingTask=job.walkingAllowance?{...job.walkingAllowance}:null;
    job.requestStats = { ...requestStats, process: { ...taskBudget },
      routeProvider: routeProvider.stats?.() ?? null };
    if (analysis.status === 'partial') job.warnings.push('partial_facility_evidence');
    job.searchDiagnostics=facilitySearchDiagnostics(analysis);
    job.status=repeatableTasks&&job.searchDiagnostics.status==='failed'?'failed':analysis.status;
    if(job.status==='failed')job.error=job.searchDiagnostics.message;
    job.requestStats.budgetScope=repeatableTasks?'task':'process';
    await routeProvider.flush?.();
  }

  async function pump() {
    if (active) return;
    const job = queue.map((id) => jobs.get(id)).find((item) => item?.status === 'queued');
    if (!job) return;
    queue.splice(queue.indexOf(job.analysisId), 1);
    active = true;
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    const timer = setTimeout(() => job.controller.abort(new Error('analysis_timeout')), jobTimeoutMs);
    try {
      await execute(job);
      if (job.controller.signal.aborted) job.status = job.cancelRequested ? 'cancelled' : 'failed';
    } catch {
      job.status = job.cancelRequested ? 'cancelled' : 'failed';
      job.geometryStatus='unknown';
      job.rangeDiagnostics ??= {status:'unknown',source:'none',origin:job.input.origin,reasonCode:job.cancelRequested?'cancelled':job.controller.signal.aborted?'analysis_timeout':'task_failed',failures:job.rangeFailures,unknownRegions:{scope:'all_unverified'}};
      job.error = job.cancelRequested ? 'Analysis cancelled.'
        : job.controller.signal.aborted ? 'Analysis timed out.' : 'Analysis could not be completed.';
    } finally {
      clearTimeout(timer);
      // Drain aborted prefetch before the next job can consume a service budget.
      await job.searchPromise?.catch(()=>{});
      await job.prefetchPromise?.catch(()=>{});
      recordBudget(job);
      job.finishedAt = new Date().toISOString();
      if(job.performance)job.performance.totalMs=Date.parse(job.finishedAt)-Date.parse(job.startedAt);
      active = false;
      queueMicrotask(pump);
    }
  }

  function create(body) {
    const input = legacyReplay ? validateLegacyInput(body) : validateFacilityV3Input(body);
    if (jobs.size >= 10) {
      const oldest = [...jobs.values()].find((job) => !['queued', 'running'].includes(job.status));
      if (oldest) jobs.delete(oldest.analysisId);
      else throw new RangeError('Too many active analyses.');
    }
    const id = 'fa-' + randomUUID();
    const job = {
      analysisId: id, version: 2, status: 'queued',
      createdAt: new Date().toISOString(), startedAt: null, finishedAt: null,
      version: legacyReplay ? 2 : input.version,
      categoryMappingVersion: legacyReplay ? FACILITY_MAPPING_VERSION : input.categoryMappingVersion,
      geometrySource: 'none', geometryStatus: 'pending',
      scope: 'analysis_location_with_walking_origin', studyAreaStatus: 'no_verified_community_boundary',
      progress: { phase: 'queued', completed: 0, total: legacyReplay ? input.categoryIds.length : facilityCategoryTree(input.categoryMappingVersion).categories.flatMap(g=>g.subtypes).length },
      rangeFailures:[], rangeDiagnostics:null, warnings: [], requestStats: null, analysis: null, score: null, context: null,
      geojson: null, sampleMetrics: null, input, controller: new AbortController(),
      cancelRequested: false,
    };
    jobs.set(id, job);
    queue.push(id);
    queueMicrotask(pump);
    return publicJob(job);
  }

  function cancel(id) {
    const job = jobs.get(id);
    if (!job) return null;
    if (job.status === 'queued' || job.status === 'running') {
      job.cancelRequested = true;
      job.controller.abort(new Error('analysis_cancelled'));
      if (job.status === 'queued') {
        job.status = 'cancelled';
        job.finishedAt = new Date().toISOString();
      }
    }
    return publicJob(job);
  }

  function rescore(id, { evidenceFingerprint, selectedCategoryIds, priorities } = {}) {
    const job = jobs.get(id);
    if (!job?.analysis || !['complete', 'partial'].includes(job.status)) return null;
    if (evidenceFingerprint !== job.score.evidenceFingerprint) {
      throw new RangeError('Evidence snapshot has changed.');
    }
    if (!legacyReplay) {
      if (selectedCategoryIds != null && (selectedCategoryIds.length !== 6
        || new Set(selectedCategoryIds).size !== 6 || selectedCategoryIds.some((category) => !FACILITY_GROUP_IDS.includes(category)))) {
        throw new RangeError('Display filters must not change the score denominator.');
      }
      validateV3Priorities(priorities,job.input.version);
      const weights = Object.fromEntries(FACILITY_GROUP_IDS.map((category) => [category, priorities[category] ?? (job.input.version>=8?2:1)]));
      job.score = scoreSixGroupPriorities({ analysis: job.analysis, priorities: weights });
      if(job.regionalGaps)job.regionalGaps=reweightRegionalGaps(job.regionalGaps,weights);
      job.input.priorities = weights;
    } else job.score = scoreFacilityPriorities({ analysis: job.analysis, selectedCategoryIds, priorities });
    return job.score;
  }

  async function routeDetail(id, { evidenceFingerprint, identityKey, subtypeId } = {}, requestSignal) {
    const job = jobs.get(id);
    if (legacyReplay || !job?.analysis || !['complete', 'partial'].includes(job.status)) return null;
    if (typeof identityKey !== 'string' || identityKey.length > 1500 || typeof subtypeId !== 'string') {
      throw new TypeError('An existing POI identity and subtype are required.');
    }
    const task = async () => {
      if (evidenceFingerprint !== job.score.evidenceFingerprint) throw new RangeError('Evidence snapshot has changed.');
      if (requestSignal?.aborted) return { routeStatus: 'cancelled' };
      const sub = job.analysis.categories.flatMap((group) => group.subtypeResults).find((item) => item.subtypeId === subtypeId);
      const previous = sub?.routes.find((item) => item.identityKey === identityKey && item.routeStatus === 'ok');
      if (!previous) throw new RangeError('Only a POI with existing verified route cost can request route geometry.');
      if (previous.geometry) return { routeStatus: 'ok', route: structuredClone(previous), cached: true,
        job: publicJob(job) };
      const signal = requestSignal ? AbortSignal.any([job.controller.signal, requestSignal]) : job.controller.signal;
      const result = await job.budget.route.route(previous.origin, previous.destination, { mode: 'walking',
        originUid: previous.originUid, destinationUid: previous.destinationUid, includeGeometry: true, signal });
      recordBudget(job);
      job.requestStats = { budgetScope:repeatableTasks?'task':'process',lifetime:{...lifetime}, ...job.budget.stats, process: { ...(job.executionBudget??process) }, routeProvider: routeProvider.stats?.() ?? null };
      if (signal.aborted) return { routeStatus: 'cancelled' };
      if (result.routeStatus !== 'ok') return { routeStatus: result.routeStatus, geometry: null, job: publicJob(job) };
      job.analysis = await applyFacilityRouteDetail(job.analysis, previous, result);
      job.score = scoreSixGroupPriorities({ analysis: job.analysis, priorities: job.input.priorities });
      job.status = job.analysis.status;
      job.serviceGaps = assessServiceGaps(job.analysis);
      const updated = job.analysis.categories.flatMap((group) => group.subtypeResults)
        .find((item) => item.subtypeId === subtypeId).routes.find((item) => item.identityKey === identityKey);
      return { routeStatus: updated?.routeStatus ?? 'invalid_route', route: structuredClone(updated),
        costChanged: previous.durationSeconds !== updated?.durationSeconds || previous.distanceMeters !== updated?.distanceMeters,
        job: publicJob(job) };
    };
    // Concurrent clicks cannot attach geometry to an older score snapshot.
    const promise = (job.detailQueue ?? Promise.resolve()).catch(() => {}).then(task);
    job.detailQueue = promise.then(() => {}, () => {});
    return promise;
  }

  // Server-only recovery of SHA-checked completed archive records. Never queues
  // analysis or changes saved costs/scores; restored priority edits stay local.
  function restoreCompleted(snapshot){
    if(!snapshot||!/^fa-[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/.test(snapshot.analysisId??'')||!['complete','partial'].includes(snapshot.status)||!snapshot.analysis||!snapshot.score||snapshot.presentationOnly)throw TypeError('A complete audit snapshot is required.');
    if(jobs.has(snapshot.analysisId))return publicJob(jobs.get(snapshot.analysisId));
    const a=snapshot.analysis,input=validateFacilityV3Input({version:a.version,categoryMappingVersion:a.categoryMappingVersion,origin:a.origin,analysisLocation:a.analysisLocation??a.origin,categoryIds:FACILITY_GROUP_IDS,mode:'walking',minutes:15,subtypeScope:'all',priorities:snapshot.score.priorities,walkingModelId:a.walkingModelId,searchRadiusMeters:a.searchRadiusMeters,routeScope:a.routeScope,maxRouteCandidatesPerSubtype:a.maxRouteCandidatesPerSubtype??3});
    const job={...structuredClone(snapshot),input,controller:new AbortController(),cancelRequested:false,restoredFromArchive:true,executionBudget:{placeRequests:0,routeDecisions:0,officialRequests:0,samplingRequests:0}};
    job.budget=createFacilityBudget({completeFacilityPaths,walkingAllowance:job.walkingAllowance??null,placeProvider,routeProvider,processBudget:repeatableTasks?job.executionBudget:process,input,signal:job.controller.signal,runRoute:operation=>modelRouteQueue(operation,{signal:job.controller.signal}),limits:{place:placeRequestLimit,route:routeDecisionLimit,circleRoute:circleRouteLimit,taskPlace:taskPlaceLimit,taskCost:taskCostLimit,taskDetail:taskDetailLimit,taskRoute:taskRouteLimit}});
    jobs.set(job.analysisId,job);return publicJob(job);
  }
  return Object.freeze({
    create, cancel, rescore, routeDetail,restoreCompleted,
    representativeRoutes: async (id, options = {}) => {
      const job=jobs.get(id);if(!job?.analysis || !['complete','partial'].includes(job.status))return null;
      if(options.includeGeometry===true){
        if(options.evidenceFingerprint!==job.score.evidenceFingerprint)throw new RangeError('Evidence snapshot has changed.');
        for(const row of representativeRoutes(job.analysis)){
          if(!row.identityKey || row.drawable)continue;
          const response=await routeDetail(id,{identityKey:row.identityKey,subtypeId:row.subtypeId,evidenceFingerprint:job.score.evidenceFingerprint});
          if(response?.routeStatus!=='ok')job.representativeLimitations=[...(job.representativeLimitations ?? []),reasonDetail(response?.routeStatus ?? 'missing_path',{categoryId:row.categoryId})];
        }
      }
      return {analysisId:id,evidenceFingerprint:job.score.evidenceFingerprint,origin:job.input.origin,routes:representativeRoutes(job.analysis),
        requestStats:publicJob(job).requestStats,limitations:[...new Map((job.representativeLimitations ?? []).map(r=>[JSON.stringify([r.categoryId,r.reasonCode]),r])).values()],job:publicJob(job)};
    },
    get: (id,options={}) => {const job=jobs.get(id);if(options.view!=='ui'||!job?.analysis||!['complete','partial'].includes(job.status))return options.view==='ui'?uiSnapshot(publicJob(job)):publicJob(job);
      const key=JSON.stringify([job.status,job.score,job.requestStats]);let cached=uiCache.get(job);if(cached?.key!==key){cached={key,value:uiSnapshot(publicJob(job))};uiCache.set(job,cached);}return structuredClone(cached.value);},
    geojson: (id) => {
      const job = jobs.get(id);
      if (!job?.analysis || !['complete', 'partial'].includes(job.status)) return null;
      if (!legacyReplay) return reachabilityEvidence(job).geojson;
      return job.geojson ?? { type: 'FeatureCollection', features: [],
        properties: { geometrySource: 'none', geometryStatus: 'unknown',
          analysisId: id, note: 'No verified reachability geometry.' } };
    },
    metrics: (id) => {
      const job = jobs.get(id);
      return job?.analysis && ['complete', 'partial'].includes(job.status) ? { analysisId: id, scope: job.scope,
        geometrySource: job.geometrySource, geometryStatus: job.geometryStatus,
        sampleMetrics: job.sampleMetrics, serviceGaps: job.serviceGaps,regionalGaps:job.regionalGaps,
        reachability: !legacyReplay ? reachabilityEvidence(job) : undefined, categoryMappingVersion: job.categoryMappingVersion,
        categories: job.analysis.categories, score: job.score,
        context: contextManager?.freshen(job.context) ?? job.context,
        requestStats: job.requestStats, warnings: job.warnings } : null;
    },
    report: (id) => {
      const job = jobs.get(id);
      // Export the full task snapshot; view filters never enter this builder.
      return job?.analysis && ['complete', 'partial'].includes(job.status)
        ? buildFacilityReport(publicJob(job)) : null;
    },
  });
}

// Only offline historical tests use this manager. HTTP never enables the legacy branch.
export function createLegacyFacilityJobManager(options = {}) {
  return createFacilityJobManager({ ...options, legacyReplay: true });
}
