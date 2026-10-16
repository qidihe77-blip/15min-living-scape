// A category-only confirmation is an internal membership, never a19th subtype.
export const hasCategoryOnlyMembership=p=>p?.categoryOnlyIds?.includes('eldercare')&&p?.eldercareClassification?.status==='confirmed';
export const hasConfirmedFacilityMembership=p=>Boolean(p?.subtypeIds?.length||hasCategoryOnlyMembership(p));
export function confirmedCategoryIds(p,tree){return[...new Set([...(p?.subtypeIds??[]).flatMap(id=>(tree?.categories??[]).filter(g=>g.subtypes.some(s=>s.id===id)).map(g=>g.id)),...(hasCategoryOnlyMembership(p)?['eldercare']:[])])];}
export function reachableCategoryCount(rows,definition){const ids=new Set(definition.subtypes.map(s=>s.id));return new Set((rows??[]).filter(p=>p.subtypeIds?.some(id=>ids.has(id))||definition.id==='eldercare'&&hasCategoryOnlyMembership(p)).map(p=>p.uid?'uid:'+p.uid:p.identityKey).filter(Boolean)).size;}
