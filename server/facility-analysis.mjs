import{hasConfirmedFacilityMembership,hasCategoryOnlyMembership}from'../web/facility-membership.js';
import{computeCircleCosts}from'./circle-costs.mjs';
import{walkingModel,WALKING80_MODEL,BAIDU_TIME_MODEL,decisionSeconds}from'../web/walking-model.js';
import {orderedBatches} from './bounded-batches.mjs';
import {attachSearchDiagnostics,reasonDetail} from './evidence-diagnostics.mjs';
import { FACILITY_CATEGORY_IDS, FACILITY_MAPPING_VERSION, FACILITY_GROUPS, FACILITY_GROUP_IDS,
  FACILITY_SUBTYPES, FACILITY_V3_MAPPING_VERSION, facilityCategoryTree, classifySubtypeCandidate,
  classifyV3FacilityCandidate } from './facility-categories.mjs';
import { evaluateSubtypeAccess, mergeFacilityCandidatesV3, facilityIdentity,
  compareNearestFacilities, NEAREST_FACILITY_VERSION, prepareSubtypeCandidates, PREPARED_NEAREST_VERSION } from './nearest-facility.mjs';
import { evaluateFacilityAccess } from './facility-coverage.mjs';
import { preselectFacilityCandidates } from './geometry.mjs';
import { validBd09ll } from './walking-provider.mjs';
import { fairSubtypeOrder } from './facility-schedule.mjs';
import {adaptiveContinuationOrder,RECALL_SCHEDULE_VERSION} from './recall-schedule.mjs';
import {knownSampleDiagnostics} from './analysis-diagnostics.mjs';
import {prepareGroupSearches} from './group-recall.mjs';
import {consolidateMetroStations} from './facility-endpoints.mjs';

export const FACILITY_ANALYSIS_VERSION = 'eight-category-route-evidence-v1';

export function createLegacyFacilityAnalysis({ placeProvider, routeProvider } = {}) {
  if (!placeProvider?.searchAround || !routeProvider?.route) {
    throw new TypeError('Place and route providers are required.');
  }

  async function analyze({
    origin, categoryIds = FACILITY_CATEGORY_IDS, mode = 'walking', minutes = 15,
    searchRadiusMeters = 1500, maxRouteCandidates = 4, geometry = null, signal,
    onProgress = () => {},
  } = {}) {
    if (!validBd09ll(origin?.location) || typeof origin.id !== 'string' || !origin.id) {
      throw new TypeError('A named BD-09LL origin is required.');
    }
    if (!Array.isArray(categoryIds) || !categoryIds.length
      || new Set(categoryIds).size !== categoryIds.length
      || categoryIds.some((id) => !FACILITY_CATEGORY_IDS.includes(id))) {
      throw new RangeError('Select unique IDs from the eight main categories.');
    }
    if (!['walking', 'cycling', 'driving'].includes(mode) || ![15, 20, 30].includes(minutes)
      || !Number.isFinite(searchRadiusMeters) || searchRadiusMeters < 100 || searchRadiusMeters > 5000) {
      throw new RangeError('Invalid facility analysis mode, minutes or radius.');
    }
    const categories = [];
    for (const categoryId of categoryIds) {
      if (signal?.aborted) throw signal.reason ?? new Error('Analysis cancelled.');
      onProgress({ phase: 'facilities', completed: categories.length, total: categoryIds.length, categoryId });
      let search;
      try {
        search = await placeProvider.searchAround({
          categoryId, center: origin.location, radiusMeters: searchRadiusMeters, signal,
        });
      } catch (error) {
        search = { status: 'failed', searchComplete: false, truncated: false,
          candidates: [], pages: [], errors: [{ code: error?.code ?? 'place_unavailable' }] };
      }
      const candidates = Array.isArray(search.candidates) ? search.candidates : [];
      const spatial = preselectFacilityCandidates(geometry, candidates);
      // The official polygon is only a scheduling hint. Route every candidate if budget permits;
      // an outside POI or a sampled cell cannot determine a category score by itself.
      const prioritized = [...spatial.retained, ...spatial.excluded];
      const access = await evaluateFacilityAccess({
        demandPoint: origin, categoryId, facilities: prioritized,
        searchComplete: search.searchComplete === true && search.truncated !== true,
        searchRadiusMeters, provider: routeProvider, maxRouteCandidates,
        mode, thresholdSeconds: minutes * 60, signal,
      });
      categories.push({
        ...access, searchStatus: search.status ?? 'failed',
        searchTruncated: search.truncated === true,
        searchErrors: search.errors ?? [], searchPages: search.pages ?? [],
        poiMarkers: candidates.filter((item) => item.classification?.candidateStatus !== 'excluded_by_rule')
          .slice(0, 60).map((item) => ({
            uid: item.uid, name: item.name, location: item.location,
            rawCategory: item.rawCategory,
          })),
        geometrySource: geometry?.geometrySource ?? 'none',
        geometryPreselection: {
          source: spatial.spatialSource,
          prioritizedCount: spatial.retained.length,
          outsideDeferredCount: spatial.excluded.length,
        },
      });
    }
    onProgress({ phase: 'facilities', completed: categories.length, total: categoryIds.length });
    return {
      algorithmVersion: FACILITY_ANALYSIS_VERSION,
      categoryMappingVersion: FACILITY_MAPPING_VERSION,
      origin, mode, minutes, thresholdSeconds: minutes * 60,
      coordinateSystem: 'BD-09LL', geometrySource: geometry?.geometrySource ?? 'none',
      status: categories.every((item) => ['covered', 'over_threshold'].includes(item.coverageStatus))
        ? 'complete' : 'partial',
      categories,
    };
  }
  return Object.freeze({ analyze });
}

