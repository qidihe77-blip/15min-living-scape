import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FACILITY_CATEGORY_IDS, FACILITY_CATEGORIES, FACILITY_MAPPING_VERSION, classifyFacilityCandidate,
  FACILITY_GROUPS, FACILITY_GROUP_IDS, FACILITY_SUBTYPES, FACILITY_SUBTYPE_IDS, FACILITY_V3_MAPPING_VERSION,
  getFacilitySubtype, classifySubtypeCandidate, classifyV3FacilityCandidate, publicFacilityCategoryTree } from './facility-categories.mjs';
import { evaluateFacilityAccess, evaluateSpecialtyKilometerGap } from './facility-coverage.mjs';

const center = { lat: 30.288902, lng: 120.150993 };
test('historical eight-category mapping remains available for replay and every category has candidate rules', () => {
  assert.deepEqual(FACILITY_CATEGORY_IDS, ['medical','education','commerce','eldercare','culture','sports','parks','public']);
  assert.equal(FACILITY_MAPPING_VERSION, 'facility-categories-v2');
  assert.equal(FACILITY_CATEGORIES.length, 8);
  for (const category of FACILITY_CATEGORIES) {
    assert.ok(category.searchQueries.length > 0);
    assert.ok(Array.isArray(category.excludeNamePatterns));
    assert.ok(Array.isArray(category.subtypes));
  }
});
test('specialty tags stay inside main categories and need review', () => {
  assert.deepEqual(classifyFacilityCandidate({ categoryId: 'medical', name: '仁心大药房', rawCategory: '医疗;药店' }).subtypeIds, ['pharmacy']);
  assert.deepEqual(classifyFacilityCandidate({ categoryId: 'commerce', name: '新华农贸市场' }).subtypeIds, ['market']);
  assert.deepEqual(classifyFacilityCandidate({ categoryId: 'education', name: '文锦小学' }).subtypeIds, ['primary_school']);
  assert.equal(classifyFacilityCandidate({ categoryId: 'education', name: '小学培训中心' }).subtypeIds.length, 0);
  assert.equal(classifyFacilityCandidate({ categoryId: 'sports', name: '体育用品店' }).candidateStatus, 'excluded_by_rule');
  assert.equal(classifyFacilityCandidate({ categoryId: 'medical', name: '仁心大药房' }).candidateStatus, 'pending_review');
});
test('legacy specialty IDs cannot be used as primary category and retain separate 1km check', async () => {
  const provider = { route: async () => ({ routeStatus: 'ok', durationSeconds: 600, distanceMeters: 300 }) };
  for (const id of ['market', 'pharmacy', 'primary_school']) {
    await assert.rejects(() => evaluateFacilityAccess({
      demandPoint: { id: 'd1', location: center }, categoryId: id,
      facilities: [], searchComplete: true, provider,
    }), RangeError);
    const special = evaluateSpecialtyKilometerGap({
      specialtyId: id, origin: center, facilities: [],
      searchComplete: true, searchRadiusMeters: 1000,
    });
    assert.equal(special.noFacilityWithinOneKilometer, true);
    assert.equal(special.specialtyMappingVersion, 'p0-facility-categories-v1');
  }
});

test('excluded POI names cannot establish main-category coverage', async () => {
  let calls = 0;
  const result = await evaluateFacilityAccess({
    demandPoint: { id: 'd2', location: center }, categoryId: 'sports',
    facilities: [{ uid: 'shop-1', name: '体育用品店', location: center }],
    searchComplete: true,
    provider: { route: async () => {
      calls++;
      return { routeStatus: 'ok', durationSeconds: 300, distanceMeters: 100 };
    } },
  });
  assert.equal(calls, 0);
  assert.equal(result.coverageStatus, 'unknown_route');
  assert.equal(result.candidatesRetrieved, 1);
  assert.equal(result.candidatesFound, 0);
  assert.deepEqual(result.excludedCandidates, [{ uid: 'shop-1', excludedBy: '体育用品店' }]);
});

