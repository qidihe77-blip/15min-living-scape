import { readFileSync } from 'node:fs';
import{classifyEldercare}from'./eldercare-classification.mjs';
import{facilityNameProof,leisureTagMatches,conflictingLeisureKind}from'./facility-name-evidence.mjs';

const mapping = JSON.parse(readFileSync(new URL('../data/facility-categories-v2.json', import.meta.url), 'utf8'));
const EXPECTED_IDS = ['medical', 'education', 'commerce', 'eldercare', 'culture', 'sports', 'parks', 'public'];
if (mapping.version !== 'facility-categories-v2' || mapping.coordinateSystem !== 'BD-09LL'
  || !Array.isArray(mapping.categories) || mapping.categories.length !== EXPECTED_IDS.length
  || mapping.categories.some((category, i) => category.id !== EXPECTED_IDS[i]
    || !Array.isArray(category.searchQueries) || !category.searchQueries.length
    || !Array.isArray(category.excludeNamePatterns) || !Array.isArray(category.rawCategoryHints)
    || !Array.isArray(category.subtypes))) {
  throw new Error('Invalid eight-category facility mapping.');
}
export const FACILITY_MAPPING_VERSION = mapping.version;
export const FACILITY_CATEGORIES = Object.freeze(mapping.categories.map((category) => Object.freeze(category)));
export const FACILITY_CATEGORY_IDS = Object.freeze(FACILITY_CATEGORIES.map((category) => category.id));
const categoryById = new Map(FACILITY_CATEGORIES.map((category) => [category.id, category]));
export function getFacilityCategory(id) { return categoryById.get(id) ?? null; }

export function classifyFacilityCandidate({ categoryId, name = '', rawCategory = '' } = {}) {
  const category = getFacilityCategory(categoryId);
  if (!category) throw new RangeError('Unknown facility category.');
  const text = String(name);
  const excludedBy = category.excludeNamePatterns.find((term) => text.includes(term)) ?? null;
  const subtypeIds = excludedBy ? [] : category.subtypes
    .filter((subtype) => subtype.namePatterns.some((term) => text.includes(term))
      && !subtype.excludeNamePatterns.some((term) => text.includes(term)))
    .map((subtype) => subtype.id);
  return {
    categoryId, categoryMappingVersion: FACILITY_MAPPING_VERSION, subtypeIds,
    candidateStatus: excludedBy ? 'excluded_by_rule' : 'pending_review',
    excludedBy, rawCategoryHintMatched: category.rawCategoryHints.some((term) => String(rawCategory).includes(term)),
  };
}

// v2 exports above serve historical evidence and replay only. New tasks use this tree.
const v3 = JSON.parse(readFileSync(new URL('../data/facility-categories-v3.json', import.meta.url), 'utf8'));
const GROUP_IDS = ['education', 'medical', 'commerce', 'transport', 'eldercare', 'leisure'];
const COUNTS = [5, 4, 4, 2, 4, 6];
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
const childIds = new Set();
if (v3.version !== 'facility-categories-v3' || v3.coordinateSystem !== 'BD-09LL'
  || v3.scope?.mode !== 'walking' || v3.scope?.minutes !== 15 || v3.scope?.subtypeScope !== 'all'
  || v3.categories?.length !== 6 || v3.categories.some((group, i) => {
    if (group.id !== GROUP_IDS[i] || !group.label || !group.iconKey || !/^#[0-9a-f]{6}$/i.test(group.color)
      || group.subtypes?.length !== COUNTS[i]) return true;
    return group.subtypes.some((subtype) => {
      if (!subtype.id || childIds.has(subtype.id) || !subtype.label || !subtype.iconKey
        || !['searchQueries', 'namePatterns', 'rawCategoryHints', 'excludeNamePatterns',
          'excludeCategoryPatterns', 'specialtyTags'].every((key) => Array.isArray(subtype[key])
            && subtype[key].every((term) => typeof term === 'string' && term.length > 0))
        || !subtype.searchQueries.length || subtype.searchQueries.some((q) => q.includes('$'))) return true;
      childIds.add(subtype.id);
      return false;
    });
  }) || childIds.size !== 25
  || v3.specialtySubtypeIds?.join(',') !== 'market,pharmacy,primary_school') {
  throw new Error('Invalid six-group facility mapping.');
}
deepFreeze(v3);
export const FACILITY_V3_MAPPING_VERSION = v3.version;
export const FACILITY_CLASSIFICATION_VERSION = v3.classificationVersion;
export const FACILITY_GROUPS = v3.categories;
export const FACILITY_GROUP_IDS = Object.freeze(FACILITY_GROUPS.map((group) => group.id));
export const FACILITY_SUBTYPES = Object.freeze(FACILITY_GROUPS.flatMap((group) => group.subtypes
  .map((subtype) => deepFreeze({ ...subtype, categoryId: group.id }))));
