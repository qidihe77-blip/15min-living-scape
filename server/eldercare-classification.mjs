export const ELDERCARE_RULE_VERSION='eldercare-category-and-subtype-v2';
// Recall terms are never classification evidence. Only returned branch-level
// names, provider tags and existing detail fields can confirm a service.
export function classifyEldercare(candidate={}){
 const names=[candidate.name,...(candidate.classificationEvidence??[]).map(e=>e.name)].filter(v=>typeof v==='string'),tags=[candidate.rawCategory,...candidate.rawCategoryTags??[],...(candidate.classificationEvidence??[]).flatMap(e=>e.rawCategoryTags??[e.rawCategory])].filter(v=>typeof v==='string'),details=[...candidate.serviceDetails??[],...(candidate.classificationEvidence??[]).flatMap(e=>e.serviceDetails??[])].map(v=>typeof v==='string'?v:v?.text).filter(v=>typeof v==='string');
 const evidence=[],match=(values,pattern,source)=>{const found=values.filter(v=>pattern.test(v));for(const text of found)evidence.push({source,text});return found.length>0;};
 const commercialName=names.some(n=>/(?:餐厅|饭店|饭庄|餐馆|酒楼|酒店|宾馆|便利店|超市|奶茶店|火锅店|美容店|器械店|用品店|设备公司|咨询公司|招聘中心|售楼处|营销中心)(?:[（(].*[）)])?$/.test(n)),commercialTag=tags.some(t=>/餐饮|美食|酒店|宾馆|公司企业|购物.*(?:用品|器械)|房地产.*(?:住宅|公寓)|住宅区|住宅小区/.test(t));
 if(commercialName||commercialTag)return{ruleVersion:ELDERCARE_RULE_VERSION,status:'rejected',categoryId:'eldercare',subtypeIds:[],reason:'unrelated_commercial_or_residential_poi',evidence};
 if(tags.some(t=>/^出入口(?:;|$)|内部设施|附属设施/.test(t)))return{ruleVersion:ELDERCARE_RULE_VERSION,status:'rejected',categoryId:'eldercare',subtypeIds:[],reason:'entrance_or_internal_facility',evidence};
 const tagConfirmed=match(tags,/养老机构|养老院|敬老院|养护院|养老服务|为老服务|日间照料|日间照护|老年(?:人)?活动中心|老年(?:人)?活动室|长者照护/,'provider_tag'),nameConfirmed=match(names,/养老院|敬老院|养护院|颐养院|为老服务中心|(?:社区|居家)?养老服务(?:中心|站|驿站)|居家养老服务照料中心|养老服务照料中心|(?:老年|长者|养老)护理院|老年公寓|长者照护之家|托老所|长者服务中心|老年(?:人)?活动(?:中心|室|站)|老人活动中心|长者活动(?:中心|室)|日间照料|日间照护/,'poi_name'),detailConfirmed=match(details,/提供.{0,12}(?:养老照护|老年人日间照料|长者照护)|养老机构|机构养老|(?:社区|居家)养老服务|老年(?:人)?(?:护理|照护)服务|长者照护服务|养老床位/,'provider_detail');
 if(!tagConfirmed&&!nameConfirmed&&!detailConfirmed)return{ruleVersion:ELDERCARE_RULE_VERSION,status:'insufficient',categoryId:'eldercare',subtypeIds:[],reason:'eldercare_property_not_confirmed',evidence};
 const all=[...names,...tags,...details],subtypeIds=[];
 if(all.some(v=>/养老院|敬老院|养护院|颐养院|养老床位|提供长期(?:入住|住养|托养)|住宿照护/.test(v)))subtypeIds.push('residential_eldercare');
 if(all.some(v=>/日间照料|日间照护|居家养老服务照料中心|养老服务照料中心|日间托养/.test(v)))subtypeIds.push('day_care');
 if(all.some(v=>/老年(?:人)?活动(?:中心|室|站)|老人活动中心|长者活动(?:中心|室)/.test(v)))subtypeIds.push('senior_activity');
 const fallback=!subtypeIds.length;if(fallback)subtypeIds.push('residential_eldercare');
 return{ruleVersion:ELDERCARE_RULE_VERSION,status:'confirmed',categoryId:'eldercare',subtypeIds,reason:fallback?'eldercare_unspecified_assigned_to_residential':'explicit_eldercare_subtype',evidence,...(fallback?{subtypeAssignment:'user_requested_residential_fallback'}:{})};
}
