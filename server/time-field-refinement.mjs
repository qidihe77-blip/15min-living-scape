import{buildDirectionalTimeField,prepareDirectionalField}from'../web/directional-time-field.js';
export function previousWalkingRequests(job,saved){
 const stats=job.requestStats??{},original=job.timeField?.requestStats??{},stored=saved?.requestStats??{};
 const task=stats.walkingTask?.used;
 const base=Number.isFinite(task)?task:(stats.liteRequests??stats.routeDecisions??0)+Math.max(0,(stats.samplingRequests??0)-(stats.samplingMatrixOutputRoutes??0))+(stats.internalGridWalkingGeometryRequests??0)+(stats.regionalWalkingRequests??0);
 const originalHeat=original.cumulativeWalkingRequests??original.walkingRequests??0,storedHeat=stored.cumulativeWalkingRequests??stored.walkingRequests??0;
 return base+Math.max(0,storedHeat-originalHeat);
}
// Plan against current supported topology. Targets remain observations to request,
// never predicted route costs. Independent validation points are not an input.
export function planWalkingHoleSamples(job,rows=[],{limit=6}={}){
 if(limit<=0)return[];
 const field=buildDirectionalTimeField(job,rows),model=prepareDirectionalField(job,rows);if(field.status!=='available'||!model)return[];
 const reasons=field.diagnostics.reasonNames,inside=field.diagnostics.insideMask,mask=field.mask,targets=[];
 const excluded=new Set(['over_15_minutes','unverified_direction','outside_sampled_range','invalid_local_factor']);
 for(let row=1;row<field.height-1;row++)for(let col=1;col<field.width-1;col++){
  const i=row*field.width+col,reason=reasons[field.diagnostics.reasonMask[i]];if(!inside[i]||mask[i]||excluded.has(reason))continue;
  let supported=0,missing=0;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const xx=col+dx,yy=row+dy;if(xx<0||yy<0||xx>=field.width||yy>=field.height)continue;const k=yy*field.width+xx;if(!inside[k])continue;if(mask[k])supported++;else missing++;}
  if(supported<5)continue;
  const x=(col+.5-field.width/2)*field.cellMeters,y=(field.height/2-row-.5)*field.cellMeters,nearest=Math.min(...model.anchors.filter(a=>!a.derived).map(a=>Math.hypot(a.x-x,a.y-y)));
  // An observation already at this physical point cannot validate a missing
  // connection to another bank. Spend budget on a genuine spatial information gap.
  if(nearest<45)continue;
  const location={lng:model.origin.location.lng+x/model.mx,lat:model.origin.location.lat+y/model.my};
  targets.push({location,x,y,priority:missing*(supported/25)*Math.min(3,nearest/60),reasonCode:reason,nearestActualMeters:nearest,row,col});
 }
 const selected=[];targets.sort((a,b)=>b.priority-a.priority);for(const p of targets){if(selected.some(q=>Math.hypot(p.x-q.x,p.y-q.y)<140))continue;selected.push(p);if(selected.length>=limit)break;}
 return selected;
}
