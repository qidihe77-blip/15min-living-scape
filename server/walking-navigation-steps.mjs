export const WALKING_NAVIGATION_VERSION='walking-explicit-steps-v1';
const valid=p=>p&&p.lng!=null&&p.lat!=null&&Number.isFinite(Number(p.lng))&&Number.isFinite(Number(p.lat))&&Math.abs(Number(p.lng))<=180&&Math.abs(Number(p.lat))<=90;
const point=p=>valid(p)?{lng:Number(p.lng),lat:Number(p.lat)}:null;
const text=s=>typeof s==='string'?s.replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').trim().slice(0,500):'';
const meters=(a,b)=>Math.hypot((a.lng-b.lng)*Math.cos((a.lat+b.lat)*Math.PI/360)*111320,(a.lat-b.lat)*111320);
export function pointRouteDistance(p,geometry){
 const lines=geometry?.type==='LineString'?[geometry.coordinates]:geometry?.type==='MultiLineString'?geometry.coordinates:[];let best=Infinity;
 for(const line of lines??[])for(let i=1;i<(line?.length??0);i++){const a=line[i-1],b=line[i];if(!Array.isArray(a)||!Array.isArray(b)||a.length!==2||b.length!==2||![...a,...b].every(Number.isFinite))continue;const c=Math.cos(p.lat*Math.PI/180),ax=(a[0]-p.lng)*c*111320,ay=(a[1]-p.lat)*111320,bx=(b[0]-p.lng)*c*111320,by=(b[1]-p.lat)*111320,dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1)));best=Math.min(best,Math.hypot(ax+t*dx,ay+t*dy));}
 return best;
}
function feature(instruction){
 const cleaned=instruction.replace(/(?:天桥|地下通道)(?:路|街|大道|小学|社区|公司)[^,，。;；]*/g,'');
 const kinds=[['overpass','天桥',/(?:人行|过街)?天桥|人行过街桥/],['underpass','地下通道',/地下通道|人行地道|过街地道/],['crosswalk','人行横道',/人行横道|斑马线/],['street_crossing','过马路',/过马路|横穿马路/]];
 if(kinds.slice(0,3).filter(([, ,re])=>re.test(cleaned)).length>1)return null;
 for(const[kind,label,re]of kinds){const hit=re.exec(cleaned);if(!hit)continue;const prefix=cleaned.slice(Math.max(0,hit.index-8),hit.index);if(/不要|无需|不走|避开|不经|没有|未经过/.test(prefix))continue;return{kind,label,index:hit.index};}return null;
}
function pathEnd(step,end){if(typeof step.path!=='string')return null;const pairs=step.path.trim().replace(/;$/,'').split(';'),pair=pairs[end?pairs.length-1:0]?.split(',');return pair?.length===2&&pair.every(v=>v.trim())?point({lng:pair[0],lat:pair[1]}):null;}
export function parseWalkingNavigation(steps){
 const nodes=[],rejected=[];let instructionCount=0;
 if(!Array.isArray(steps)||!steps.length)return{version:WALKING_NAVIGATION_VERSION,status:'missing_steps',stepsPresent:false,instructionsPresent:false,nodes,rejected};
 steps.forEach((step,stepIndex)=>{
  const texts=[['stepOriginInstruction',step.stepOriginInstruction,'start'],['stepDestinationInstruction',step.stepDestinationInstruction,'end'],['instruction',step.instruction??step.instructions,null]];
  for(const[field,raw,fixed]of texts){const instruction=text(raw);if(!instruction)continue;instructionCount++;const f=feature(instruction);if(!f)continue;
   // An explicit end instruction or walking-before-crossing action is anchored
   // at the returned step end. Never infer a feature from a bend in the polyline.
   const end=fixed==='end'||fixed===null&&(/走\s*\d+\s*米[^。]*$/.test(instruction.slice(0,f.index))||/到达\s*$/.test(instruction.slice(0,f.index))),side=end?'end':'start';
   const location=point(end?(step.end_location??step.stepDestinationLocation):(step.start_location??step.stepOriginLocation))??pathEnd(step,end);
   if(!location){rejected.push({stepIndex,reason:'missing_step_coordinate',kind:f.kind});continue;}
   if(nodes.some(n=>n.kind===f.kind&&meters(n.location,location)<=8))continue;
   nodes.push({id:`${stepIndex}-${field}-${f.kind}`,kind:f.kind,label:f.label,instruction,location,stepIndex,coordinateSource:side+'_location_or_step_path_endpoint',instructionField:field,stepDistanceMeters:Number.isFinite(step.distance)&&step.distance>=0?step.distance:null,coordinateSystem:'BD-09LL',source:'baidu_walking_step'});
  }
 });
 return{version:WALKING_NAVIGATION_VERSION,status:instructionCount?(nodes.length?'available':'no_explicit_nodes'):'missing_instructions',stepsPresent:true,instructionsPresent:instructionCount>0,nodes,rejected};
}
export function navigationOnRoute(navigation,geometry,maxDistanceMeters=25){
 const accepted=[],rejected=[...(navigation.rejected??[])];for(const n of navigation.nodes??[]){const d=pointRouteDistance(n.location,geometry);if(d<=maxDistanceMeters)accepted.push({...n,routeOffsetMeters:Number(d.toFixed(2))});else rejected.push({stepIndex:n.stepIndex,kind:n.kind,reason:'different_route_geometry'});}
 return{...navigation,status:accepted.length?'available':navigation.nodes?.length?'route_mismatch':navigation.status,nodes:accepted,rejected};
}
