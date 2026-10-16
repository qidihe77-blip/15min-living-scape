import test from 'node:test';
import assert from 'node:assert/strict';
import { FACILITY_CATEGORY_IDS, FACILITY_MAPPING_VERSION, FACILITY_GROUPS } from './facility-categories.mjs';
import { FACILITY_ANALYSIS_VERSION, createLegacyFacilityAnalysis as createFacilityAnalysis } from './facility-analysis.mjs';
import { PRIORITY_SCORE_VERSION, scoreFacilityPriorities, scoreSixGroupPriorities } from './priority-score.mjs';

const origin = { id: 'origin-1', location: { lat: 30.288902, lng: 120.150993 } };

function category(categoryId, coverageStatus) {
  const durationSeconds = coverageStatus === 'covered' ? 900 : 901;
  const confirmed = coverageStatus === 'covered' || coverageStatus === 'over_threshold';
  return {
    categoryId, categoryMappingVersion: FACILITY_MAPPING_VERSION,
    mode: 'walking', thresholdSeconds: 900, coverageStatus,
    searchComplete: coverageStatus !== 'unknown_search',
    candidatesFound: confirmed ? 1 : 0,
    routes: confirmed ? [{ evidenceId: 'route-' + categoryId, routeStatus: 'ok', durationSeconds }] : [],
    evidenceIds: confirmed ? ['route-' + categoryId] : [],
    shortestRouteSeconds: confirmed ? durationSeconds : null,
  };
}

function fixture() {
  const statuses = [
    'covered', 'covered', 'over_threshold', 'unknown_search',
    'unknown_route', 'unknown_route', 'unknown_search', 'unknown_route',
  ];
  return {
    algorithmVersion: FACILITY_ANALYSIS_VERSION,
    categoryMappingVersion: FACILITY_MAPPING_VERSION,
    origin, mode: 'walking', thresholdSeconds: 900, geometrySource: 'none',
    categories: FACILITY_CATEGORY_IDS.map((id, index) => category(id, statuses[index])),
  };
}

test('default equal priorities score confirmed coverage and keep unknown as an interval', () => {
  const result = scoreFacilityPriorities({ analysis: fixture() });
  assert.equal(result.formulaVersion, PRIORITY_SCORE_VERSION);
  assert.equal(result.evidenceVersion, FACILITY_ANALYSIS_VERSION);
  assert.equal(result.categoryMappingVersion, FACILITY_MAPPING_VERSION);
  assert.equal(result.positiveWeightTotal, 8);
  assert.equal(result.S_low, 25);
  assert.equal(result.S_high, 87.5);
  assert.equal(result.unknownWeight, 0.625);
  assert.equal(result.isExact, false);
  assert.equal(result.normalizedWeights.medical, 0.125);
  assert.deepEqual(result.categories[0].evidenceIds, ['route-medical']);
  assert.match(result.evidenceFingerprint, /^[0-9a-f]{64}$/);
});

test('selection and zero priority change the denominator without changing evidence identity', () => {
  const analysis = fixture();
  const original = scoreFacilityPriorities({ analysis });
  const selected = scoreFacilityPriorities({
    analysis, selectedCategoryIds: ['medical', 'commerce', 'parks'],
    priorities: { medical: 2, commerce: 1, parks: 1, education: 5 },
  });
  assert.equal(selected.S_low, 50);
  assert.equal(selected.S_high, 75);
  assert.equal(selected.unknownWeight, 0.25);
  assert.deepEqual(Object.keys(selected.priorities), ['medical', 'commerce', 'parks']);
  assert.equal(selected.evidenceFingerprint, original.evidenceFingerprint);

  const zero = scoreFacilityPriorities({
    analysis, selectedCategoryIds: ['medical', 'commerce', 'parks'],
    priorities: { medical: 0, commerce: 2, parks: 1 },
  });
  assert.equal(zero.S_low, 0);
  assert.equal(zero.S_high, 33.333333);
  assert.equal(zero.normalizedWeights.medical, 0);
  assert.equal(zero.categories[0].contributionHigh, 0);
  assert.equal(zero.evidenceFingerprint, original.evidenceFingerprint);
});