export const FACILITY_V3_ANALYSIS_VERSION = 'six-group-subtype-route-evidence-v1';
export const FACILITY_ADAPTIVE_VERSION='six-group-subtype-adaptive-v2';
export const FACILITY_GROUP_RECALL_VERSION='six-group-recall-classify-route-v3';
export async function prepareFacilitySearches({placeProvider,analysisLocation,categoryMappingVersion,searchRadiusMeters,signal,onProgress=()=>{},concurrency=1,adaptive=false}){
 if(['facility-categories-v7','facility-categories-v8'].includes(categoryMappingVersion))return prepareGroupSearches({placeProvider,analysisLocation,categoryMappingVersion,searchRadiusMeters,signal,onProgress,concurrency});
 const started=performance.now();
    const subtypeCount = facilityCategoryTree(categoryMappingVersion).categories.flatMap(g=>g.subtypes).length;
    const searches = new Map();
    const order = fairSubtypeOrder(categoryMappingVersion);
    const history=new Map(),schedule=[];
    await orderedBatches(order,async (subtype,index)=>{
      if (signal?.aborted) throw signal.reason ?? new Error('Analysis cancelled.');
      onProgress({ phase: 'subtype_search', completed: index, total: subtypeCount,
        categoryId: subtype.categoryId, subtypeId: subtype.id });
      let search;
      try { search = await placeProvider.searchAround({ categoryId: subtype.categoryId, subtypeId: subtype.id,
        categoryMappingVersion, center: analysisLocation.location, radiusMeters: searchRadiusMeters, signal, maxRequests: 1, incremental: true }); }
      catch (error) { search = { status: 'failed', searchComplete: false, truncated: true,
        candidates: [], pages: [], errors: [{ code: error?.code ?? 'place_unavailable' }] }; }
      search ??= { status: 'failed', searchComplete: false, candidates: [] };
      const candidates = (Array.isArray(search.candidates) ? search.candidates : []).map((candidate) => ({
        ...candidate, queriedSubtypeIds: [...new Set([...(candidate.queriedSubtypeIds ?? []), subtype.id])],
      }));
      searches.set(subtype.id, { ...search, candidates,
        invalidCandidateCount: (search.invalidCandidateCount ?? 0)
          + candidates.filter((candidate) => !validBd09ll(candidate?.location)).length });
      history.set(subtype.id,{served:1,lastGain:new Set(candidates.map(facilityIdentity)).size});
    },{concurrency,signal});
    // Resume one page per subtype per round after everybody had a first-page opportunity.
    for (let round = 1; round < 8; round++) {
      let resumed = false;
      const ranked=adaptive?adaptiveContinuationOrder(order,searches,history,categoryMappingVersion):order.map(subtype=>({subtype}));
      const decisions=[];
      await orderedBatches(ranked,async({subtype,priority})=>{
        const prior = searches.get(subtype.id);
        if (!prior.continuation || placeProvider.canSearch?.() === false) return;
        if (signal?.aborted) throw signal.reason ?? new Error('Analysis cancelled.');
        const next = await placeProvider.searchAround({ categoryId: subtype.categoryId, subtypeId: subtype.id,
          categoryMappingVersion, center: analysisLocation.location, radiusMeters: searchRadiusMeters, signal,
          incremental: true, continuation: prior.continuation, maxRequests: 1 });
        const oldKeys=new Set((prior.candidates??[]).map(facilityIdentity)),newKeys=new Set((next.candidates??[]).map(facilityIdentity));
        const gain=[...newKeys].filter(k=>!oldKeys.has(k)).length;
        history.set(subtype.id,{served:(history.get(subtype.id)?.served??1)+1,lastGain:gain});
        decisions.push({subtypeId:subtype.id,priority,newUniqueCandidates:gain,searchComplete:next.searchComplete===true});
        searches.set(subtype.id, { ...next, candidates: (next.candidates ?? []).map((candidate) => ({
          ...candidate, queriedSubtypeIds: [...new Set([...(candidate.queriedSubtypeIds ?? []), subtype.id])] })),
          invalidCandidateCount: (next.invalidCandidateCount ?? 0)
            + (next.candidates ?? []).filter((candidate) => !validBd09ll(candidate?.location)).length });
        resumed = true;
      },{concurrency,signal});
      if(decisions.length)schedule.push({round,decisions});
      if (!resumed) break;
    }

 return {searches:new Map(order.map(sub=>[sub.id,searches.get(sub.id)])),order,subtypeCount,searchMs:performance.now()-started,
  recallSchedule:{version:adaptive?RECALL_SCHEDULE_VERSION:'fair-first-page-round-robin-v1',firstPageOrder:order.map(s=>s.id),rounds:schedule,scope:'scheduling_only'}};
}
export function createFacilityAnalysis({ placeProvider, routeProvider, concurrency=1 } = {}) {
  if (!placeProvider?.searchAround || !routeProvider?.route) throw new TypeError('Place and route providers are required.');
  async function analyze({ origin, analysisLocation = origin, categoryMappingVersion = FACILITY_V3_MAPPING_VERSION, categoryIds = FACILITY_GROUP_IDS, region = '', mode = 'walking', minutes = 15,
    subtypeScope = 'all', routeScope = 'nearest_candidates', searchRadiusMeters = 1500, maxRouteCandidatesPerSubtype = 1,
    geometry = null, preparedSearches=null, walkingModelId=BAIDU_TIME_MODEL, signal, onProgress = () => {} } = {}) {
    if (!validBd09ll(origin?.location) || typeof origin.id !== 'string' || !origin.id) throw new TypeError('A named BD-09LL origin is required.');
    if (!Array.isArray(categoryIds) || categoryIds.length !== 6 || new Set(categoryIds).size !== 6
      || categoryIds.some((id) => !FACILITY_GROUP_IDS.includes(id)) || subtypeScope !== 'all'
      || mode !== 'walking' || minutes !== 15 || !Number.isInteger(maxRouteCandidatesPerSubtype)
      || maxRouteCandidatesPerSubtype < 1 || maxRouteCandidatesPerSubtype > 3
      || !Number.isFinite(searchRadiusMeters) || searchRadiusMeters < 100 || searchRadiusMeters > 5000) {
      throw new RangeError('Analyze all six groups and declared subtypes with walking 15 minutes.');
    }
    if(!validBd09ll(analysisLocation?.location))throw new TypeError('Valid analysis location required.');
    const observedAt=new Date().toISOString(), allCandidates=[];
    const fixed80=walkingModelId===WALKING80_MODEL;
    const {searches,order,subtypeCount,searchMs,recallSchedule,candidatePool}=await (preparedSearches??prepareFacilitySearches({placeProvider,analysisLocation:fixed80?origin:analysisLocation,categoryMappingVersion,searchRadiusMeters,signal,onProgress,concurrency,adaptive:fixed80}));
    const routeStarted=performance.now();
    if(candidatePool)allCandidates.push(...candidatePool);else for (const search of searches.values()) allCandidates.push(...search.candidates);
    for(const search of searches.values())if(search.continuation && placeProvider.canSearch?.()===false){
      search.errors=[...(search.errors ?? []),{code:'place_request_limit_reached'}];
      search.searchComplete=false;search.truncated=true;
    }
    const union = mergeFacilityCandidatesV3(allCandidates);
    if(fixed80&&categoryMappingVersion==='facility-categories-v8')union.candidates=consolidateMetroStations(union.candidates,origin,p=>classifySubtypeCandidate({...p,categoryMappingVersion,subtypeId:'metro_station'}).candidateStatus==='confirmed_by_rule');
    const byIdentity = new Map(union.candidates
      .map((candidate) => [facilityIdentity(candidate), candidate]));
    if(categoryMappingVersion!=='facility-categories-v3')for(const entrance of union.candidates){
      if(!entrance.parentUid || ![entrance.rawCategory,...(entrance.rawCategoryTags ?? [])].some(tag=>/出入口/.test(tag)))continue;
      const parent=byIdentity.get('uid:'+entrance.parentUid);
      if(!parent)continue;
      parent.entranceCandidates ??=[];
      parent.entranceCandidates.push({uid:entrance.uid,location:entrance.location,name:entrance.name,
        source:'place_parent_id',parentUid:parent.uid,linkVerified:true,accessStatus:'unverified'});
      // Preserve the navigation hint; never substitute an arbitrary gate or its route for its parent.
    }
    const poiMarkers = union.candidates.map((candidate) => {
      const classification = classifyV3FacilityCandidate(candidate, categoryMappingVersion);
      return { ...candidate, ...classification, identityKey: facilityIdentity(candidate),
        pendingSubtypeIds: candidate.queriedSubtypeIds.filter((subtypeId) =>
          classifySubtypeCandidate({ ...candidate, categoryMappingVersion, subtypeId }).candidateStatus === 'pending_review'),
        candidateStatus: classification.categoryIds.length ? 'confirmed_by_rule' : 'pending_review' };
    }).filter((candidate) => hasConfirmedFacilityMembership(candidate) || candidate.queriedSubtypeIds.some((subtypeId) =>
      classifySubtypeCandidate({ ...candidate, categoryMappingVersion, subtypeId }).candidateStatus === 'pending_review'));
    const routeMemo = new Map(), results = new Map();
    const circleCosts=routeScope==='circle_candidates'?await computeCircleCosts({candidates:poiMarkers,geometry,origin,provider:routeProvider,routeMemo,walkingModelId,signal,onProgress,observedAt,searchRadiusMeters}):null;
    const circleKeys=circleCosts?new Set(circleCosts.facilities.map(p=>p.identityKey)):null;
    const categoryOnlyCosts=circleCosts??(poiMarkers.some(hasCategoryOnlyMembership)?await computeCircleCosts({candidates:poiMarkers.filter(hasCategoryOnlyMembership),geometry,origin,provider:{...routeProvider,route:(...args)=>routeProvider.route(...args),allocateCircleCosts:undefined},routeMemo,walkingModelId,signal,onProgress,observedAt,searchRadiusMeters}):null);
    if(categoryOnlyCosts)for(const p of poiMarkers)p.circleRouteEvidence=categoryOnlyCosts.facilities.find(r=>r.identityKey===p.identityKey)?.routeEvidence??p.circleRouteEvidence??null;
    const candidateStarted=performance.now(),prepared=new Map();
    for(const subtype of order){
      const candidates=union.candidates.filter(candidate=>candidate.queriedSubtypeIds.includes(subtype.id)
        || classifySubtypeCandidate({...candidate,categoryMappingVersion,subtypeId:subtype.id}).candidateStatus==='confirmed_by_rule');
      const spatial=preselectFacilityCandidates(geometry,candidates);
      const facilities=circleKeys?candidates.filter(p=>circleKeys.has(facilityIdentity(p))||classifySubtypeCandidate({...p,categoryMappingVersion,subtypeId:subtype.id}).candidateStatus==='pending_review'):[...spatial.retained,...spatial.excluded];
      prepared.set(subtype.id,{spatial,facilities,token:fixed80?prepareSubtypeCandidates({demandPoint:origin,categoryMappingVersion,subtypeId:subtype.id,facilities}):null});
    }
    const candidatePreparationMs=performance.now()-candidateStarted;
    let routeRounds=0;
    const exhaustive=['facility-categories-v6','facility-categories-v7','facility-categories-v8'].includes(categoryMappingVersion)&&['all_candidates','circle_candidates'].includes(routeScope);
    const rounds=circleCosts?1:exhaustive?Math.min(1000,Math.max(1,union.candidates.length)):maxRouteCandidatesPerSubtype;
    for (let round = 1; round <= rounds; round++) {
    if(round>1&&routeProvider.canRoute?.()===false)break;
    const roundOrder=round===1?order:order.filter(sub=>results.get(sub.id)?.candidatesRouted<results.get(sub.id)?.confirmedCandidateCount);
    if(!roundOrder.length)break;
    routeRounds++;
    await orderedBatches(roundOrder,async(subtype,index)=>{
      if (signal?.aborted) throw signal.reason ?? new Error('Analysis cancelled.');
      onProgress({ phase: 'subtype_routes', completed: index, total: subtypeCount,
        categoryId: subtype.categoryId, subtypeId: subtype.id });
      const search = searches.get(subtype.id);
      const {spatial,facilities,token}=prepared.get(subtype.id);
      const access = await evaluateSubtypeAccess({ demandPoint: origin, categoryMappingVersion, subtypeId: subtype.id,
        facilities,preparedCandidates:token, walkingModelId, searchRadiusMeters,
        searchComplete: (!circleCosts||circleCosts.status!=='unavailable')&&search.searchComplete === true && search.truncated !== true
          && !(search.invalidCandidateCount > 0), provider: routeProvider,
        maxRouteCandidates: circleCosts?1000:round, captureGeometry:['facility-categories-v6','facility-categories-v7','facility-categories-v8'].includes(categoryMappingVersion), routeMemo, signal, observedAt });
      results.set(subtype.id, { ...attachSearchDiagnostics(access,search),
        ...(walkingModelId===WALKING80_MODEL&&geometry?.geometrySource==='baidu_isodistance'?{rangeExcludedCandidates:spatial.excluded.map(p=>({uid:p.uid,identityKey:facilityIdentity(p),name:p.name,reasonCode:'outside_official_distance_range'}))}:{}),searchStatus: search.status ?? 'failed',
        searchTruncated: search.truncated === true, searchPages: search.pages ?? [],
        searchErrors: search.errors ?? [], geometryPreselection: { source: spatial.spatialSource,
          prioritizedCount: spatial.retained.length, outsideDeferredCount: spatial.excluded.length } });
    },{concurrency:walkingModelId===WALKING80_MODEL?2:1,signal});
    }
    const categories = summarizeFacilityGroups([...results.values()], poiMarkers, categoryMappingVersion);
    onProgress({ phase: 'facilities', completed: subtypeCount, total: subtypeCount });
    const analysisVersion=categoryMappingVersion==='facility-categories-v7'?FACILITY_GROUP_RECALL_VERSION:fixed80?FACILITY_ADAPTIVE_VERSION:FACILITY_V3_ANALYSIS_VERSION;
    return { version: Number(categoryMappingVersion.match(/v(\d+)$/)[1]), algorithmVersion:analysisVersion,
      analysisVersion, categoryMappingVersion,
      ...(walkingModelId===WALKING80_MODEL?{walkingModelId,walkingModel:walkingModel(walkingModelId)}:{}),
      nearestAlgorithmVersion: fixed80?PREPARED_NEAREST_VERSION:NEAREST_FACILITY_VERSION, analysisLocation, origin, region, mode, minutes, thresholdSeconds: 900,
      subtypeScope: 'all', routeScope, coordinateSystem: 'BD-09LL', geometrySource: geometry?.geometrySource ?? 'none',
      searchRadiusMeters, maxRouteCandidatesPerSubtype, observedAt,
      status: [...results.values()].every((result) => result.nearestComplete)&&!poiMarkers.filter(hasCategoryOnlyMembership).some(p=>p.circleRouteEvidence?.routeStatus!=='ok') ? 'complete' : 'partial',
      searchWindow:{center:(walkingModelId===WALKING80_MODEL?origin:analysisLocation).location,radiusMeters:searchRadiusMeters,coordinateSystem:'BD-09LL',
        walkingOrigin:origin.location,scope:circleCosts?circleCosts.scope:walkingModelId===WALKING80_MODEL?'declared_walking_origin_radius':'declared_analysis_location_radius',
        originDiffers:JSON.stringify(analysisLocation.location)!==JSON.stringify(origin.location),
        outsideWindowStatus:'unknown',note:circleCosts?circleCosts.scope==='classified_candidates_in_declared_search_window'?'采样范围未通过验证；在声明检索窗口内独立核验已分类设施的真实Walking成本，未完成核验仍未知。':'检索窗口内且处于返回边界中的候选逐UID计算路线；采样边界不是路网可达证明，未检索区域仍未知。':'只统计声明窗口内候选，不声称覆盖起点的所有15分钟设施。'},
      diagnostics:{version:'facility-diagnostics-v1',source:'place_responses_only',baseMapLabelsCounted:false,
        recallSchedule,
        searches:order.map(sub=>{const search=searches.get(sub.id);return {subtypeId:sub.id,queries:search.queryPlan??(search.sharedGroupRecall?search.searchQueries:sub.searchQueries),retrieval:results.get(sub.id)?.retrieval,recallScope:search.recallScope??'subtype_keywords',recalledCategoryId:search.recalledCategoryId??null,
          center:(walkingModelId===WALKING80_MODEL?origin:analysisLocation).location,radiusMeters:searchRadiusMeters,pages:search.pages ?? [],errors:search.errors ?? [],
          searchComplete:search.searchComplete===true && !search.truncated,continuationPending:Boolean(search.continuation),
          discardedCandidates:search.discardedCandidates ?? [],candidateCount:search.candidates.length};}),
        candidates:[...results.values()].flatMap(r=>r.candidateDiagnostics.map(c=>({...c,subtypeId:r.subtypeId})))},
      performance:{searchMs,routeMs:performance.now()-routeStarted,candidatePreparationMs,routeRounds,candidatePlanCount:fixed80?prepared.size:0,
        repeatedPreparationRoundsAvoided:fixed80?Math.max(0,routeRounds-1):0,searchConcurrency:concurrency,routeGeometryInCostRequest:['facility-categories-v6','facility-categories-v7','facility-categories-v8'].includes(categoryMappingVersion)},
      ...(fixed80?{auxiliaryMetrics:knownSampleDiagnostics(categories)}:{}),
      categories, poiMarkers, ...(circleCosts?{circleCosts}:{}), uniqueUidCount: new Set(poiMarkers.map((marker) => marker.uid).filter(Boolean)).size,
      anonymousCandidateCount: poiMarkers.filter((marker) => !marker.uid).length,
      duplicateUids: union.duplicateUids, invalidCandidateCount: union.invalidCount };
  }
  return Object.freeze({ analyze });
}

