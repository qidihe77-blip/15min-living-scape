import{modelRoute,decisionSeconds,WALKING80_MODEL,BAIDU_TIME_MODEL}from'../web/walking-model.js';
import {reasonDetail} from './evidence-diagnostics.mjs';
import {validRoutePoint} from './route-geometry.mjs';
import { createHash } from 'node:crypto';
import { getFacilitySubtype, classifySubtypeCandidate, classifyV3FacilityCandidate, FACILITY_V3_MAPPING_VERSION } from './facility-categories.mjs';
import { straightDistanceMeters } from './facility-coverage.mjs';
import { validBd09ll } from './walking-provider.mjs';
import { facilityRouteCacheKey } from './baidu-route.mjs';
import {routeFacilityCandidate,matchingFacilityTarget} from './facility-endpoints.mjs';

export const NEAREST_FACILITY_VERSION = 'verified-walking-distance-v1';
export const PREPARED_NEAREST_VERSION='verified-walking-distance-prepared-v2';
const candidatePlans=new WeakMap();
const planScope=(origin,subtypeId,version)=>JSON.stringify([origin.location,origin.uid??null,subtypeId,version]);
export function facilityIdentity(candidate) {
  return typeof candidate?.uid === 'string' && candidate.uid.trim() ? 'uid:' + candidate.uid.trim()
    : 'anonymous:' + JSON.stringify([candidate?.name ?? '', candidate?.address ?? '',
      candidate?.location, candidate?.naviLocation ?? null]);
}

export function mergeFacilityCandidatesV3(input) {
  const byIdentity = new Map();
  let invalidCount = 0;
  const duplicateUids = [];
  for (const item of input) {
    if (!validBd09ll(item?.location)||item.coordinateSystem&&item.coordinateSystem!=='BD-09LL') { invalidCount += 1; continue; }
    const candidate = structuredClone(item);
    candidate.uid = typeof candidate.uid === 'string' && candidate.uid.trim() ? candidate.uid.trim() : null;
    candidate.identityStatus = candidate.uid ? 'provider_uid' : 'missing_uid_low_confidence';
    candidate.classificationEvidence ??= [{ name: candidate.name ?? '', rawCategory: candidate.rawCategory ?? '' }];
    candidate.rawCategoryTags ??= [candidate.rawCategory ?? ''];
    candidate.retrievalEvidence ??= [];
    candidate.queriedSubtypeIds ??= [];
    candidate.matchedQueries ??= [];
    candidate.destinationVariants ??= [{ location: candidate.location, naviLocation: candidate.naviLocation ?? null }];
    const key = facilityIdentity(candidate), previous = byIdentity.get(key);
    if (!previous) { byIdentity.set(key, candidate); continue; }
    if (candidate.uid) duplicateUids.push(candidate.uid);
    for (const field of ['rawCategoryTags', 'queriedSubtypeIds', 'matchedQueries']) {
      previous[field] = [...new Set([...previous[field], ...candidate[field]])];
    }
    previous.serviceDetails=[...new Map([...(previous.serviceDetails??[]),...(candidate.serviceDetails??[])].map(v=>[JSON.stringify(v),v])).values()];previous.classificationEvidence.push(...candidate.classificationEvidence);
    previous.retrievalEvidence.push(...candidate.retrievalEvidence);
    const variants = [...previous.destinationVariants, ...candidate.destinationVariants];
    previous.destinationVariants = [...new Map(variants.map((v) => [JSON.stringify(v), v])).values()];
    previous.destinationConflict = previous.destinationVariants.length > 1;
    previous.entranceCandidates=[...new Map([...(previous.entranceCandidates??[]),...(candidate.entranceCandidates??[])].map(p=>[JSON.stringify(p),p])).values()];previous.parentUid??=candidate.parentUid;
  }
  return { candidates: [...byIdentity.values()], invalidCount, duplicateUids };
}

