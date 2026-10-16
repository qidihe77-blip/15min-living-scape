import{walkingRangePolygons,insideWalkingRange}from'./circle-presentation.js';
import{boundWalkingCost}from'./reachable-presentation.js';
import{decisionSeconds}from'./walking-model.js';

export const timeHeatWeight=seconds=>Number.isFinite(seconds)&&seconds>=0&&seconds<=900?Math.max(0,1-seconds/900):null;
const samePoint=(a,b)=>a&&b&&[a.lng,a.lat,b.lng,b.lat].every(Number.isFinite)&&Math.abs(a.lng-b.lng)<=1e-6&&Math.abs(a.lat-b.lat)<=1e-6;
export function walkingTimeHeatData(job,rows,category='all'){
 const polygons=walkingRangePolygons(job),origin=job?.analysis?.origin,byPoint=new Map();
 const add=(location,cost,kind,uid)=>{
  const seconds=decisionSeconds(cost),weight=timeHeatWeight(seconds);
  if(weight===null||!insideWalkingRange(location,polygons))return;
  const key=location.lng.toFixed(6)+','+location.lat.toFixed(6),previous=byPoint.get(key);
  if(previous&&previous.properties.walkTime<=seconds)return;
  byPoint.set(key,{geometry:{type:'Point',coordinates:[location.lng,location.lat]},properties:{count:weight*100,walkTime:seconds,evidenceId:cost.evidenceId??null,kind,uid:uid??null}});
 };
 if(category==='all')for(const s of job?.heatSamples??job?.rangeSamples??[]){
  const actual=s.requestedOrigin??s.origin,location=s.requestedDestination?.location??s.destination?.location??s.destination;
  if(s.mode!=='walking'||s.routeStatus!=='ok'||s.coordinateSystem!=='BD-09LL'||!samePoint(actual?.location??actual,origin?.location)||(actual?.uid??s.originUid??null)!==(origin?.uid??null)||!Number.isFinite(s.distanceMeters)||s.distanceMeters<=0||!Number.isFinite(s.durationSeconds)||s.durationSeconds<=0)continue;
  add(location,s,'range_sample');
 }
 for(const p of rows??[]){
  if(!boundWalkingCost(p,origin))continue;
  if(category!=='all'&&!p.memberships?.includes(category)&&!p.categoryIds?.includes(category))continue;
  add(p.location,p.routeEvidence,'facility',p.uid);
 }
 const data=[...byPoint.values()],renderData=data.filter(p=>p.properties.count>0);
 return{status:!polygons.length?'unavailable':renderData.length?'available':'unavailable',reasonCode:!polygons.length?'walking_range_unavailable':renderData.length?null:'valid_walking_costs_unavailable',category,source:'saved_bound_walking_costs',estimated:true,valuesFromRealCosts:true,timeBasis:job?.analysis?.walkingModelId??'baidu-duration-v1',max:100,polygons,data,renderData,pointCount:data.length,note:'权重=max(0,1−步行秒数/900)。沿用当前计时口径：walking80-v1为真实路线米数÷80得到的分钟，百度原始秒数单独保留。只使用起点绑定的有效成本；官方热力核平滑不是未测区域的真实路线证明。'};
}
let libraryPromise;
export function loadTimeHeatLibrary(){
 if(globalThis.mapvgl?.HeatmapLayer)return Promise.resolve(globalThis.mapvgl);
 if(!libraryPromise)libraryPromise=new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src='/vendor/mapvgl-beta188.min.js';script.async=true;
  script.onload=()=>globalThis.mapvgl?.HeatmapLayer?resolve(globalThis.mapvgl):reject(Error('mapvgl_heat_unavailable'));
  script.onerror=()=>reject(Error('mapvgl_load_failed'));document.head.append(script);
 });return libraryPromise;
}
export function createTimeHeatController(M,map,B,{documentRef=document,aggregation='maximum',opacity=.92,gradient,size=220}={}){
 const canvas=documentRef.createElement('canvas');canvas.className='walking-time-heat-canvas';canvas.setAttribute('aria-hidden','true');
 Object.assign(canvas.style,{position:'absolute',left:'0',top:'0',zIndex:'1',pointerEvents:'none'});map.getContainer().append(canvas);
 // Keep time intensity independent of nearby POI density: maximum weighted kernel,
 // instead of the SDK's additive density pass. The pinned vendor source is unchanged.
 class TimeHeatLayer extends M.HeatmapLayer{setGLState(options){const gl=this.gl,offline=gl&&options?.blendFunc?.[0]===gl.ONE&&options?.blendFunc?.[1]===gl.ONE;
  const max=gl?.MAX??gl?.getExtension?.('EXT_blend_minmax')?.MAX_EXT;super.setGLState(offline&&max?{...options,blendEquation:max}:options);}}
 const view=new M.View({map,canvas,antialias:true}),Layer=aggregation==='additive'?M.HeatmapLayer:TimeHeatLayer,layer=new Layer({max:100,min:0,size,unit:'m',height:0,opacity:1,minOpacity:0,maxOpacity:.85,...(gradient?{gradient}: {})});canvas.style.opacity=opacity;
 view.addLayer(layer);let model=null,foreground={},frame=0,destroyed=false;
 const clip=()=>{frame=0;if(destroyed||!model)return;let path='';
  for(const rings of model.polygons)for(const ring of rings){const p=ring.map(([lng,lat])=>map.pointToPixel(new B.Point(lng,lat)));if(!p.every(q=>Number.isFinite(q.x)&&Number.isFinite(q.y))){canvas.hidden=true;return;}
   path+=p.map((q,i)=>(i?'L':'M')+q.x.toFixed(1)+' '+q.y.toFixed(1)).join(' ')+'Z ';}
  canvas.style.clipPath=path?'path(evenodd, "'+path+'")':'none';
  const w=map.getContainer().clientWidth,h=map.getContainer().clientHeight,project=p=>map.pointToPixel(new B.Point(p.lng,p.lat));
  let holes=(foreground.rows??[]).map(p=>{const q=project(p.location);return Number.isFinite(q.x)&&Number.isFinite(q.y)?'<circle cx="'+q.x.toFixed(1)+'" cy="'+q.y.toFixed(1)+'" r="15" fill="black"/>':'';}).join('');
  // Knock out the actual waterdrop silhouette, not a large oval of bare basemap.
  // Dimensions and anchor match the42×52.5 origin marker in console.js.
  if(foreground.origin){const q=project(foreground.origin);holes+='<path d="M15 3a11 11 0 0 0-11 11c0 8 11 20 11 20s11-12 11-20A11 11 0 0 0 15 3Z" transform="translate('+(q.x-21).toFixed(1)+' '+(q.y-47.25).toFixed(1)+') scale(1.4 1.381579)" fill="black" stroke="black" stroke-width="1.5"/>';}
  for(const point of foreground.highlights??[]){const q=project(point);if(Number.isFinite(q.x)&&Number.isFinite(q.y))holes+='<circle cx="'+q.x.toFixed(1)+'" cy="'+q.y.toFixed(1)+'" r="20" fill="black"/>';}
  for(const route of foreground.routes??[]){const g=route.geometry,lines=g?.type==='LineString'?[g.coordinates]:g?.type==='MultiLineString'?g.coordinates:[];for(const line of lines){const points=line.map(([lng,lat])=>project({lng,lat}));if(!points.every(q=>Number.isFinite(q.x)&&Number.isFinite(q.y)))continue;holes+='<path d="'+points.map((q,i)=>(i?'L':'M')+q.x.toFixed(1)+' '+q.y.toFixed(1)).join(' ')+'" fill="none" stroke="black" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>';}}
  // Baidu renders some Marker/Polyline overlays into its basemap WebGL canvas.
  // Foreground knockout preserves their colours without replacing their hit targets or routes.
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'"><defs><mask id="foreground" maskUnits="userSpaceOnUse"><rect width="100%" height="100%" fill="white"/>'+holes+'</mask></defs><rect width="100%" height="100%" fill="white" mask="url(#foreground)"/></svg>';
  canvas.style.maskImage='url("data:image/svg+xml,'+encodeURIComponent(svg)+'")';canvas.style.maskSize='100% 100%';
 };
 const schedule=()=>{if(!destroyed&&!frame)frame=requestAnimationFrame(clip);};
 const events=['moving','moveend','zooming','zoomend','resize','heading_changed','tilt_changed'];for(const e of events)map.addEventListener(e,schedule);
 return{set(next,nextForeground={}){if(destroyed)return{status:'destroyed'};model=next;foreground=nextForeground;canvas.hidden=next.status!=='available';layer.show?.();layer.setOptions({max:next.max??100,size:next.size??size});layer.setData(next.renderData??[]);clip();window.lifeCirclePoiHeatCanvas=canvas;return{renderer:'mapvgl.HeatmapLayer',aggregation:aggregation==='additive'?'additive_weighted_poi':layer.gl?.MAX?'maximum_time_weight_kernel':'native_weighted_kernel',points:next.pointCount,opacity};},setForeground(next){if(destroyed)return;foreground=next;clip();},setOpacity(value){if(destroyed)return;opacity=Math.max(0,Math.min(1,value));canvas.style.opacity=opacity;},setTheme(){},dispose(){model=null;canvas.hidden=true;layer.hide?.();},destroy(){destroyed=true;model=null;foreground={};if(frame)cancelAnimationFrame(frame);frame=0;for(const e of events)map.removeEventListener?.(e,schedule);view.destroy();canvas.remove();},canvas,layer};
}