test('all known and all unknown categories preserve exact and interval boundaries', () => {
  const analysis = fixture();
  const known = scoreFacilityPriorities({
    analysis, selectedCategoryIds: ['medical', 'commerce'], priorities: { medical: 2, commerce: 1 },
  });
  assert.equal(known.S_low, 66.666667);
  assert.equal(known.S_high, known.S_low);
  assert.equal(known.isExact, true);
  const unknown = scoreFacilityPriorities({ analysis, selectedCategoryIds: ['parks'] });
  assert.equal(unknown.S_low, 0);
  assert.equal(unknown.S_high, 100);
  assert.equal(unknown.unknownWeight, 1);
});

test('rejects zero, invalid, absent and inconsistent category evidence', () => {
  const analysis = fixture();
  const allZero = Object.fromEntries(FACILITY_CATEGORY_IDS.map((id) => [id, 0]));
  assert.throws(() => scoreFacilityPriorities({ analysis, priorities: allZero }), /positive priority/);
  assert.throws(() => scoreFacilityPriorities({ analysis, priorities: { medical: 6 } }), /0 to 5/);
  assert.throws(() => scoreFacilityPriorities({ analysis, priorities: { medical: 1.5 } }), /0 to 5/);
  assert.throws(() => scoreFacilityPriorities({ analysis, selectedCategoryIds: ['medical', 'medical'] }), /unique/);
  assert.throws(() => scoreFacilityPriorities({ analysis, selectedCategoryIds: ['market'] }), /unique/);
  assert.throws(() => scoreFacilityPriorities({
    analysis: { ...analysis, categories: analysis.categories.slice(1) },
    selectedCategoryIds: ['medical'],
  }), /unique/);
  assert.throws(() => scoreFacilityPriorities({
    analysis: { ...analysis, categoryMappingVersion: 'old-version' },
  }), /versioned/);
  assert.throws(() => scoreFacilityPriorities({
    analysis: { ...analysis, categories: [
      { ...analysis.categories[0], routes: [] }, ...analysis.categories.slice(1),
    ] }, selectedCategoryIds: ['medical'],
  }), /in-threshold route/);
  assert.throws(() => scoreFacilityPriorities({
    analysis: { ...analysis, categories: [
      ...analysis.categories.slice(0, 2),
      { ...analysis.categories[2], searchComplete: false },
      ...analysis.categories.slice(3),
    ] }, selectedCategoryIds: ['commerce'],
  }), /complete route evidence/);
});

test('the same C08 route snapshot can be reweighted without calling Place or Route again', async () => {
  let placeCalls = 0;
  let routeCalls = 0;
  const service = createFacilityAnalysis({
    placeProvider: { searchAround: async ({ categoryId }) => {
      placeCalls++;
      return { status: 'complete', searchComplete: true, truncated: false,
        candidates: [{ uid: categoryId, name: categoryId,
          location: { lat: origin.location.lat + 0.001, lng: origin.location.lng } }],
        pages: [], errors: [] };
    } },
    routeProvider: { route: async (_from, _to, options) => {
      routeCalls++;
      return { routeStatus: 'ok', durationSeconds: options.destinationUid === 'medical' ? 900 : 901,
        distanceMeters: 500, source: 'direction_lite' };
    } },
  });
  const analysis = await service.analyze({ origin, categoryIds: ['medical', 'education'] });
  const equal = scoreFacilityPriorities({ analysis });
  const favored = scoreFacilityPriorities({ analysis, priorities: { medical: 4, education: 1 } });
  assert.equal(equal.S_low, 50);
  assert.equal(favored.S_low, 80);
  assert.equal(equal.evidenceFingerprint, favored.evidenceFingerprint);
  assert.equal(placeCalls, 2);
  assert.equal(routeCalls, 2);
});