export function compareNearestFacilities(a, b) {
  return a.distanceMeters - b.distanceMeters || a.durationSeconds - b.durationSeconds
    || String(a.uid ?? a.identityKey).localeCompare(String(b.uid ?? b.identityKey));
}

// Prepared once per immutable analysis. Private tokens cannot be supplied as serialized evidence.
export function prepareSubtypeCandidates({demandPoint,subtypeId,categoryMappingVersion=FACILITY_V3_MAPPING_VERSION,facilities=[],existingRouteOrder=[]}){
 if(!validBd09ll(demandPoint?.location)||!getFacilitySubtype(subtypeId,categoryMappingVersion))throw new TypeError('Valid candidate preparation scope required.');
 const dedupe=mergeFacilityCandidatesV3(facilities),classified=dedupe.candidates.map(facility=>({facility,
  classification:classifySubtypeCandidate({...facility,categoryMappingVersion,subtypeId})}));
 const confirmed=classified.filter(row=>row.classification.candidateStatus==='confirmed_by_rule'),
  pending=classified.filter(row=>row.classification.candidateStatus==='pending_review'),excluded=classified.filter(row=>row.classification.candidateStatus==='excluded_by_rule');
 const rank=facility=>({inside:0,boundary:1,unknown:2,outside:3})[facility.geometryAssessment?.status]??2;
 const ordered=confirmed.map(row=>({...row,straightLineMeters:straightDistanceMeters(demandPoint.location,row.facility.location)}))
  .sort((a,b)=>rank(a.facility)-rank(b.facility)||a.straightLineMeters-b.straightLineMeters||facilityIdentity(a.facility).localeCompare(facilityIdentity(b.facility)));
 // Detail refresh reuses the recorded routed set, even when the original polygon order differed.
 // Reachable/nearest decisions below still use the current real costs, never this priority list.
 if(existingRouteOrder.length){const prior=new Map(existingRouteOrder.map((key,i)=>[key,i]));ordered.sort((a,b)=>(prior.get(facilityIdentity(a.facility))??Infinity)-(prior.get(facilityIdentity(b.facility))??Infinity));}
 const token=Object.freeze({candidateCount:dedupe.candidates.length,confirmedCount:confirmed.length});
 candidatePlans.set(token,{scope:planScope(demandPoint,subtypeId,categoryMappingVersion),dedupe,classified,confirmed,pending,excluded,ordered});return token;
}

