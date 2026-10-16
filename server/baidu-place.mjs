import { BaiduApiError } from './baidu-client.mjs';
import { getFacilityCategory, FACILITY_MAPPING_VERSION, classifyFacilityCandidate,
  getFacilitySubtype, FACILITY_V3_MAPPING_VERSION, classifySubtypeCandidate,facilityCategoryTree } from './facility-categories.mjs';
import { validBd09ll } from './walking-provider.mjs';
import{branchEvidenceFromPlace}from'./service-capabilities.mjs';

export const BAIDU_PLACE_VERSION = 'place-v3-subtype-fair-pages-v4';
const TOTAL_CAP = 150;
const METERS_PER_DEGREE = 111_320;

function pointOf(raw) {
  if (raw?.lat == null || raw?.lng == null) return null;
  const point = { lat: Number(raw.lat), lng: Number(raw.lng) };
  return validBd09ll(point) ? point : null;
}

function distanceMeters(a, b) {
  const radians = (value) => value * Math.PI / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

function childShards(shard) {
  const delta = shard.radiusMeters / 2;
  const radiusMeters = Math.ceil(shard.radiusMeters / Math.SQRT2) + 2;
  return [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([north, east], index) => ({
    id: shard.id + '-' + index,
    depth: shard.depth + 1,
    radiusMeters,
    center: {
      lat: shard.center.lat + north * delta / METERS_PER_DEGREE,
      lng: shard.center.lng + east * delta / (METERS_PER_DEGREE * Math.cos(shard.center.lat * Math.PI / 180)),
    },
  }));
}

function normalizePlace(raw, categoryId, keyword, retrievedAt, subtypeId = null, categoryMappingVersion = FACILITY_V3_MAPPING_VERSION) {
  if(raw?.coordinateSystem&&raw.coordinateSystem!=='BD-09LL')return null;
  const location = pointOf(raw?.location);
  if (!location) return null;
  const rawCategory = raw.detail_info?.classified_poi_tag ?? raw.classified_poi_tag
    ?? raw.detail_info?.tag ?? raw.tag ?? '';
  const uid = typeof raw.uid === 'string' && raw.uid.trim() ? raw.uid.trim() : null;
  const rawCategoryTags = [...new Set([raw.detail_info?.classified_poi_tag,
    raw.classified_poi_tag, raw.detail_info?.tag, raw.tag].filter((tag) => typeof tag === 'string' && tag))];
  return {
    categoryMappingVersion, uid, name: String(raw.name ?? ''), address: String(raw.address ?? ''),
    location, naviLocation: pointOf(raw.detail_info?.navi_location ?? raw.navi_location),
    rawCategory: String(rawCategory), rawCategoryTags,
    classifiedPoiTag: raw.detail_info?.classified_poi_tag ?? raw.classified_poi_tag ?? null,
    categoryId, queriedSubtypeIds: subtypeId ? [subtypeId] : [], matchedQueries: [keyword],
    parentUid: typeof (raw.detail_info?.parent_id??raw.parent_id) === 'string' ? (raw.detail_info?.parent_id??raw.parent_id) : null,
    entranceCandidates:(raw.detail_info?.children??[]).filter(p=>pointOf(p.location)&&/出入口|门|通道/.test([p.classified_poi_tag,p.std_tag,p.name].join(';'))).map(p=>({uid:p.uid??null,name:String(p.name??p.show_name??''),location:pointOf(p.location),parentUid:uid,source:'place_child',linkVerified:true,accessStatus:'unverified'})),
    entranceStatus: pointOf(raw.detail_info?.navi_location ?? raw.navi_location)
      ? 'navigation_hint_unverified' : 'poi_location_unverified',
    identityStatus: uid ? 'provider_uid' : 'missing_uid_low_confidence',
    classification: subtypeId ? classifySubtypeCandidate({ categoryMappingVersion, subtypeId, name: raw.name, rawCategory, rawCategoryTags })
      : classifyFacilityCandidate({ categoryId, name: raw.name, rawCategory }),
    classificationEvidence: [{ name: String(raw.name ?? ''), rawCategoryTags, query: keyword, retrievedAt }],
    retrievalEvidence: [],
    destinationVariants: [{ location, naviLocation: pointOf(raw.detail_info?.navi_location ?? raw.navi_location) }],
    serviceDetails:['description','service_content','business_scope'].flatMap(field=>[raw.detail_info?.[field],raw[field]].filter(v=>typeof v==='string'&&v.trim()).map(text=>({source:'place_scope2.'+field,text:text.slice(0,2000)}))),businessEvidence:branchEvidenceFromPlace(raw,{retrievedAt}),retrievedAt, coordinateSystem: 'BD-09LL',
  };
}

export function createBaiduPlaceProvider({ client } = {}) {
  if (!client?.requestJson) throw new TypeError('An injectable Baidu client is required.');

  async function searchAround({
    categoryId, subtypeId = null, categoryMappingVersion = FACILITY_V3_MAPPING_VERSION, center, radiusMeters = 1500,
    pageSize = 20, maxPagesPerShard = 8, maxShardDepth = 1,
    maxRequests = 32, signal, incremental = false, continuation = null, groupScope=false,
  } = {}) {
    const group=groupScope?facilityCategoryTree(categoryMappingVersion).categories.find(g=>g.id===categoryId):null;
    if(groupScope&&!group)throw new RangeError('Unknown group recall scope.');
    const broad={education:['学校','幼儿园','小学','中学'],medical:['医院','药店'],commerce:['商超','超市','商场','菜市场','便利店'],transport:['公交站','地铁站'],eldercare:['养老','为老服务中心','日间照料中心'],leisure:['公园','广场','娱乐','运动']};
    const subtype = group?{...group.subtypes[0],categoryId:group.id,searchQueries:[...new Set([...(group.recallQueries??broad[group.id]??[]),...group.subtypes.flatMap(s=>s.searchQueries)])]}
      :subtypeId ? getFacilitySubtype(subtypeId, categoryMappingVersion) : null;
    const category = subtype ?? getFacilityCategory(categoryId);
    if (!category) throw new RangeError('Unknown facility category.');
    if (subtypeId && (!subtype || categoryId !== subtype.categoryId)) throw new RangeError('Subtype parent mismatch.');
    if (!validBd09ll(center)) throw new TypeError('Invalid BD-09LL center.');
    if (!Number.isFinite(radiusMeters) || radiusMeters < 100 || radiusMeters > 5000
      || !Number.isInteger(pageSize) || pageSize < 10 || pageSize > 20
      || !Number.isInteger(maxPagesPerShard) || maxPagesPerShard < 1 || maxPagesPerShard > 8
      || !Number.isInteger(maxShardDepth) || maxShardDepth < 0 || maxShardDepth > 2
      || !Number.isInteger(maxRequests) || maxRequests < 0 || maxRequests > 100) {
      throw new RangeError('Invalid Place search limits.');
    }
    if ((incremental||groupScope) && subtype) return searchSlice({ categoryId, subtypeId, subtype, categoryMappingVersion, center,
      radiusMeters, pageSize, maxPagesPerShard, maxShardDepth, maxRequests, signal, continuation,group });
    const candidates = [];
    const byUid = new Map();
    const duplicateUids = [];
    const pages = [];
    const errors = [];
    let invalidCandidateCount = 0;
    let logicalRequests = 0;
    let truncated = false;
    let haltCode = null;

    function collect(results, keyword, retrievedAt, shard, pageNum) {
      for (const raw of results) {
        const candidate = normalizePlace(raw, categoryId, keyword, retrievedAt, subtypeId, categoryMappingVersion);
        if (!candidate) { invalidCandidateCount += 1; continue; }
        if (distanceMeters(center, candidate.location) > radiusMeters + 2) continue;
        candidate.retrievalEvidence.push({ query: keyword, subtypeId, shardId: shard.id, pageNum, retrievedAt });
        const identityKey = candidate.uid ? 'uid:' + candidate.uid : 'anonymous:'
          + JSON.stringify([candidate.name, candidate.address, candidate.location, candidate.naviLocation]);
        if (byUid.has(identityKey)) {
          const existing = byUid.get(identityKey);
          if (!existing.matchedQueries.includes(keyword)) existing.matchedQueries.push(keyword);
          existing.rawCategoryTags = [...new Set([...existing.rawCategoryTags, ...candidate.rawCategoryTags])];
          existing.serviceDetails=[...new Map([...(existing.serviceDetails??[]),...(candidate.serviceDetails??[])].map(v=>[JSON.stringify(v),v])).values()];existing.classificationEvidence.push(...candidate.classificationEvidence);
          existing.retrievalEvidence.push(...candidate.retrievalEvidence);
          existing.destinationVariants = [...new Map([...existing.destinationVariants, ...candidate.destinationVariants]
            .map((value) => [JSON.stringify(value), value])).values()];
          existing.destinationConflict = existing.destinationVariants.length > 1;
          if (subtypeId) existing.classification = classifySubtypeCandidate({ ...existing, subtypeId });
          if (candidate.uid) duplicateUids.push(candidate.uid);
          continue;
        }
        byUid.set(identityKey, candidate);
        candidates.push(candidate);
      }
    }

    async function visit(keyword, shard) {
      if (haltCode) return false;
      let seenRows = 0;
      for (let pageNum = 0; pageNum < maxPagesPerShard; pageNum += 1) {
        if (signal?.aborted) {
          haltCode = 'cancelled';
          errors.push({ keyword, shardId: shard.id, pageNum, code: haltCode });
          return false;
        }
        if (logicalRequests >= maxRequests) {
          truncated = true;
          haltCode = 'request_budget_exhausted';
          errors.push({ keyword, shardId: shard.id, pageNum, code: haltCode });
          return false;
        }
        logicalRequests += 1;
        let response;
        try {
          response = await client.requestJson({
            service: 'place', path: '/place/v3/around',
            params: {
              query: keyword, location: shard.center.lat.toFixed(6) + ',' + shard.center.lng.toFixed(6),
              radius: String(Math.ceil(shard.radiusMeters)), radius_limit: 'true',
              coord_type: '3', page_num: String(pageNum), page_size: String(pageSize),
              scope: '2', output: 'json',
            },
            cacheTtlMs: 300000, signal,
          });
        } catch (error) {
          const code = error instanceof BaiduApiError ? error.code : 'upstream_unavailable';
          errors.push({ keyword, shardId: shard.id, pageNum, code,apiStatus:error?.apiStatus ?? null,httpStatus:error?.httpStatus ?? null });
          if (['rate_limited', 'quota_exhausted', 'permission_denied'].includes(code)) haltCode = code;
          return false;
        }
        const { data, meta } = response;
        if (!Array.isArray(data.results) || data.results.length > pageSize
          || !Number.isInteger(data.total) || data.total < 0
          || (data.result_type && data.result_type !== 'poi_type')) {
          errors.push({ keyword, shardId: shard.id, pageNum, code: 'invalid_response' });
          return false;
        }
        pages.push({ keyword, shardId: shard.id, depth: shard.depth, pageNum,
          returned: data.results.length, reportedTotal: data.total, retrievedAt: meta.retrievedAt });
        collect(data.results, keyword, meta.retrievedAt, shard, pageNum);
        seenRows += data.results.length;
        if (data.total >= TOTAL_CAP) {
          if (shard.depth < maxShardDepth && shard.radiusMeters > 250) {
            const children = childShards(shard);
            let complete = true;
            for (const child of children) {
              if (!await visit(keyword, child)) complete = false;
            }
            return complete;
          }
          truncated = true;
          errors.push({ keyword, shardId: shard.id, pageNum, code: 'reported_total_cap' });
          return false;
        }
        if (seenRows >= data.total) return true;
        if (data.results.length === 0 || data.results.length < pageSize) {
          errors.push({ keyword, shardId: shard.id, pageNum, code: 'premature_page_end' });
          return false;
        }
      }
      truncated = true;
      errors.push({ keyword, shardId: shard.id, pageNum: maxPagesPerShard, code: 'page_limit_reached' });
      return false;
    }

    let allComplete = true;
    // Place around documents OR queries (at most 10 words). This gives every subtype
    // a first-page opportunity without treating a matched query as classification proof.
    const queries = subtype ? Array.from({ length: Math.ceil(subtype.searchQueries.length / 10) },
      (_, i) => subtype.searchQueries.slice(i * 10, (i + 1) * 10).join('$')) : category.searchQueries;
    for (const keyword of queries) {
      if (haltCode) { allComplete = false; break; }
      const root = { id: 'root', depth: 0, radiusMeters, center };
      if (!await visit(keyword, root)) allComplete = false;
    }
    if (invalidCandidateCount) allComplete = false;
    const status = allComplete ? 'complete' : pages.length ? 'partial' : 'failed';
    return {
      status, searchComplete: allComplete, truncated, categoryId, subtypeId,
      categoryMappingVersion: subtype ? categoryMappingVersion : FACILITY_MAPPING_VERSION,
      algorithmVersion: BAIDU_PLACE_VERSION,
      center, radiusMeters, coordinateSystem: 'BD-09LL',
      candidates, candidatesFound: candidates.length, pages, duplicateUids,
      invalidCandidateCount, errors,
      requestStats: { logicalRequests, maxRequests, keywordCount: category.searchQueries.length, queryGroupCount: queries.length },
    };
  }
  async function searchSlice({ categoryId, subtypeId, subtype, categoryMappingVersion, center, radiusMeters,
    pageSize, maxPagesPerShard, maxShardDepth, maxRequests, signal, continuation,group=null }) {
    const searchScopeBase=[categoryMappingVersion,categoryId,group?'@group':subtypeId,center,radiusMeters,pageSize];

    // Give each subtype a first-page opportunity before dense subtypes consume
    // their later pages. Keep the existing group/request budgets unchanged.
    const querySets=group&&categoryMappingVersion==='facility-categories-v8'?[...group.subtypes.map(s=>s.searchQueries),(group.recallQueries??[]).filter(q=>!group.subtypes.some(s=>s.searchQueries.includes(q)))]:[subtype.searchQueries];
    const queries=[...new Set(querySets.flatMap(words=>Array.from({length:Math.ceil(words.length/10)},(_,i)=>words.slice(i*10,(i+1)*10).join('$'))))];
    const searchScope=JSON.stringify([...searchScopeBase,queries]);if(categoryMappingVersion!==FACILITY_V3_MAPPING_VERSION&&continuation&&continuation.searchScope!==searchScope)throw new RangeError('Place continuation scope mismatch.');
    const state = continuation ? structuredClone(continuation) : {
      queue: queries.map((keyword) => ({ keyword, pageNum: 0, seenRows: 0,
        shard: { id: 'root', depth: 0, radiusMeters, center } })),
      candidates: [], pages: [], errors: [], warnings:[], discardedCandidates: [], invalidCandidateCount: 0,
      searchScope,
    };
    let used = 0;
    state.warnings??=[];
    while (state.queue.length && used < maxRequests && !signal?.aborted) {
      const item = state.queue.shift(), { keyword, shard, pageNum } = item;
      used++;
      try {
        const { data, meta } = await client.requestJson({ service: 'place', path: '/place/v3/around',
          params: { query: keyword, location: shard.center.lat.toFixed(6) + ',' + shard.center.lng.toFixed(6),
            radius: String(Math.ceil(shard.radiusMeters)), radius_limit: 'true', coord_type: '3',
            page_num: String(pageNum), page_size: String(pageSize), scope: '2', output: 'json' },
          cacheTtlMs: 300000, signal });
        if (!Array.isArray(data.results) || data.results.length > pageSize || !Number.isInteger(data.total)
          || data.total < 0 || (data.result_type && data.result_type !== 'poi_type')) throw new BaiduApiError('invalid_response', { service: 'place' });
        state.pages.push({ keyword, shardId: shard.id, depth: shard.depth, pageNum,
          returned: data.results.length, reportedTotal: data.total, retrievedAt: meta.retrievedAt });
        for (const raw of data.results) {
          const candidate = normalizePlace(raw, categoryId, keyword, meta.retrievedAt, group?group.subtypes[0].id:subtypeId, categoryMappingVersion);
          if (!candidate) { state.invalidCandidateCount++; state.discardedCandidates.push({uid:raw.uid ?? null,name:String(raw.name ?? ''),reasonCode:'invalid_candidate',query:keyword,pageNum}); continue; }
          if(group){candidate.queriedSubtypeIds=group.subtypes.map(s=>s.id);candidate.recalledCategoryId=group.id;candidate.classification={candidateStatus:'pending_review',reason:'group_recall_then_subtype_classification'};}
          if (distanceMeters(center, candidate.location) > radiusMeters + 2) {state.discardedCandidates.push({uid:candidate.uid,name:candidate.name,reasonCode:'outside_search_radius',query:keyword,pageNum});continue;}
          candidate.retrievalEvidence.push({ query: keyword, subtypeId, shardId: shard.id, pageNum, retrievedAt: meta.retrievedAt });
          state.candidates.push(candidate);
        }
        const priorKeys=new Set(item.seenKeys??[]),seenKeys=[...new Set([...priorKeys,...data.results.map(p=>p.uid?'uid:'+p.uid:JSON.stringify([p.name,p.address,p.location,p.navi_location]))])],seenRows=seenKeys.length,total=Math.max(item.reportedTotal??0,data.total);
        Object.assign(state.pages.at(-1),{uniqueSeenRows:seenRows,maxReportedTotal:total,queryComplete:data.total<TOTAL_CAP&&seenRows>=total});
        if (data.total >= TOTAL_CAP) {
          if (shard.depth < maxShardDepth && shard.radiusMeters > 250) {
            state.queue.push(...childShards(shard).map((child) => ({ keyword, shard: child, pageNum: 0, seenRows: 0 })));
          } else state.errors.push({ keyword, shardId: shard.id, pageNum, code: 'reported_total_cap' });
        } else if (seenRows < total) {
          const short=data.results.length<pageSize;
          if(!data.results.length)state.errors.push({keyword,shardId:shard.id,pageNum,code:'premature_page_end'});
          else if(pageNum>0&&seenKeys.length===priorKeys.size)state.errors.push({keyword,shardId:shard.id,pageNum,code:'repeated_page_no_progress'});
          else {if(short)state.warnings.push({keyword,shardId:shard.id,pageNum,code:'short_page_continued'});if(pageNum+1>=maxPagesPerShard)state.errors.push({keyword,shardId:shard.id,pageNum,code:'page_limit_reached'});else state.queue.push({...item,pageNum:pageNum+1,seenRows,seenKeys,reportedTotal:total});}
        }
      } catch (error) {
        const code = error?.code ?? 'upstream_unavailable';
        state.errors.push({ keyword, shardId: shard.id, pageNum, code,apiStatus:error?.apiStatus ?? null,httpStatus:error?.httpStatus ?? null });
        if (['rate_limited', 'quota_exhausted', 'permission_denied', 'cancelled'].includes(code)) { state.queue = []; break; }
      }
    }
    const byIdentity = new Map(), duplicateUids = [];
    for (const candidate of state.candidates) {
      const key = candidate.uid ? 'uid:' + candidate.uid : JSON.stringify([candidate.name, candidate.address, candidate.location, candidate.naviLocation]);
      const previous = byIdentity.get(key);
      if (!previous) { byIdentity.set(key, candidate); continue; }
      if (candidate.uid) duplicateUids.push(candidate.uid);
      for (const field of ['matchedQueries', 'rawCategoryTags']) previous[field] = [...new Set([...previous[field], ...candidate[field]])];
      previous.entranceCandidates=[...new Map([...(previous.entranceCandidates??[]),...(candidate.entranceCandidates??[])].map(p=>[JSON.stringify(p),p])).values()];previous.parentUid??=candidate.parentUid;
      previous.serviceDetails=[...new Map([...(previous.serviceDetails??[]),...(candidate.serviceDetails??[])].map(v=>[JSON.stringify(v),v])).values()];previous.classificationEvidence.push(...candidate.classificationEvidence);
      previous.retrievalEvidence.push(...candidate.retrievalEvidence);
      previous.destinationVariants = [...new Map([...previous.destinationVariants, ...candidate.destinationVariants].map((v) => [JSON.stringify(v), v])).values()];
      previous.destinationConflict = previous.destinationVariants.length > 1;
      previous.classification = group?{candidateStatus:'pending_review',reason:'group_recall_then_subtype_classification'}:classifySubtypeCandidate({ ...previous, subtypeId });
    }
    state.candidates = [...byIdentity.values()];
    const complete = !state.queue.length && !state.errors.length && !state.invalidCandidateCount && !signal?.aborted;
    return { categoryId, subtypeId, categoryMappingVersion,recallScope:group?'whole_group_keywords':'subtype_keywords',
      status: complete ? 'complete' : state.pages.length ? 'partial' : 'failed', searchComplete: complete,
      truncated: !complete, candidates: state.candidates, candidatesFound: state.candidates.length,
      pages: state.pages, errors: state.errors,warnings:state.warnings,queryPlan:queries, discardedCandidates: state.discardedCandidates, searchQueries:subtype.searchQueries, center, radiusMeters, invalidCandidateCount: state.invalidCandidateCount, duplicateUids,
      continuation: state.queue.length && !signal?.aborted ? state : null,
      requestStats: { logicalRequests: used, maxRequests, queryGroupCount: queries.length } };
  }
  return Object.freeze({ searchAround });
}