export function summarizeFacilityGroups(subtypeResultsAll, poiMarkers, categoryMappingVersion = FACILITY_V3_MAPPING_VERSION) {
    const results = new Map(subtypeResultsAll.map((row) => [row.subtypeId, row]));
    const byIdentity = new Map(poiMarkers.map((marker) => [facilityIdentity(marker), marker]));
    return facilityCategoryTree(categoryMappingVersion).categories.map((group) => {
      const subtypeResults = group.subtypes.map((subtype) => results.get(subtype.id));
      const reachable = subtypeResults.filter((result) => result.accessStatus === 'reachable');
      const unknown = subtypeResults.filter((result) => result.accessStatus === 'unknown');
      const nearest = reachable.map((result) => result.nearestReachable).sort(compareNearestFacilities);
      const categoryMarkers = poiMarkers.filter((marker) => marker.categoryIds.includes(group.id)
        || marker.queriedSubtypeIds.some((subtypeId) => group.subtypes.some((subtype) => subtype.id === subtypeId)
          && classifySubtypeCandidate({ ...marker, categoryMappingVersion, subtypeId }).candidateStatus === 'pending_review'));
      const categoryOnlyMarkers=categoryMarkers.filter(p=>hasCategoryOnlyMembership(p)&&p.categoryOnlyIds.includes(group.id)),categoryOnlyRoutes=categoryOnlyMarkers.map(p=>p.circleRouteEvidence).filter(Boolean),categoryOnlyReachable=categoryOnlyRoutes.filter(r=>r.routeStatus==='ok'&&decisionSeconds(r)!==null&&decisionSeconds(r)<=900);
      const reachableKeys = [...new Set([...subtypeResults.flatMap((result) => result.reachableIdentityKeys),...categoryOnlyReachable.map(r=>r.identityKey)])];
      const reachableUids = [...new Set(reachableKeys.map((key) => byIdentity.get(key)?.uid).filter(Boolean))];
      const nearestComplete = subtypeResults.every((result) => result.nearestComplete);
      return { categoryId: group.id, label: group.label, color: group.color, iconKey: group.iconKey,
        categoryMappingVersion, mode: 'walking', thresholdSeconds: 900, subtypeResults,
        reachableSubtypeCount: reachable.length, totalSubtypeCount: subtypeResults.length,
        unknownSubtypeCount: unknown.length,
        noReachableSubtypeCount: subtypeResults.filter((result) => result.accessStatus === 'no_reachable_in_declared_search').length,
        hasReachableService: reachable.length > 0||categoryOnlyReachable.length>0,categoryOnlyRoutes,categoryOnlyCandidateCount:categoryOnlyMarkers.length,categoryOnlyReachableCount:categoryOnlyReachable.length,
        allSubtypesReachable: reachable.length === subtypeResults.length,
        uniqueUidCount: new Set(categoryMarkers.map((marker) => marker.uid).filter(Boolean)).size,
        anonymousCandidateCount: categoryMarkers.filter((marker) => !marker.uid).length,
        reachableCountLowerBound: reachableKeys.length, reachableUniqueUidCountLowerBound: reachableUids.length,
        nearestReachableAnySubtype: nearest[0] ?? null,
        nearestStatus: nearest.length ? nearestComplete ? 'nearest_in_declared_search' : 'nearest_verified_partial' : 'unavailable',
        poiMarkers: categoryMarkers, evidenceIds: [...new Set(subtypeResults.flatMap((result) => result.evidenceIds))] };
    });
}
