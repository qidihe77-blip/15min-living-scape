import{roadMeters,makeRoadTimeGraph,closestNode,boundedGraphDistances}from'./road-time-graph.js';import{decisionSeconds}from'./walking-model.js';import{walkingRangePolygons,insideWalkingRange}from'./circle-presentation.js';import{routeLines}from'./walking-network.js';import{surfaceColor}from'./walking-time-palette.js';import{TIME_FIELD_REASONS,timeFieldReasonId,timeFieldTopology}from'./time-field-diagnostics.js';
export const DIRECTIONAL_FIELD_VERSION='direction-internal-time-grid-61-v2';
const spatialCache=new WeakMap();
const same=(a,b)=>a&&b&&[a.lng,a.lat,b.lng,b.lat].every(Number.isFinite)&&Math.abs(a.lng-b.lng)<1e-6&&Math.abs(a.lat-b.lat)<1e-6;
export function boundTimeObservation(r,origin){return r?.routeStatus==='ok'&&r.mode==='walking'&&r.coordinateSystem==='BD-09LL'&&decisionSeconds(r)!==null&&same(r.requestedOrigin?.location??r.origin?.location,origin.location)&&(r.requestedOrigin?.uid??r.originUid??r.origin?.uid??null)===(origin.uid??null)&&r.distanceMeters>30&&r.requestedDestination?.location;}
const median=a=>{const b=[...a].sort((x,y)=>x-y);return b.length%2?b[(b.length-1)/2]:(b[b.length/2-1]+b[b.length/2])/2;};
const span=a=>{const b=a.sort((a,b)=>a-b);let gap=2*Math.PI+b[0]-b.at(-1);for(let i=1;i<b.length;i++)gap=Math.max(gap,b[i]-b[i-1]);return 2*Math.PI-gap;};
export function prepareDirectionalField(job,rows=[]){
 const origin=job.analysis?.origin;if(!origin)return null;const mx=111320*Math.cos(origin.location.lat*Math.PI/180),my=111320,xy=p=>[(p.lng-origin.location.lng)*mx,(p.lat-origin.location.lat)*my],groups=Array.from({length:36},()=>[]),anchors=[],seen=new Set();
 const add=(r,p,source)=>{if(!boundTimeObservation(r,origin)||!p)return;const d=roadMeters([origin.location.lng,origin.location.lat],[p.lng,p.lat]);if(d<30||r.distanceMeters+30<d)return;const key=p.lng.toFixed(6)+','+p.lat.toFixed(6);if(seen.has(key))return;seen.add(key);const [x,y]=xy(p);anchors.push({x,y,location:p,seconds:decisionSeconds(r),factor:r.distanceMeters/d,evidenceId:r.evidenceId,source});};
 const directions=job.timeField?.directionSamples?.length?job.timeField.directionSamples:job.heatSamples??job.rangeSamples??[];
 for(const r of directions){if(!boundTimeObservation(r,origin))continue;const p=r.requestedDestination.location,[x,y]=xy(p),bearing=(Math.atan2(x,y)*180/Math.PI+360)%360,sector=Math.round(bearing/10)%36,d=roadMeters([origin.location.lng,origin.location.lat],[p.lng,p.lat]);if(d<60||r.distanceMeters+30<d)continue;groups[sector].push({factor:r.distanceMeters/d,radius:d,seconds:decisionSeconds(r),evidenceId:r.evidenceId});add(r,p,'direction_cost');}
 const raw=groups.map(a=>a.length?median(a.map(p=>p.factor)):null),directionsModel=groups.map((a,i)=>{if(!a.length)return null;const f=raw[i],left=raw[(i+35)%36],right=raw[(i+1)%36],variance=(Math.max(...a.map(p=>p.factor))-Math.min(...a.map(p=>p.factor)))/f,angularVariance=left&&right?(Math.max(f,left,right)-Math.min(f,left,right))/f:Infinity,stable=variance<=.35&&angularVariance<=.45;
  return{factor:stable?(left+f+right)/3:f,rawFactor:f,measuredRadius:Math.max(...a.map(p=>p.radius)),stableRadius:stable?Math.max(...a.map(p=>p.radius)):Math.min(...a.map(p=>p.radius)),stable,variance,angularVariance,actualSamples:a.length};});
 for(const r of [...(job.timeField?.samples??[]),...(job.timeField?.geometrySamples??[])]){if(r.source!=='route_matrix')add(r,r.navigationEndpoint??r.requestedDestination?.location,'internal_walking');}
 for(const row of rows){const r=row.routeEvidence;if(r){const normalized={...r,requestedOrigin:r.requestedOrigin??r.origin,requestedDestination:r.requestedDestination??{location:row.location,uid:row.uid}},lines=routeLines(r.geometry),nav=lines.length===1?lines[0].at(-1):null;if(nav)add(normalized,{lng:nav[0],lat:nav[1]},'facility_walking_cost');}}
 // Geometry supplies additional model support along a genuine route, never synthetic rays.
 const geometries=[...new Map([...directions,...(job.timeField?.geometrySamples??[]),...(job.timeField?.samples??[]),...rows.map(p=>p.routeEvidence)].filter(Boolean).map(r=>[r.evidenceId??JSON.stringify([r.requestedDestination,r.distanceMeters,r.geometry]),r])).values()];
 for(const original of geometries){const r={...original,requestedOrigin:original.requestedOrigin??original.origin};if(!boundTimeObservation(r,origin))continue;const lines=routeLines(r.geometry);if(lines.length!==1||roadMeters(lines[0][0],[origin.location.lng,origin.location.lat])>15)continue;const line=lines[0],lengths=line.map((p,i)=>i?roadMeters(line[i-1],p):0),total=lengths.reduce((n,d)=>n+d,0);if(!total||r.distanceMeters/total<.75||r.distanceMeters/total>1.35)continue;let cumulative=0,last=-40,lastBase=-80;
  for(let i=0;i<line.length;i++){cumulative+=lengths[i];const base=cumulative-lastBase>=80;if(!base&&cumulative-last<40)continue;last=cumulative;if(base)lastBase=cumulative;const seconds=decisionSeconds(r)*cumulative/total;if(seconds>900)break;const p={lng:line[i][0],lat:line[i][1]},[x,y]=xy(p),d=roadMeters([origin.location.lng,origin.location.lat],line[i]);if(d<30)continue;anchors.push({x,y,location:p,seconds,factor:seconds*80/60/d,evidenceId:r.evidenceId,source:'verified_path_model',derived:true,denseSupportOnly:!base});}}
 // An actual endpoint cost takes precedence over a model-derived prefix at the
 // same physical node; within each kind retain earliest arrival, never later loops.
 const rank=a=>!a.derived?0:a.denseSupportOnly?2:1,minimum=new Map();for(const a of anchors){const k=a.location.lng.toFixed(6)+','+a.location.lat.toFixed(6),old=minimum.get(k);if(!old||rank(a)<rank(old)||rank(a)===rank(old)&&a.seconds<old.seconds)minimum.set(k,a);}
 const roadGraph=makeRoadTimeGraph(geometries.map((r,i)=>{const lines=routeLines(r.geometry),nav=lines.length===1?lines[0].at(-1):null;return{uid:null,identityKey:'heat-path:'+i,routeEvidence:{...r,origin:r.requestedOrigin??r.origin,actualNavigationEndpoint:nav?{lng:nav[0],lat:nav[1]}:null}};}),origin),observations=[...minimum.values()];
 for(const a of observations)a.roadNode=closestNode(roadGraph.nodes,[a.location.lng,a.location.lat],15);
 return{origin,mx,my,xy,directions:directionsModel,anchors:observations,roadGraph,roadDistances:new Map(),validDirections:raw.filter(Number.isFinite).length,actualDirectionSamples:groups.reduce((n,a)=>n+a.length,0)};
}
// A short observed road connection is positive support. A long path in this
// incomplete route tree is not by itself proof of a wall. Only interpolate
// within a containing, small triangle with three independently located costs
// and observed short connections on all three edges.
function connectedLocalEstimate(model,x,y,near){
 const supported=near.filter(p=>p.roadNode!=null&&p.d<=220),selected=new Set(supported.slice(0,20)),sectors=Array.from({length:8},()=>[]);
 // A dense cluster on one side must not crowd out a closer-than-220m witness
 // on the other side. Keep three actual candidates per octant as well.
 for(const p of supported){const sector=Math.floor((Math.atan2(p.y-y,p.x-x)+Math.PI)*4/Math.PI)%8;if(sectors[sector].length<3){sectors[sector].push(p);selected.add(p);}}
 const local=[...selected].sort((a,b)=>a.d-b.d);
 const connected=(p,q)=>{const direct=Math.hypot(p.x-q.x,p.y-q.y);if(direct<8||direct>260)return false;
  if(!model.roadDistances.has(p.roadNode))model.roadDistances.set(p.roadNode,boundedGraphDistances(model.roadGraph,p.roadNode,1500));
  const walking=model.roadDistances.get(p.roadNode).get(q.roadNode);
  return Number.isFinite(walking)&&walking<=direct*2.2+40&&Math.abs(p.seconds-q.seconds)<=walking*.75+45;
 };
 let best=null;
 for(let i=0;i<local.length;i++)for(let j=i+1;j<local.length;j++){
  const a=local[i],b=local[j];if(!connected(a,b))continue;
  for(let k=j+1;k<local.length;k++){
   const c=local[k];if(best&&c.d>best.scale)break;const area=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y),edgeSquared=Math.max((a.x-b.x)**2+(a.y-b.y)**2,(a.x-c.x)**2+(a.y-c.y)**2,(b.x-c.x)**2+(b.y-c.y)**2);if(Math.abs(area)<100||Math.abs(area)/edgeSquared<.08)continue;
   const u=((b.y-c.y)*(x-c.x)+(c.x-b.x)*(y-c.y))/area,v=((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/area,w=1-u-v;
   if(Math.min(u,v,w)<-1e-7||new Set([a.evidenceId,b.evidenceId,c.evidenceId]).size<2||!connected(a,c)||!connected(b,c))continue;
   const scale=Math.max(a.d,b.d,c.d),seconds=u*a.seconds+v*b.seconds+w*c.seconds;
   if(!best||scale<best.scale)best={seconds,scale,support:3,confidence:'observed_connected_triangle',evidenceIds:[a.evidenceId,b.evidenceId,c.evidenceId]};
  }
 }
 return best;
}
export function estimateDirectionalTime(model,x,y,{supportMeters=400}={}){
 const radius=Math.hypot(x,y);if(radius<1e-6)return{seconds:0,confidence:'walking_origin',support:1};
 const bearing=(Math.atan2(x,y)*180/Math.PI+360)%360,u=bearing/10,i=Math.floor(u)%36,j=(i+1)%36,w=u-Math.floor(u),a=model.directions[i],b=model.directions[j];if(!a||!b)return{seconds:null,reasonCode:'unverified_direction'};
 const outsideRadial=radius>Math.min(a.stableRadius,b.stableRadius);
 let index=spatialCache.get(model);if(!index||index.source!==model.anchors||index.count!==model.anchors.length){const buckets=new Map();for(const p of model.anchors){const key=Math.floor(p.x/200)+','+Math.floor(p.y/200);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(p);}index={source:model.anchors,count:model.anchors.length,buckets};spatialCache.set(model,index);}
 const candidates=[],bx=Math.floor(x/200),by=Math.floor(y/200),reach=Math.ceil(supportMeters/200);for(let dy=-reach;dy<=reach;dy++)for(let dx=-reach;dx<=reach;dx++)candidates.push(...index.buckets.get((bx+dx)+','+(by+dy))??[]);
 const baseFactor=a.factor*(1-w)+b.factor*w,near=candidates.map(p=>({...p,d:Math.hypot(p.x-x,p.y-y)})).filter(p=>p.d<=supportMeters).sort((a,b)=>a.d-b.d),local=near.filter(p=>!p.denseSupportOnly).slice(0,16);
 const recover=reasonCode=>{const estimate=connectedLocalEstimate(model,x,y,near);return estimate?{...estimate,recoveredFrom:reasonCode}:{seconds:null,reasonCode};};
 if(outsideRadial)return recover('outside_measured_radial_support');
 if(local.length<3||span(local.map(p=>Math.atan2(p.y-y,p.x-x)))<Math.PI/3)return{seconds:null,reasonCode:'insufficient_spatial_support'};
 // Large, abrupt measured cost differences are treated as uncertain barrier corridors.
 const measured=near.filter(p=>!p.derived).slice(0,8);let detourSupport=0;for(let i=0;i<measured.length;i++)for(let j=i+1;j<measured.length;j++){const p=measured[i],q=measured[j],d=Math.hypot(p.x-q.x,p.y-q.y);if(d<30||d>250)continue;let networkUncertain=false;if(p.roadNode!=null&&q.roadNode!=null&&model.roadGraph?.nodes.length){if(!model.roadDistances.has(p.roadNode))model.roadDistances.set(p.roadNode,boundedGraphDistances(model.roadGraph,p.roadNode,1500));const knownDistance=model.roadDistances.get(p.roadNode).get(q.roadNode);networkUncertain=Number.isFinite(knownDistance)&&knownDistance>d*2.2+100;}
  const costJump=Math.abs(p.seconds-q.seconds)>d*.75*2+45;if(!costJump&&!networkUncertain)continue;const midpoint=[(p.x+q.x)/2,(p.y+q.y)/2],along=((x-midpoint[0])*(q.x-p.x)+(y-midpoint[1])*(q.y-p.y))/d,across=((x-midpoint[0])*(p.y-q.y)+(y-midpoint[1])*(q.x-p.x))/d;if(Math.abs(along)<d*.2&&Math.abs(across)<d*.65){if(costJump)return recover('measured_cost_discontinuity');detourSupport++;}}
 // A sparse path tree alone is not a complete road graph. Require corroboration
 // from two measured neighbour pairs before marking a possible detour barrier.
 if(detourSupport>=2)return recover('unverified_local_network_connection');
 let sum=0,weight=0;for(const p of local){const v=1/(p.d*p.d+3600),angle=(Math.atan2(p.x,p.y)*180/Math.PI+360)%360,k=Math.floor(angle/10)%36,l=(k+1)%36,c=model.directions[k],d=model.directions[l];if(!c||!d)continue;const f=c.factor*(1-angle/10%1)+d.factor*(angle/10%1);sum+=(p.factor-f)*v;weight+=v;}
 const residual=weight?sum/weight:0,factor=baseFactor+residual,variation=Math.max(...local.map(p=>p.factor))-Math.min(...local.map(p=>p.factor));if(!Number.isFinite(factor)||factor<.9)return{seconds:null,reasonCode:'invalid_local_factor'};
 if(variation>1.5&&local.filter(p=>!p.derived).length<3)return{seconds:null,reasonCode:'unstable_spatial_estimate'};
 return{seconds:radius*factor*.75,confidence:'real_direction_with_local_walking_correction',support:local.length};
}
export function buildDirectionalTimeField(job,rows,category='all',{size=61,opacity=.45}={}){
 const start=performance.now(),model=prepareDirectionalField(job,rows),polygons=walkingRangePolygons(job);if(!model||model.validDirections<3||!polygons.length)return{status:'unavailable',reasonCode:'insufficient_real_direction_samples'};
 const radius=Math.max(...model.directions.filter(Boolean).map(d=>Math.min(1200/d.factor,d.measuredRadius))),extent=radius*2*1.05,step=extent/size,values=new Float32Array(size*size),pixels=new Uint8ClampedArray(size*size*4),mask=new Uint8Array(size*size),confidence=new Uint8Array(size*size),insideMask=new Uint8Array(size*size),reasonMask=new Uint8Array(size*size),reasons=Object.fromEntries(TIME_FIELD_REASONS.map(k=>[k,0])),recoveries={};values.fill(NaN);let insideCells=0,supportedCells=0;
 const bounds={west:model.origin.location.lng-extent/2/model.mx,east:model.origin.location.lng+extent/2/model.mx,north:model.origin.location.lat+extent/2/model.my,south:model.origin.location.lat-extent/2/model.my};
 for(let row=0;row<size;row++)for(let col=0;col<size;col++){const x=(col+.5-size/2)*step,y=(size/2-row-.5)*step,p={lng:model.origin.location.lng+x/model.mx,lat:model.origin.location.lat+y/model.my},index=row*size+col;if(!insideWalkingRange(p,polygons)){reasons.outside_sampled_range++;reasonMask[index]=timeFieldReasonId('outside_sampled_range');continue;}insideCells++;insideMask[index]=1;const e=estimateDirectionalTime(model,x,y);if(e.seconds===null){reasons[e.reasonCode]=(reasons[e.reasonCode]??0)+1;reasonMask[index]=timeFieldReasonId(e.reasonCode);continue;}values[index]=e.seconds;confidence[index]=Math.min(255,e.support??0);if(e.seconds>900){reasons.over_15_minutes++;reasonMask[index]=timeFieldReasonId('over_15_minutes');continue;}mask[index]=1;supportedCells++;reasons.supported++;if(e.recoveredFrom)recoveries[e.recoveredFrom]=(recoveries[e.recoveredFrom]??0)+1;}
 // Feather inward only. Pixels outside the measured support and 15 min mask remain 0.
 for(let row=0;row<size;row++)for(let col=0;col<size;col++){const i=row*size+col;if(!mask[i])continue;let distance=2;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const yy=row+dy,xx=col+dx;if(xx<0||yy<0||xx>=size||yy>=size||!mask[yy*size+xx])distance=Math.min(distance,Math.hypot(dx,dy));}const feather=Math.min(1,distance/1.5,Math.max(0,(900-values[i])/30)),rgb=surfaceColor(values[i]).match(/\d+/g).map(Number);pixels.set([...rgb,Math.round(255*opacity*feather)],i*4);}
 const topology=timeFieldTopology(mask,insideMask,size),sampleFailures={};for(const r of [...(job.timeField?.directionSamples??job.heatSamples??[]),...(job.timeField?.samples??[])])if(r.routeStatus!=='ok')sampleFailures[r.routeStatus??'missing_route']=(sampleFailures[r.routeStatus??'missing_route']??0)+1;
 return{status:supportedCells?'available':'unavailable',reasonCode:supportedCells?null:'insufficient_reliable_spatial_support',version:DIRECTIONAL_FIELD_VERSION,width:size,height:size,cellMeters:step,values,pixels,mask,confidence,bounds,category,estimated:true,opacity,source:'real_walking_detour_factors_with_internal_correction',validation:job.timeField?.validation??{status:'not_validated'},diagnostics:{insideMask,reasonMask,reasonNames:TIME_FIELD_REASONS,recoveries,sampleFailures,topology},coverage:{insideCells,supportedCells,coverageRatio:insideCells?supportedCells/insideCells:0,validDirections:model.validDirections,actualDirectionSamples:model.actualDirectionSamples,measuredCostAnchors:model.anchors.filter(a=>!a.derived).length,derivedPathAnchors:model.anchors.filter(a=>a.derived).length,internalSamples:job.timeField?.samples?.filter(s=>s.source!=='route_matrix'&&boundTimeObservation(s,model.origin)).length??0,reasonCounts:reasons,internalHoleCount:topology.internalHoleCount,internalHoleCells:topology.internalHoleCells,supportedComponentCount:topology.supportedComponentCount},computeMs:performance.now()-start,note:'路网步行时间估计：36方向真实绕行系数＋真实内部Walking成本修正；局部仅在已观察短路网连接的支撑三角形内恢复。方向缺失、未支持阻隔与超15分钟透明；未取得完整水域/围墙掩码，不能解释为逐格实测可达证据。'};
}
export function estimateFieldAt(field,location){const x=(location.lng-field.bounds.west)/(field.bounds.east-field.bounds.west)*field.width-.5,y=(field.bounds.north-location.lat)/(field.bounds.north-field.bounds.south)*field.height-.5;
 // Exact grid-centre coordinates round-trip through JSON/BD09 with floating error.
 // Do not require unknown neighbours whose interpolation weight would be zero.
 if(Math.abs(x-Math.round(x))<1e-5&&Math.abs(y-Math.round(y))<1e-5){const v=field.values[Math.round(y)*field.width+Math.round(x)];return Number.isFinite(v)?v:null;}
 const col=Math.floor(x),row=Math.floor(y);if(col<0||row<0||col>=field.width-1||row>=field.height-1)return null;const ids=[row*field.width+col,row*field.width+col+1,(row+1)*field.width+col,(row+1)*field.width+col+1],vs=ids.map(i=>field.values[i]);if(vs.some(v=>!Number.isFinite(v)))return null;const u=x-col,v=y-row;return vs[0]*(1-u)*(1-v)+vs[1]*u*(1-v)+vs[2]*(1-u)*v+vs[3]*u*v;}
