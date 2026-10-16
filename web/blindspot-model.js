import{buildServiceGapGrid}from'./service-gap-grid.js?v=a86';
import{blindspotDescriptor}from'./blindspot-state.js?v=a86';
// Only the six major categories participate in the existing200m gap kernel.
export const blindspotKey=target=>target.type+':'+target.categoryId;
export function blindspotTargets(tree){return(tree?.categories??[]).map(g=>({type:'category',categoryId:g.id}));}
export function buildBlindspotModels(job,rows,tree){return blindspotTargets(tree).map(target=>buildBlindspotModel(job,rows,tree,target));}
export function buildBlindspotModel(job,rows,tree,target){
 const d=blindspotDescriptor(target,tree),unavailable=reason=>({categoryId:d?.groupId??null,subtypeId:d?.subtypeId??null,target,status:'unavailable',components:[],reasonCodes:[reason],newApiRequests:0,affectsScore:false});
 if(!d)return unavailable('invalid_blindspot_target');
 const model=buildServiceGapGrid(job,rows,tree,d.groupId);
 return{...model,target:{...target},representation:model.status==='available'?'area':null};
}
export function hasBlindspotDisplay(model){return model?.status==='available'&&Boolean(model.components?.length);}