export async function evaluateSubtypeAccess({ demandPoint, subtypeId, facilities = [], preparedCandidates=null,
  searchComplete = false, searchRadiusMeters = 1500, provider, maxRouteCandidates = 1,
  mode = 'walking', thresholdSeconds = 900, walkingModelId=BAIDU_TIME_MODEL, captureGeometry=false, signal, routeMemo = new Map(),
  observedAt = new Date().toISOString(), categoryMappingVersion = FACILITY_V3_MAPPING_VERSION } = {}) {
  const subtype = getFacilitySubtype(subtypeId, categoryMappingVersion);
  if (!subtype) throw new RangeError('Unknown facility subtype.');
  if (!validBd09ll(demandPoint?.location) || !provider?.route) throw new TypeError('Origin and route provider are required.');
  if (mode !== 'walking' || thresholdSeconds !== 900 || !Number.isInteger(maxRouteCandidates)
    || maxRouteCandidates < 1 || maxRouteCandidates > (['facility-categories-v6','facility-categories-v7','facility-categories-v8'].includes(categoryMappingVersion)?1000:20)) throw new RangeError('Walking 15-minute subtype limits are required.');
  const token=preparedCandidates??prepareSubtypeCandidates({demandPoint,subtypeId,categoryMappingVersion,facilities});
  const plan=candidatePlans.get(token);
  if(!plan||plan.scope!==planScope(demandPoint,subtypeId,categoryMappingVersion))throw new TypeError('Prepared candidate scope mismatch.');
  const {dedupe,classified,confirmed,pending,excluded,ordered}=plan;
  const effectiveSearchComplete = searchComplete === true && dedupe.invalidCount === 0;
  const routes = [], reachable = [];
  for (const { facility, classification, straightLineMeters } of ordered.slice(0, maxRouteCandidates)) {
    if (signal?.aborted) throw signal.reason ?? new Error('Analysis cancelled.');
    const options = { mode, captureGeometry, originUid: demandPoint.uid, destinationUid: facility.uid, walkingModelId, signal };
    const route=modelRoute(await routeFacilityCandidate({facility,origin:demandPoint,provider,routeMemo,options}),walkingModelId);
    const evidence=bindFacilityRouteEvidence({route,demandPoint,facility:{...facility,categoryMappingVersion},classification,categoryId:subtype.categoryId,subtypeId,walkingModelId,observedAt});
    routes.push(evidence);
    if (evidence.routeStatus==='ok' && decisionSeconds(evidence,walkingModelId) <= thresholdSeconds) reachable.push({
      ...evidence, uid: facility.uid, subtypeIds: classifyV3FacilityCandidate(facility, categoryMappingVersion).subtypeIds,
      identityStatus: facility.identityStatus,
    });
  }
  reachable.sort(compareNearestFacilities);
  const allRoutesValid = routes.length === ordered.length && routes.every((route) => route.routeStatus === 'ok');
  const reasons = [];
  if (!effectiveSearchComplete) reasons.push('search_incomplete');
  if (dedupe.invalidCount) reasons.push('invalid_candidate');
  if (pending.length) reasons.push('classification_pending');
  if (routes.length < ordered.length) reasons.push('candidate_limit_reached');
  if (routes.some((route) => route.routeStatus !== 'ok')) reasons.push('route_incomplete');
  reasons.push(...routes.filter(r=>r.routeStatus!=='ok').map(r=>r.routeStatus));
  if (confirmed.some(({ facility }) => facility.destinationConflict)) reasons.push('destination_variants_unverified');
  const complete = effectiveSearchComplete && pending.length === 0 && allRoutesValid && reasons.length === 0;
  const accessStatus = reachable.length ? 'reachable' : complete ? 'no_reachable_in_declared_search' : 'unknown';
  const diagnosticRoutes=new Map(routes.map(r=>[r.identityKey,r]));
  return { categoryId: subtype.categoryId, subtypeId, label: subtype.label, iconKey: subtype.iconKey,
    categoryMappingVersion, nearestAlgorithmVersion: preparedCandidates?PREPARED_NEAREST_VERSION:NEAREST_FACILITY_VERSION,
    mode, thresholdSeconds, searchRadiusMeters, accessStatus,
    ...(walkingModelId===WALKING80_MODEL?{walkingModelId}:{}),
    nearestStatus: reachable.length ? complete ? 'nearest_in_declared_search' : 'nearest_verified_partial' : 'unavailable',
    nearestReachable: reachable[0] ?? null, nearestComplete: complete,
    candidatesRetrieved: dedupe.candidates.length, confirmedCandidateCount: confirmed.length,
    pendingClassificationCount: pending.length, excludedCandidateCount: excluded.length,
    candidatesRouted: routes.length, validRouteCount: routes.filter((route) => route.routeStatus === 'ok').length,
    reachableCountLowerBound: reachable.length, reachableIdentityKeys: reachable.map((facility) => facility.identityKey),
    searchComplete: effectiveSearchComplete, routeComplete: allRoutesValid,
    unknownReasons: [...new Set(reasons)], reasonCodes:[...new Set(reasons)], reasonDetails:[...new Set(reasons)].map(c=>reasonDetail(c)),
    candidateDiagnostics:classified.map(({facility,classification})=>{
      const route=diagnosticRoutes.get(facilityIdentity(facility));
      const reasonCode=classification.candidateStatus==='excluded_by_rule'?'excluded_by_rule':classification.candidateStatus==='pending_review'?'classification_pending':!route?'not_routed':route.routeStatus!=='ok'?route.routeStatus:decisionSeconds(route,walkingModelId)<=900?'reachable_witness':walkingModelId===WALKING80_MODEL?'beyond_1200_meters':'beyond_900_seconds';
      return {identityKey:facilityIdentity(facility),uid:facility.uid,name:facility.name,rawCategory:facility.rawCategory,rawCategoryTags:facility.rawCategoryTags,
        classification,retrievalEvidence:facility.retrievalEvidence,queriedSubtypeIds:facility.queriedSubtypeIds,
        routeStatus:route?.routeStatus ?? 'not_requested',evidenceId:route?.evidenceId ?? null,decision:reasonCode==='reachable_witness'?'included':['excluded_by_rule','beyond_900_seconds','beyond_1200_meters'].includes(reasonCode)?'excluded':'pending',...reasonDetail(reasonCode),
        ...(walkingModelId===WALKING80_MODEL&&reasonCode==='reachable_witness'?{explanation:'真实步行距离≤1200米，按80m/min估算≤15分钟。'}:{})};
    }),routes, evidenceIds: [...new Set(routes.map((route) => route.evidenceId))],
    excludedCandidates: excluded.map((row) => ({ uid: row.facility.uid, classification: row.classification })),
    pendingCandidates: pending.map((row) => ({ uid: row.facility.uid, name: row.facility.name, classification: row.classification })),
    duplicateUids: dedupe.duplicateUids, invalidCandidateCount: dedupe.invalidCount };
}

