export function visualMapCenter({width,height,margins=[0,0,0,0]}){
 const[top,right,bottom,left]=margins;return{x:Math.max(0,Math.min(width,(left+width-right)/2)),y:Math.max(0,Math.min(height,(top+height-bottom)/2))};
}
export function createMapFocus({map,B,getMargins,onNotice=()=>{}}) {
 let frame=0,sequence=0,alive=true,last=null;
 const valid=p=>p&&Number.isFinite(p.lng)&&Number.isFinite(p.lat);
 function cancel(){sequence++;if(frame)cancelAnimationFrame(frame);frame=0;if(window.lifeCircleLayerFocus)window.lifeCircleLayerFocus={...window.lifeCircleLayerFocus,animating:false};}
 function move(view,target,{animate=true,maxZoom=18,onComplete=()=>{}}={},count=1){
  if(!valid(view?.center)||!Number.isFinite(view.zoom)){onNotice('暂无可聚焦的有效范围。');return false;}
  cancel();const token=sequence,center=map.getCenter(),zoom=map.getZoom(),toZoom=Math.min(maxZoom,view.zoom),duration=animate&&!matchMedia('(prefers-reduced-motion:reduce)').matches?650:0;
  const started=performance.now();let previous=-Infinity;last={target,points:count,center:{lng:view.center.lng,lat:view.center.lat},zoom:toZoom,duration,sequence:token};window.lifeCircleLayerFocus={...last,animating:true};
  if(Math.abs(center.lng-view.center.lng)<1e-7&&Math.abs(center.lat-view.center.lat)<1e-7&&Math.abs(zoom-toZoom)<1e-4){last={...last,duration:0};window.lifeCircleLayerFocus={...last,animating:false};onComplete();return true;}
  function step(now){if(!alive||token!==sequence)return;const ratio=duration?Math.min(1,(now-started)/duration):1,t=1-(1-ratio)**3;
   if(now-previous>=30||ratio===1){previous=now;map.setCenter(new B.Point(center.lng+(view.center.lng-center.lng)*t,center.lat+(view.center.lat-center.lat)*t),{noAnimation:true});map.setZoom(zoom+(toZoom-zoom)*t,{noAnimation:true});}
   window.lifeCircleLayerFocus={...last,animating:ratio<1};if(ratio<1)frame=requestAnimationFrame(step);else{frame=0;onComplete();}
  }
  if(duration)frame=requestAnimationFrame(step);else step(started);return true;
 }
 function focus(points,target,options={}){
  const unique=[...new Map((points??[]).filter(valid).map(p=>[p.lng+','+p.lat,p])).values()];
  if(!unique.length){onNotice('该图层暂无有效数据。');return false;}
  return move(map.getViewport(unique.map(p=>new B.Point(p.lng,p.lat)),{margins:getMargins()}),target,options,unique.length);
 }
 function focusPoint(location,target,options={}){
  if(!valid(location))return false;const host=map.getContainer(),p=map.pointToPixel(new B.Point(location.lng,location.lat)),desired=visualMapCenter({width:host.clientWidth,height:host.clientHeight,margins:getMargins()}),center=map.pixelToPoint(new B.Pixel(host.clientWidth/2+p.x-desired.x,host.clientHeight/2+p.y-desired.y)),zoom=map.getZoom();
  return move({center,zoom},target,{...options,maxZoom:zoom});
 }
 map.addEventListener('dragstart',cancel);
 return{focus,focusPoint,cancel,getLast:()=>last,destroy(){alive=false;cancel();map.removeEventListener('dragstart',cancel);}};
}
