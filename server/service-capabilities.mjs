export const SERVICE_FUNCTION_RULE_VERSION='fresh-food-branch-evidence-v1';
export const SERVICE_FACETS=Object.freeze(['vegetables','fruit','fresh_meat']);
export const FUNCTION_STATUS=Object.freeze({confirmed_covered:'确认覆盖',high_confidence_substitute:'高可信替代',confirmed_missing:'确认缺失',pending_verification:'待核验'});
export const FUNCTION_QUERIES=Object.freeze([['生鲜超市','蔬菜店','蔬菜水果店','鲜肉店','水果店'],['超市','综合超市']]);
const string=v=>typeof v==='string'?v.slice(0,1600):'';
// Provider fields only. Review text, photographs, scores and chain reputation are not business evidence.
export function branchEvidenceFromPlace(raw,{source='baidu_place_around',retrievedAt=null}={}){
 const uid=string(raw.uid).trim(),d=raw.detail_info??{};if(!uid)return[];
 return['classified_poi_tag','tag','description'].flatMap(field=>{const value=string(d[field]??raw[field]);return value?[{source,uid,field:'detail_info.'+field,value,retrievedAt,scope:'branch'}]:[];});
}
const facetWords={vegetables:/蔬菜|青菜|时蔬|菜店|菜摊/,fruit:/水果|果蔬|鲜果|瓜果/,fresh_meat:/鲜肉|生肉|猪肉|牛肉|羊肉|肉铺|肉店/};
const fullWords=/生鲜超市|综合生鲜|生鲜卖场|农贸市场|菜市场/;
const genericBrandText=/集团|品牌介绍|全国门店|连锁品牌|门店遍布|旗下门店|公司简介/;
const brandHint=/联华|永辉|物美|沃尔玛|大润发|盒马|华润万家/;
const negative=(text,words)=>new RegExp('(?:不经营|不销售|不售卖|不售|不提供|暂停供应|停止销售|未经营|没有)(?:任何|相关|新鲜|此类|的|\\s){0,4}(?:'+words.source+')|无(?:任何|相关)?(?:'+words.source+')').test(text);
export function identifyFreshCapabilities(poi){
 const uid=poi.uid??null,name=string(poi.name),tags=[poi.rawCategory,...(poi.rawCategoryTags??[])].filter(v=>typeof v==='string').join(';'),evidence=[],facets={},denied=new Set(),reasons=[];
 if(/水果茶|奶茶|果汁|餐厅|餐饮|饭店/.test(tags+';'+name)&&!/超市|菜市场|农贸市场|水果店|蔬菜店/.test(tags))return{version:SERVICE_FUNCTION_RULE_VERSION,candidate:false,confidence:'insufficient',facets:{},completeFreshBundle:false,comprehensiveFresh:false,deniedFacets:[],evidence:[],reasons:['prepared_food_is_not_fresh_grocery_supply']};
 const add=(facet,level,e)=>{if(!facets[facet]||facets[facet].level==='high_confidence'&&level==='explicit')facets[facet]={level,evidence:[]};if(facets[facet].level===level)facets[facet].evidence.push(e);evidence.push(e);};
 const records=(poi.businessEvidence??[]).filter(e=>uid&&e.uid===uid&&e.scope==='branch'&&['baidu_place_around','baidu_place_detail','official_branch_catalog'].includes(e.source)&&typeof e.value==='string');
 const negativeRecords=records.filter(e=>/description|business_scope|products/.test(e.field??''));
 for(const e of negativeRecords){for(const f of SERVICE_FACETS)if(negative(e.value,facetWords[f]))denied.add(f);if(negative(e.value,/生鲜/))SERVICE_FACETS.forEach(f=>denied.add(f));}
 for(const e of records){const isType=/classified_poi_tag|\.tag$/.test(e.field??''),isBusiness=/description|business_scope|products/.test(e.field??'')&&!genericBrandText.test(e.value)&&/经营|主营|供应|销售|售卖|提供|经营范围/.test(e.value);if(!isType&&!isBusiness)continue;
  if(fullWords.test(e.value)&&!negative(e.value,fullWords))for(const f of SERVICE_FACETS)if(!denied.has(f))add(f,'explicit',{...e,rule:'branch_comprehensive_fresh'});
  for(const f of SERVICE_FACETS)if(facetWords[f].test(e.value)&&!negative(e.value,facetWords[f])&&!denied.has(f))add(f,'explicit',{...e,rule:'branch_facet_'+f});
 }
 // Existing normalized Place types retain provider provenance even without a detail response.
 for(const f of SERVICE_FACETS)if(!denied.has(f)&&facetWords[f].test(tags))add(f,'explicit',{source:'baidu_place_category',uid,field:'rawCategoryTags',value:tags,retrievedAt:poi.retrievedAt??null,rule:'provider_type_'+f});
 if(fullWords.test(tags))for(const f of SERVICE_FACETS)if(!denied.has(f))add(f,'explicit',{source:'baidu_place_category',uid,field:'rawCategoryTags',value:tags,retrievedAt:poi.retrievedAt??null,rule:'provider_comprehensive_fresh_type'});
 // A format name plus a compatible store type is a labelled inference, never brand-wide proof.
 if(/超市|购物|商店|市场|水果|蔬菜|肉/.test(tags)){
  if(fullWords.test(name))for(const f of SERVICE_FACETS)if(!denied.has(f))add(f,'high_confidence',{source:'baidu_place_name_and_type',uid,field:'name+rawCategoryTags',value:name+';'+tags,rule:'format_name_and_store_type'});
  for(const f of SERVICE_FACETS)if(!denied.has(f)&&facetWords[f].test(name))add(f,'high_confidence',{source:'baidu_place_name_and_type',uid,field:'name+rawCategoryTags',value:name+';'+tags,rule:'specialist_name_'+f});
 }
 if(brandHint.test(name))reasons.push('chain_brand_is_candidate_hint_only');
 if(denied.size)reasons.push('branch_negative_business_evidence');
 const supplied=SERVICE_FACETS.filter(f=>facets[f]),complete=supplied.length===3;
 const candidate=Boolean(supplied.length||/超市|便利店|生鲜|果蔬|蔬菜|水果|鲜肉|肉店|市场/.test(name+';'+tags)||brandHint.test(name));
 const confidence=complete&&supplied.every(f=>facets[f].level==='explicit')?'explicit':supplied.length?'high_confidence':'insufficient';
 if(candidate&&!supplied.length)reasons.push('branch_fresh_business_evidence_missing');
 if(supplied.length&&!complete)reasons.push('partial_fresh_facets_only');
 return{version:SERVICE_FUNCTION_RULE_VERSION,candidate,confidence,facets,completeFreshBundle:complete,comprehensiveFresh:complete,deniedFacets:[...denied],evidence,reasons};
}