export const FACILITY_SUBTYPE_IDS = Object.freeze(FACILITY_SUBTYPES.map((subtype) => subtype.id));
const groupById = new Map(FACILITY_GROUPS.map((group) => [group.id, group]));
const subtypeById = new Map(FACILITY_SUBTYPES.map((subtype) => [subtype.id, subtype]));
export function getFacilityGroup(id) { return groupById.get(id) ?? null; }
export const FACILITY_V4_MAPPING_VERSION = 'facility-categories-v4';
const v4 = JSON.parse(readFileSync(new URL('../data/facility-categories-v4.json', import.meta.url), 'utf8'));
if(v4.version!==FACILITY_V4_MAPPING_VERSION || v4.categories.map(g=>g.subtypes.length).join(',')!=='3,4,4,2,4,6'
 || new Set(v4.categories.flatMap(g=>g.subtypes.map(s=>s.id))).size!==23)throw new Error('Invalid v4 mapping.');
deepFreeze(v4);
export const FACILITY_V5_MAPPING_VERSION='facility-categories-v5';
const v5=JSON.parse(readFileSync(new URL('../data/facility-categories-v5.json',import.meta.url),'utf8'));
if(v5.version!==FACILITY_V5_MAPPING_VERSION || v5.categories.map(g=>g.subtypes.length).join(',')!=='3,4,4,2,2,4'
 || new Set(v5.categories.flatMap(g=>g.subtypes.map(s=>s.id))).size!==19)throw new Error('Invalid v5 mapping.');
deepFreeze(v5);
export const FACILITY_V6_MAPPING_VERSION="facility-categories-v6";
const v6=JSON.parse(readFileSync(new URL("../data/facility-categories-v6.json",import.meta.url),"utf8"));
if(v6.version!==FACILITY_V6_MAPPING_VERSION||v6.categories.map(g=>g.subtypes.length).join(",")!=="3,2,4,2,2,4"||new Set(v6.categories.flatMap(g=>g.subtypes.map(s=>s.id))).size!==17)throw new Error("Invalid v6 mapping.");
deepFreeze(v6);
export const FACILITY_V7_MAPPING_VERSION='facility-categories-v7';
const v7=JSON.parse(readFileSync(new URL('../data/facility-categories-v7.json',import.meta.url),'utf8'));
if(v7.version!==FACILITY_V7_MAPPING_VERSION||v7.categories.map(g=>g.subtypes.length).join(',')!=='3,2,4,2,3,4'||new Set(v7.categories.flatMap(g=>g.subtypes.map(s=>s.id))).size!==18)throw new Error('Invalid v7 mapping.');
deepFreeze(v7);
export const FACILITY_V8_MAPPING_VERSION='facility-categories-v8';
const v8=JSON.parse(readFileSync(new URL('../data/facility-categories-v8.json',import.meta.url),'utf8'));
if(v8.categories.map(g=>g.subtypes.length).join(',')!=='3,3,4,2,3,3'||new Set(v8.categories.flatMap(g=>g.subtypes.map(s=>s.id))).size!==18)throw Error('Invalid v8 mapping');deepFreeze(v8);
export function facilityRequestVersion(version){return version===FACILITY_V8_MAPPING_VERSION?8:version===FACILITY_V7_MAPPING_VERSION?7:version===FACILITY_V6_MAPPING_VERSION?6:version===FACILITY_V5_MAPPING_VERSION?5:version===FACILITY_V4_MAPPING_VERSION?4:version===FACILITY_V3_MAPPING_VERSION?3:(()=>{throw new RangeError('Unsupported mapping version.');})();}
export function facilityCategoryTree(version = FACILITY_V3_MAPPING_VERSION) {
 if(version===FACILITY_V8_MAPPING_VERSION)return v8;
 if(version===FACILITY_V7_MAPPING_VERSION)return v7;
 if(version===FACILITY_V3_MAPPING_VERSION)return v3;
 if(version===FACILITY_V4_MAPPING_VERSION)return v4;
 if(version===FACILITY_V5_MAPPING_VERSION)return v5;
 if(version===FACILITY_V6_MAPPING_VERSION)return v6;
 throw new RangeError('Unsupported category mapping version.');
}
export function getFacilitySubtype(id, version = FACILITY_V3_MAPPING_VERSION) {
 if(version===FACILITY_V3_MAPPING_VERSION)return subtypeById.get(id) ?? null;
 for(const group of facilityCategoryTree(version).categories){const sub=group.subtypes.find(s=>s.id===id);if(sub)return {...sub,categoryId:group.id};}
 return null;
}
export function publicFacilityCategoryTree(version = FACILITY_V3_MAPPING_VERSION) {
  return structuredClone({ ...facilityCategoryTree(version), requestVersion: facilityRequestVersion(version) });
}