test('v3 taxonomy fixes the six parent IDs, 25 children, icons and three specialty bindings', () => {
  assert.deepEqual(FACILITY_GROUP_IDS, ['education', 'medical', 'commerce', 'transport', 'eldercare', 'leisure']);
  assert.deepEqual(FACILITY_GROUPS.map((group) => group.subtypes.length), [5, 4, 4, 2, 4, 6]);
  assert.equal(FACILITY_V3_MAPPING_VERSION, 'facility-categories-v3');
  assert.equal(new Set(FACILITY_SUBTYPE_IDS).size, 25);
  for (const subtype of FACILITY_SUBTYPES) {
    assert.ok(FACILITY_GROUP_IDS.includes(subtype.categoryId));
    assert.ok(subtype.iconKey && subtype.searchQueries.length);
  }
  assert.equal(getFacilitySubtype('market').categoryId, 'commerce');
  assert.equal(getFacilitySubtype('pharmacy').categoryId, 'medical');
  assert.equal(getFacilitySubtype('primary_school').categoryId, 'education');
  const publicTree = publicFacilityCategoryTree();
  publicTree.categories[0].subtypes[0].label = 'mutated';
  assert.equal(FACILITY_GROUPS[0].subtypes[0].label, '幼儿园');
  assert.equal(Object.isFrozen(FACILITY_GROUPS[0].subtypes[0].searchQueries), true);
});

test('v3 confirms name or raw tags, permits early education, clinics and malls, and rejects query-only proof', () => {
  for (const [subtypeId, name] of [['childcare_early_education', '社区早教中心'], ['clinic', '民生诊所'],
    ['shopping_mall', '城市购物中心'], ['market', '社区菜店'], ['pharmacy', '仁心大药房']]) {
    assert.equal(classifySubtypeCandidate({ subtypeId, name }).candidateStatus, 'confirmed_by_rule');
  }
  assert.equal(classifySubtypeCandidate({ subtypeId: 'pharmacy', name: '仁心', rawCategory: '医疗;药店' }).candidateStatus, 'confirmed_by_rule');
  assert.equal(classifySubtypeCandidate({ subtypeId: 'pharmacy', name: '仁心', matchedQueries: ['药店'] }).candidateStatus, 'pending_review');
  assert.equal(classifyV3FacilityCandidate({ name: '街道政务服务中心', rawCategory: '政府机构;办事机构' }).subtypeIds.length, 0);
});

test('v3 does not invent school grades, misclassify childcare as elderly day care or count false facilities', () => {
  for (const subtypeId of ['primary_school', 'junior_school', 'senior_school']) {
    assert.equal(classifySubtypeCandidate({ subtypeId, name: '实验九年一贯制学校', rawCategory: '教育;学校' }).candidateStatus, 'pending_review');
  }
  assert.equal(classifySubtypeCandidate({ subtypeId: 'primary_school', name: '小学辅导培训中心' }).candidateStatus, 'excluded_by_rule');
  assert.equal(classifySubtypeCandidate({ subtypeId: 'day_care', name: '儿童日间照料中心' }).candidateStatus, 'excluded_by_rule');
  assert.equal(classifySubtypeCandidate({ subtypeId: 'sports_venue', name: '体育用品店' }).candidateStatus, 'excluded_by_rule');
  assert.equal(classifySubtypeCandidate({ subtypeId: 'public_square', name: '时代广场小区' }).candidateStatus, 'excluded_by_rule');
  assert.equal(classifySubtypeCandidate({ subtypeId: 'hospital', name: '宠物医院' }).candidateStatus, 'excluded_by_rule');
  assert.equal(classifySubtypeCandidate({ subtypeId: 'pharmacy', name: '市医院药房' }).candidateStatus, 'excluded_by_rule');
});

test('multi-function schools retain only evidenced grades and fitness squares retain both memberships', () => {
  assert.deepEqual(classifyV3FacilityCandidate({ name: '实验学校', rawCategoryTags: ['教育;小学部', '教育;初中部'] }).subtypeIds,
    ['primary_school', 'junior_school']);
  assert.deepEqual(classifyV3FacilityCandidate({ name: '社区健身广场' }).subtypeIds, ['public_square', 'fitness']);
});

test('conflicting raw tags and relation names cannot turn a shop or veterinary POI into a school or hospital', () => {
  assert.equal(classifySubtypeCandidate({ subtypeId: 'hospital', name: '安心中心', rawCategory: '宠物服务;宠物医院' }).candidateStatus, 'excluded_by_rule');
  assert.equal(classifySubtypeCandidate({ subtypeId: 'primary_school', name: '实验小学站', rawCategory: '交通设施;公交车站' }).candidateStatus, 'excluded_by_rule');
  assert.equal(classifySubtypeCandidate({ subtypeId: 'hospital', name: '人民医院便利店', rawCategory: '购物;便利店' }).candidateStatus, 'excluded_by_rule');
  assert.equal(classifySubtypeCandidate({ subtypeId: 'primary_school', name: '文锦小学用品店', rawCategory: '购物;文具店' }).candidateStatus, 'excluded_by_rule');
});
