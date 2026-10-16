import {facilityCategoryTree} from './facility-categories.mjs';
const TERMINAL = new Set(['rate_limited', 'quota_exhausted', 'permission_denied']);
const unknown = (code) => ({ mode: 'walking', source: 'none', routeStatus: code, durationSeconds: null, distanceMeters: null });

export function createFacilityBudget({ placeProvider, routeProvider, processBudget, limits, signal, input,
  runRoute = (operation) => operation(),walkingAllowance=null,completeFacilityPaths=false }) {
  const stats = { placeRequests: 0, routeDecisions: 0, costRoutes: 0, detailRequests: 0,
    matrixRequests: 0, matrixOutputRoutes: 0, liteRequests: 0, samplingRequests: 0, officialRequests: 0,
    limits: { place: limits.taskPlace, cost: Math.min(limits.taskCost,
      facilityCategoryTree(input.categoryMappingVersion).categories.flatMap(g=>g.subtypes).length * input.maxRouteCandidatesPerSubtype),
      detail: limits.taskDetail, routeTotal: limits.taskRoute } };
  const childRequests = new Map();
  let costLimit = stats.limits.cost;
  const circleMode=input.routeScope==='circle_candidates';
  let processRouteLimit=limits.route;
  const scoped=input.version>=4;
  const haltedService=service=>Boolean(scoped?processBudget.haltCodes?.[service]:processBudget.haltCode);
  const halt = (code,service) => { if (TERMINAL.has(code)){if(scoped){processBudget.haltCodes ??={};processBudget.haltCodes[service]=code;}else processBudget.haltCode=code;} };
  const canSearch = () => !signal.aborted && !haltedService('place')
    && stats.placeRequests < limits.taskPlace && processBudget.placeRequests < limits.place;
  const place = { canSearch, searchAround: async (options) => {
    const allocationKey=options.groupScope?'group:'+options.categoryId:options.subtypeId;
    const remaining = Math.max(0, Math.min(options.maxRequests ?? 1,
      (options.groupScope&&input.version>=8?16:8) - (childRequests.get(allocationKey) ?? 0), limits.taskPlace - stats.placeRequests,
      limits.place - processBudget.placeRequests));
    if (!canSearch() || !remaining) return { status: 'failed', searchComplete: false, truncated: true,
      candidates: [], pages: [], errors: [{ code: signal.aborted ? 'cancelled'
        : haltedService('place') ? 'service_halted' : 'place_request_limit_reached' }], requestStats: { logicalRequests: 0 } };
    // Reserve before awaiting, including calls whose connection fails.
    processBudget.placeRequests += remaining; stats.placeRequests += remaining;
    let result;
    try { result = await placeProvider.searchAround({ ...options, maxRequests: remaining, signal }); }
    catch (error) { result = { status: 'failed', searchComplete: false, truncated: true, candidates: [],
      errors: [{ code: error?.code ?? 'upstream_unavailable' }], requestStats: { logicalRequests: remaining } }; }
    const used = Math.min(remaining, Math.max(0, result.requestStats?.logicalRequests ?? remaining));
    processBudget.placeRequests -= remaining - used; stats.placeRequests -= remaining - used;
    childRequests.set(allocationKey, (childRequests.get(allocationKey) ?? 0) + used);
    for (const error of result.errors ?? []) halt(error.code,'place');
    return result;
  } };
  async function performRoute(origin, destination, options = {}) {
    const detail = options.includeGeometry === true;
    if (signal.aborted || options.signal?.aborted) return unknown('cancelled');
    if (haltedService('route')) return unknown('service_halted');
    const cached = routeProvider.peek?.(origin, destination, options);
    if (cached) return { ...cached, cached: true };
    const available = () => (!walkingAllowance||walkingAllowance.used<walkingAllowance.limit)&&processBudget.routeDecisions < processRouteLimit
      && stats.routeDecisions < stats.limits.routeTotal
      && (detail ? stats.detailRequests < limits.taskDetail : stats.costRoutes < costLimit);
    if (!available()) return unknown(detail ? 'route_detail_limit_reached' : 'route_request_limit_reached');
    const reserve = () => { processBudget.routeDecisions++; stats.routeDecisions++;
      if (detail) stats.detailRequests++; else stats.costRoutes++; };
    const countProvider = (before) => {
      const after = routeProvider.stats?.() ?? {};
      for (const field of ['liteRequests', 'matrixRequests', 'matrixOutputRoutes']) stats[field] += Math.max(0, (after[field] ?? 0) - (before[field] ?? 0));
    };
    // Matrix is gated by the provider's verified entitlement and output-route QPS.
    if (!detail && !options.captureGeometry && routeProvider.routeMatrix && routeProvider.canBatch?.('walking', 1)) {
      reserve(); const before = routeProvider.stats?.() ?? {};
      const [result] = await routeProvider.routeMatrix({ origins: [{ location: origin, uid: options.originUid }],
        destinations: [{ location: destination, uid: options.destinationUid }], mode: 'walking', signal });
      countProvider(before); halt(result?.routeStatus,'route');
      if (result?.routeStatus === 'ok' || haltedService('route') || !available()) return result ?? unknown('upstream_unavailable');
    }
    if (!available()) return unknown('route_request_limit_reached');
    reserve(); const before = routeProvider.stats?.() ?? {};
    let result;
    try { const pending=routeProvider.route(origin,destination,{...options,walkingAllowance,mode:'walking',signal:options.signal??signal});
      if(input.walkingModelId==='walking80-v1'&&!walkingAllowance)countProvider(before);
      result=await pending; }
    catch (error) { result = unknown(error?.code ?? 'upstream_unavailable'); }
    if(walkingAllowance&&Number.isInteger(result?.walkingRequestAttempts))stats.liteRequests+=result.walkingRequestAttempts;else if(input.walkingModelId!=='walking80-v1')countProvider(before);
    if (!routeProvider.stats) stats.liteRequests++;
    halt(result?.routeStatus,'route');
    return result;
  }
  return { place, route: { stats:()=>routeProvider.stats?.()??{},route: (...args) => {
    // Cached bound evidence consumes neither a request slot nor a QPS scheduling delay.
    if(signal.aborted||args[2]?.signal?.aborted)return Promise.resolve(unknown('cancelled'));
    const cached=routeProvider.peek?.(...args);
    if(cached&&walkingAllowance){walkingAllowance.cacheHits++;walkingAllowance.phases??={};const phase=walkingAllowance.phases.poiRouting??={};phase.cacheHits=(phase.cacheHits??0)+1;}
    return cached?Promise.resolve({...cached,cached:true}):runRoute(() => performRoute(...args));
  }, allocateCircleCosts(count){if(!circleMode||!Number.isInteger(count)||count<0)throw new TypeError('Invalid circle allocation');costLimit=Math.min(count,limits.circleRoute??1000);stats.limits.cost=costLimit;stats.limits.routeTotal=costLimit+limits.taskDetail;processRouteLimit=Math.max(limits.route,limits.circleRoute??1000);stats.circleAllocation={uniqueCandidates:count,allocated:costLimit,limit:limits.circleRoute??1000};
    if(completeFacilityPaths&&walkingAllowance?.limit>0){const base=walkingAllowance.limit;walkingAllowance.limit=Math.max(base,walkingAllowance.used+costLimit*2);stats.circleAllocation.walkingPlan={baseLimit:base,plannedLimit:walkingAllowance.limit,endpointAttempts:costLimit,retriesPerEndpoint:1,reason:'all_classified_facility_paths'};}
   }, canRoute:()=>!signal.aborted&&!haltedService('route')&&processBudget.routeDecisions<processRouteLimit&&stats.routeDecisions<stats.limits.routeTotal&&stats.costRoutes<costLimit },
    stats, halted: (service='route') => haltedService(service) };
}