export function classifySubtypeCandidate({ subtypeId, name = '', rawCategory = '',
  rawCategoryTags = [], classificationEvidence = [],serviceDetails=[],stationIdentityStatus=null, categoryMappingVersion = FACILITY_V3_MAPPING_VERSION } = {}) {
  const subtype = getFacilitySubtype(subtypeId, categoryMappingVersion);
  if (!subtype) throw new RangeError('Unknown facility subtype.');
  if(categoryMappingVersion===FACILITY_V8_MAPPING_VERSION&&subtype.categoryId==='eldercare'){
   const elder=classifyEldercare({name,rawCategory,rawCategoryTags,classificationEvidence,serviceDetails}),confirmed=elder.status==='confirmed'&&elder.subtypeIds.includes(subtypeId),excluded=elder.status==='rejected'||elder.status==='confirmed'&&elder.subtypeIds.length>0&&!confirmed;
   return{categoryId:'eldercare',subtypeId,subtypeIds:confirmed?[subtypeId]:[],categoryMappingVersion,classificationVersion:facilityCategoryTree(categoryMappingVersion).classificationVersion,candidateStatus:confirmed?'confirmed_by_rule':excluded?'excluded_by_rule':'pending_review',excludedBy:excluded?elder.reason:null,ruleEvidence:{nameMatches:confirmed?[name]:[],tagMatches:[],eldercare:elder},reason:elder.reason};
  }
  const names = [String(name), ...classificationEvidence.map((e) => String(e.name ?? ''))];
  const tags = [...new Set([String(rawCategory), ...rawCategoryTags.map(String),
    ...classificationEvidence.flatMap((e) => e.rawCategoryTags ?? [e.rawCategory ?? ''])])];
  const modernEducation = categoryMappingVersion !== FACILITY_V3_MAPPING_VERSION && subtype.categoryId === 'education';
  const explicitGradeTag = tags.some(tag=>subtype.rawCategoryHints.some(term=>tag.includes(term)));
  const excludedName = subtype.excludeNamePatterns.find((term) => names.some((n) => n.includes(term)
    && !(modernEducation && ['大学','学院'].includes(term) && explicitGradeTag)));
  const excludedTag = [...subtype.excludeNamePatterns, ...subtype.excludeCategoryPatterns]
    .find((term) => tags.some((tag) => String(tag).includes(term)
      && !(modernEducation && term==='培训' && String(tag).includes('教育培训') && !/培训机构|培训中心|培训学校/.test(String(tag)))));
  const ownName=categoryMappingVersion===FACILITY_V8_MAPPING_VERSION?facilityNameProof(names,subtype.namePatterns):null;
  const nameMatches = ownName?.matches??subtype.namePatterns.filter((term) => names.some((n) => n.includes(term)));
  const modernLeisure=categoryMappingVersion===FACILITY_V8_MAPPING_VERSION&&subtype.categoryId==='leisure';
  const tagMatches = modernLeisure?leisureTagMatches(tags,subtype.rawCategoryHints):subtype.rawCategoryHints.filter((term) => tags.some((tag) => String(tag).includes(term)));
  const entranceOnly = modernEducation && tags.some(tag=>/出入口|校内设施/.test(tag));
  const otherGrade = modernEducation && !tagMatches.length && !nameMatches.length
    && tags.some(tag=>/幼儿园|小学|中学|初中|高中/.test(tag));
  const otherElder=[FACILITY_V7_MAPPING_VERSION,FACILITY_V8_MAPPING_VERSION].includes(categoryMappingVersion)&&subtype.categoryId==='eldercare'&&!nameMatches.length&&!tagMatches.length
    &&facilityCategoryTree(categoryMappingVersion).categories.find(g=>g.id==='eldercare').subtypes.some(s=>s.id!==subtypeId&&(s.namePatterns.some(t=>names.some(n=>n.includes(t)))||s.rawCategoryHints.some(t=>tags.some(n=>n.includes(t)))));
  // Administrative tags are sometimes assigned to named public-service centres;
  // they are not commercial-kind evidence and must not erase explicit functions.
  const knownOtherKind=!tagMatches.length&&tags.some(tag=>/酒店|宾馆|停车场|临时停车|自行车租赁|公司企业|餐饮|美食|咖啡厅|房地产/.test(tag));
  const incidentalMetro=subtypeId==='metro_station'&&(names.some(n=>/酒店|宾馆|旅馆|停车场|临时停车|自行车|租赁|便利店|超市|公司|售楼|派出所/.test(n))||!tagMatches.length&&tags.some(tag=>/公交车站|公交站/.test(tag)));
  const unrelatedEntrance=subtype.categoryId!=='transport'&&tags.some(tag=>/^出入口(?:;|$)/.test(tag))&&!tagMatches.length;
  const transportOrAddress=categoryMappingVersion===FACILITY_V8_MAPPING_VERSION&&subtype.categoryId!=='transport'&&tags.some(tag=>/公交车站|公交站|地铁站|地铁出入口|地名地址信息|^道路(?:;|$)|^路口$/.test(String(tag)));
  const incidentalLocation=!nameMatches.length&&!tagMatches.length&&ownName?.incidentalMatches.length>0;
  const excludedBy = excludedName ?? excludedTag ?? (transportOrAddress?'confirmed_transport_or_address_poi_kind':modernLeisure&&conflictingLeisureKind(tags)?'confirmed_non_leisure_poi_kind':incidentalLocation?'incidental_location_name':knownOtherKind?'confirmed_other_poi_kind':incidentalMetro?'incidental_station_name':unrelatedEntrance?'entrance_without_parent_facility':entranceOnly?'entrance_or_internal_facility':otherGrade?'confirmed_other_education_subtype':otherElder?'confirmed_other_eldercare_subtype':null);
  const compositeWithoutGrade = categoryMappingVersion !== FACILITY_V3_MAPPING_VERSION && subtype.categoryId === 'education'
    && names.some(n=>/一贯制|实验学校|附属学校|外国语学校|学校/.test(n))
    && !tagMatches.length;
  const unresolvedStation=subtypeId==='metro_station'&&stationIdentityStatus==='pending';
  const status = excludedBy ? 'excluded_by_rule' : compositeWithoutGrade||unresolvedStation ? 'pending_review'
    : nameMatches.length || tagMatches.length ? 'confirmed_by_rule' : 'pending_review';
  return { categoryId: subtype.categoryId, subtypeId,
    subtypeIds: status === 'confirmed_by_rule' ? [subtypeId] : [],
    categoryMappingVersion,
    classificationVersion: facilityCategoryTree(categoryMappingVersion).classificationVersion,
    candidateStatus: status, excludedBy,
    ruleEvidence: { nameMatches, tagMatches, excludedName: excludedName ?? null, excludedTag: excludedTag ?? null,...(ownName?{incidentalNameMatches:ownName.incidentalMatches}: {}) },
    reason: categoryMappingVersion===FACILITY_V3_MAPPING_VERSION
      ?excludedBy?'excluded_match':status==='confirmed_by_rule'?'name_or_raw_tag_match':'insufficient_classification_evidence'
      :excludedBy ?? (unresolvedStation?'station_parent_unverified':status === 'confirmed_by_rule' ? 'name_or_raw_tag_match' : 'insufficient_classification_evidence'),
  };
}

export function classifyV3FacilityCandidate(candidate = {}, categoryMappingVersion = candidate.categoryMappingVersion ?? FACILITY_V3_MAPPING_VERSION) {
  const definitions = facilityCategoryTree(categoryMappingVersion).categories.flatMap(g=>g.subtypes.map(s=>({...s,categoryId:g.id})));
  const memberships = definitions.map((subtype) => classifySubtypeCandidate({ ...candidate, categoryMappingVersion, subtypeId: subtype.id }));
  const confirmed = memberships.filter((membership) => membership.candidateStatus === 'confirmed_by_rule');
  const elder=categoryMappingVersion===FACILITY_V8_MAPPING_VERSION?classifyEldercare(candidate):null,categoryOnlyIds=elder?.status==='confirmed'&&!elder.subtypeIds.length?['eldercare']:[];
  return { categoryMappingVersion,
    classificationVersion: facilityCategoryTree(categoryMappingVersion).classificationVersion,
    categoryIds: [...new Set([...confirmed.map((item) => item.categoryId),...categoryOnlyIds])],
    subtypeIds: confirmed.map((item) => item.subtypeId), memberships,...(elder?{eldercareClassification:elder,categoryOnlyIds}: {}) };
}