function sixFixture(statusFor) {
  return { version:3, categoryMappingVersion:'facility-categories-v3', mode:'walking',thresholdSeconds:900,
    algorithmVersion:'six-group-subtype-route-evidence-v1',nearestAlgorithmVersion:'verified-walking-distance-v1',origin,
    categories:FACILITY_GROUPS.map((group)=>({categoryId:group.id,mode:'walking',thresholdSeconds:900,
      categoryMappingVersion:'facility-categories-v3',subtypeResults:group.subtypes.map((sub)=>{
        const state=statusFor(group.id,sub.id);
        const routes=state==='reachable'?[{evidenceId:'v3-'+sub.id,routeStatus:'ok',durationSeconds:900,distanceMeters:100,
          mode:'walking',coordinateSystem:'BD-09LL',classification:{candidateStatus:'confirmed_by_rule'}}]:[];
        return {categoryId:group.id,subtypeId:sub.id,mode:'walking',thresholdSeconds:900,
          categoryMappingVersion:'facility-categories-v3',accessStatus:state,routes,evidenceIds:routes.map((r)=>r.evidenceId),
          confirmedCandidateCount:routes.length,searchComplete:state!=='unknown',nearestComplete:state!=='unknown',
          nearestStatus:state==='reachable'?'nearest_in_declared_search':'unavailable',unknownReasons:state==='unknown'?['search_incomplete']:[]};
      })})) };
}
test('v3 medical pharmacy alone scores 25, other medical subtypes unknown widen to 25–100',()=>{
  for(const missing of ['unknown','no_reachable_in_declared_search']){
    const analysis=sixFixture((_g,sub)=>sub==='pharmacy'?'reachable':missing);
    const weights=Object.fromEntries(FACILITY_GROUPS.map((g)=>[g.id,g.id==='medical'?5:0]));
    const score=scoreSixGroupPriorities({analysis,priorities:weights});
    assert.equal(score.S_low,25);assert.equal(score.S_high,missing==='unknown'?100:25);
    const medical=score.categories.find((g)=>g.categoryId==='medical');
    assert.equal(medical.totalSubtypeCount,4);assert.equal(medical.reachableSubtypeCount,1);
    assert.equal(score.formulaVersion,'six-group-subtype-access-v1');
  }
});
test('v3 weights group means equally despite transport having 2 and leisure 6 subtypes',()=>{
  const analysis=sixFixture((group)=>['transport','leisure'].includes(group)?'reachable':'no_reachable_in_declared_search');
  const score=scoreSixGroupPriorities({analysis});
  assert.equal(score.S_low,33.333333);assert.equal(score.S_high,33.333333);
  assert.equal(score.categories.find((g)=>g.categoryId==='transport').contributionLow,
    score.categories.find((g)=>g.categoryId==='leisure').contributionLow);
});
test('v3 all-zero weights preserve full denominator and evidence identity, display fields never affect scoring',()=>{
  const analysis=sixFixture((_g,id)=>id==='pharmacy'?'reachable':'unknown');
  const original=scoreSixGroupPriorities({analysis});
  const zero=scoreSixGroupPriorities({analysis,priorities:Object.fromEntries(FACILITY_GROUPS.map((g)=>[g.id,0]))});
  assert.equal(zero.scoreStatus,'not_requested');assert.equal(zero.S_low,null);assert.equal(zero.S_high,null);
  assert.equal(zero.evidenceFingerprint,original.evidenceFingerprint);
  analysis.activeCategoryId='medical';
  assert.equal(scoreSixGroupPriorities({analysis}).evidenceFingerprint,original.evidenceFingerprint);
  assert.throws(()=>scoreSixGroupPriorities({analysis,selectedCategoryIds:['medical']}),/denominator/);
  analysis.categories[1].subtypeResults[0].routes.push({durationSeconds:800,routeStatus:'ok'});
  assert.notEqual(scoreSixGroupPriorities({analysis}).evidenceFingerprint,original.evidenceFingerprint);
});
test('v3 rejects missing children, old mappings, wrong classification and forged absence even at zero weight',()=>{
  const original=sixFixture((_g,id)=>id==='pharmacy'?'reachable':'no_reachable_in_declared_search');
  for(const mutate of [
    (a)=>{a.categoryMappingVersion='facility-categories-v2';},
    (a)=>{a.categories[0].subtypeResults.pop();},
    (a)=>{a.categories[1].subtypeResults[3].routes[0].classification.candidateStatus='pending_review';},
    (a)=>{a.categories[1].subtypeResults[3].routes[0].durationSeconds=901;},
    (a)=>{a.categories[0].subtypeResults[0].searchComplete=false;},
  ]){
    const analysis=structuredClone(original);mutate(analysis);
    assert.throws(()=>scoreSixGroupPriorities({analysis,priorities:Object.fromEntries(FACILITY_GROUPS.map((g)=>[g.id,0]))}));
  }
});