// One validator shared by subtype decisions and whole-circle POI costs.
export function bindFacilityRouteEvidence({route,demandPoint,facility,classification,categoryId=null,subtypeId=null,walkingModelId=BAIDU_TIME_MODEL,observedAt=new Date().toISOString()}) {
 route=modelRoute(route,walkingModelId);
 const mode='walking',target=matchingFacilityTarget(facility,demandPoint,route),destination=target.location;
 const categoryMappingVersion=facility.categoryMappingVersion??'facility-categories-v7';
 const key=facilityRouteCacheKey(demandPoint.location,destination,{mode,originUid:demandPoint.uid,destinationUid:target.uid,walkingModelId});
 const straightLineMeters=straightDistanceMeters(demandPoint.location,facility.location);
    const endpointMatches = (actual, expectedPoint, expectedUid) => actual == null
      || (validBd09ll(actual.location) && Math.abs(actual.location.lat - expectedPoint.lat) <= 0.000001
        && Math.abs(actual.location.lng - expectedPoint.lng) <= 0.000001 && (actual.uid ?? null) === (expectedUid ?? null));
    const hasBinding = categoryMappingVersion === FACILITY_V3_MAPPING_VERSION || (route?.requestedOrigin && route?.requestedDestination);
    const valid = hasBinding && route?.routeStatus === 'ok' && Number.isFinite(route.durationSeconds) && route.durationSeconds >= 0
      && Number.isFinite(route.distanceMeters) && route.distanceMeters >= 0
      && (route.mode == null || route.mode === mode)
      && (route.coordinateSystem == null || route.coordinateSystem === 'BD-09LL')
      && endpointMatches(route.requestedOrigin, demandPoint.location, demandPoint.uid)
      && endpointMatches(route.requestedDestination, destination, target.uid);
    const retrievedAt = route?.retrievedAt ?? null;
    // Validate provider geometry against requested (or provider-snapped) endpoints. Do not add connector lines.
    const lines=route.geometry?.type==='LineString'?[route.geometry.coordinates]
      :route.geometry?.type==='MultiLineString'?route.geometry.coordinates:[];
    const pathPoint=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)?{lng:p[0],lat:p[1]}:null;
    const start=pathPoint(lines[0]?.[0]),end=pathPoint(lines.at(-1)?.at(-1));
    const snappedOrigin=validBd09ll(route.providerOrigin)?route.providerOrigin:demandPoint.location;
    const snappedDestination=validBd09ll(route.providerDestination)?route.providerDestination:destination;
    const validPath=lines.length>0 && lines.every(l=>Array.isArray(l)&&l.length>=2&&l.every(validRoutePoint));
    const startBound=validPath&&validBd09ll(start)&&straightDistanceMeters(snappedOrigin,start)<=150;
    const providerEndBound=validPath&&validBd09ll(end)&&straightDistanceMeters(snappedDestination,end)<=150;
    // Some Place navigation hints point to a distant road access point while
    // Walking destination_uid routes to the actual facility. Accept the real
    // POI endpoint only with both request bindings and this exact facility UID.
    // Station entrances retain their own endpoint contract; never substitute a station centroid.
    const poiEndBound=valid&&startBound&&!facility.stationName&&!target.entrance&&!!facility.uid
      &&target.uid===facility.uid&&route.requestedOrigin&&route.requestedDestination
      &&endpointMatches(route.requestedOrigin,demandPoint.location,demandPoint.uid)
      &&endpointMatches(route.requestedDestination,destination,target.uid)
      &&validBd09ll(facility.location)&&validBd09ll(end)&&straightDistanceMeters(facility.location,end)<=150;
    const geometryBound=categoryMappingVersion=== FACILITY_V3_MAPPING_VERSION || !route.geometry
      || (startBound&&(providerEndBound||poiEndBound));
    const evidenceId = route?.evidenceId ?? 'route-' + createHash('sha256').update(JSON.stringify([
      key, route?.source ?? null, retrievedAt ?? observedAt, route?.durationSeconds, route?.distanceMeters,
    ])).digest('hex').slice(0, 24);
    return { evidenceId, facilityUid: facility.uid, identityKey: facilityIdentity(facility),
      categoryId, subtypeId, name: facility.name ?? '', address: facility.address ?? '',
      location: facility.stationName?destination:facility.location, destination, origin: demandPoint.location, originUid: demandPoint.uid ?? null,
      destinationUid: target.uid,facilityEndpoint:target, entranceVerification:route.entranceVerification??null,entranceStatus: facility.entranceStatus
        ?? (validBd09ll(facility.naviLocation) ? 'navigation_hint_unverified' : 'poi_location_unverified'),
      destinationConflict: facility.destinationConflict === true,
      straightLineMeters: Math.round(straightLineMeters),
      durationSeconds: valid ? route.durationSeconds : null, distanceMeters: valid ? route.distanceMeters : null,
      routeStatus: valid ? 'ok' : route?.routeStatus === 'ok' ? 'invalid_route' : route?.routeStatus ?? 'upstream_unavailable',
      ...(walkingModelId===WALKING80_MODEL?{walkingModelId,modelDurationSeconds:valid?route.modelDurationSeconds:null}:{}),
      source: route?.source ?? null, mode, coordinateSystem: 'BD-09LL', retrievedAt, observedAt,
      apiStatus:route?.apiStatus ?? null,httpStatus:route?.httpStatus ?? null,
      geometry: valid && geometryBound ? route.geometry ?? null : null,
      geometryStatus: valid ? geometryBound ? route.geometryStatus ?? 'not_provided' : !validPath?'invalid_path':'endpoint_geometry_mismatch' : 'unavailable',
      geometryCompleteness:route.geometryCompleteness ?? (route.geometry?.type==='MultiLineString'?'disconnected_provider_steps':null),
      ...(valid&&route.navigation?{navigation:route.navigation}:{}),
      geometryEndpointReference:validPath&&geometryBound?(providerEndBound?'provider_destination':poiEndBound?'bound_facility_poi':null):null,
      providerOrigin:valid?route.providerOrigin??null:null,providerDestination:valid?route.providerDestination??null:null,
      originNavigation:route.originNavigation,requestOriginUidApplied:route.requestOriginUidApplied,
      destinationNavigation:route.destinationNavigation,requestDestinationUidApplied:route.requestDestinationUidApplied,
      requestedOrigin: valid ? route.requestedOrigin ?? {location:demandPoint.location,uid:demandPoint.uid ?? null} : null,
      requestedDestination: valid ? route.requestedDestination ?? {location:destination,uid:target.uid ?? null} : null,
      classification, cached: route?.cached === true };

}
