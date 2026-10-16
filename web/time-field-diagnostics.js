export const TIME_FIELD_REASONS=['supported','outside_sampled_range','over_15_minutes','unverified_direction','outside_measured_radial_support','insufficient_spatial_support','measured_cost_discontinuity','unverified_local_network_connection','invalid_local_factor','unstable_spatial_estimate','feather_zero'];
export const timeFieldReasonId=reason=>Math.max(0,TIME_FIELD_REASONS.indexOf(reason));
// Four-neighbour topology counts gaps without changing or filling any cells.
export function timeFieldTopology(mask,inside,width,height=width){
 const components=value=>{const seen=new Uint8Array(mask.length),result=[];for(let i=0;i<mask.length;i++){
  if(seen[i]||!inside[i]||Number(!!mask[i])!==value)continue;const queue=[i];seen[i]=1;let boundary=false;
  for(let n=0;n<queue.length;n++){const id=queue[n],x=id%width,y=Math.floor(id/width);for(const [xx,yy]of[[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){
   if(xx<0||yy<0||xx>=width||yy>=height||!inside[yy*width+xx]){boundary=true;continue;}const next=yy*width+xx;
   if(!seen[next]&&Number(!!mask[next])===value){seen[next]=1;queue.push(next);}
  }}result.push({cells:queue.length,touchesRangeBoundary:boundary,indices:queue});
 }return result;};
 const transparent=components(0),supported=components(1),holes=transparent.filter(c=>!c.touchesRangeBoundary);
 return{internalHoleCount:holes.length,internalHoleCells:holes.reduce((n,c)=>n+c.cells,0),smallHoleCount:holes.filter(c=>c.cells<=4).length,supportedComponentCount:supported.length,largestSupportedComponentCells:Math.max(0,...supported.map(c=>c.cells)),holes};
}
// A fractional raster coordinate is covered only if its original support cell
// is covered. The fade measures distance to unknown cell rectangles inward.
// It never closes a hole or blurs valid alpha into an unsupported cell.
export function supportedAlphaAt(mask,width,height,u,v,feather=.65){
 const x=Math.floor(u),y=Math.floor(v);if(x<0||y<0||x>=width||y>=height||!mask[y*width+x])return 0;let distance=1;
 for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
  const xx=x+dx,yy=y+dy;if(xx>=0&&yy>=0&&xx<width&&yy<height&&mask[yy*width+xx])continue;
  const d=Math.hypot(Math.max(xx-u,0,u-(xx+1)),Math.max(yy-v,0,v-(yy+1)));distance=Math.min(distance,d);
 }return Math.min(1,distance/feather);
}
