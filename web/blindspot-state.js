// This state is independent of facility filters, route selection and scoring.
// Targets are major categories; priority facilities only keep their1km diagnostics.
export const EMPTY_BLINDSPOT_STATE=Object.freeze({visible:false});
export function sameBlindspot(a,b){return !!a&&!!b&&a.type===b.type&&a.categoryId===b.categoryId;}
export function blindspotDescriptor(target,tree){
 if(!target||target.type!=='category'||typeof target.categoryId!=='string')return null;
 const g=tree?.categories?.find(g=>g.id===target.categoryId);return g?{groupId:g.id,subtypeId:null,label:g.label}:null;
}
export function reduceBlindspotState(previous,action,{allowed=true}={}){
 const current=previous??EMPTY_BLINDSPOT_STATE;
 if(action.type==='clear')return{visible:false};
 if(action.type==='visibility'||action.type==='initialize')return{visible:allowed&&Boolean(action.type==='initialize'||action.visible)};
 if(action.type==='reconcile')return{visible:allowed&&current.visible};
 return current;
}
