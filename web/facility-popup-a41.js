import{TYPE}from'./report-typography.js';
import{placeMapLabel,mapUiObstacles}from'./map-label-layout.js';
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const FACILITY_POPUP_TYPE=Object.freeze({title:14,summary:13,minWidth:0,padding:20});
export function facilityPopupMarkup({name='未命名设施',distance='暂无',time='暂无'}={}){
 return'<strong class="facility-popup-title">'+escape(name)+'</strong><span class="facility-popup-summary facility-popup-metrics"><span class="facility-popup-distance">'+escape(distance)+'</span> · <span class="facility-popup-duration">'+escape(time)+'</span></span>';
}
export function facilityPopupWidth({name='',summary=''},hostWidth){
 const ctx=document.createElement('canvas').getContext('2d'),measure=(s,size,weight=500)=>{ctx.font=weight+' '+size+'px '+TYPE.family;return ctx.measureText(s).width;},max=Math.min(480,Math.max(40,hostWidth-40)),min=Math.min(FACILITY_POPUP_TYPE.padding,max);
 return Math.ceil(Math.max(min,Math.min(max,Math.max(measure(name,FACILITY_POPUP_TYPE.title,600)+FACILITY_POPUP_TYPE.padding,measure(summary,FACILITY_POPUP_TYPE.summary,400)+FACILITY_POPUP_TYPE.padding))));
}
export function fitFacilityPopupText(node){
 const ctx=document.createElement('canvas').getContext('2d');if(!ctx)return;
 for(const[selector,size,weight,variable]of[['.facility-popup-title',FACILITY_POPUP_TYPE.title,600,'--facility-popup-title-size'],['.facility-popup-summary',FACILITY_POPUP_TYPE.summary,400,'--facility-popup-summary-size']]){
  const el=node.querySelector(selector);if(!el||!el.clientWidth)continue;ctx.font=weight+' '+size+'px '+TYPE.family;
  const text=el.textContent,extra=0,measured=ctx.measureText(text).width;
  const value=Math.min(size,size*Math.max(1,el.clientWidth-extra)/Math.max(1,measured))+'px';if(node.style.getPropertyValue(variable)!==value)node.style.setProperty(variable,value);
 }
}
export function popupWalkingMetrics(evidence,decisionSeconds){
  const distance=Number.isFinite(evidence?.distanceMeters)?(evidence.distanceMeters>=1000?Number((evidence.distanceMeters/1000).toFixed(2))+'公里':Math.round(evidence.distanceMeters)+'米'):'暂无',seconds=decisionSeconds(evidence);
  return{distance,time:Number.isFinite(seconds)?Number((seconds/60).toFixed(1))+'分钟':'暂无'};
}
export function compactWalkingText(evidence,decisionSeconds){
  const m=popupWalkingMetrics(evidence,decisionSeconds);return m.distance+' · '+m.time;
}
// Keep the native InfoWindow and its geographic anchor; replace only its chrome.
export function popupViewportShift(r,b,gap=12){return{x:r.left<b.left+gap?b.left+gap-r.left:r.right>b.right-gap?b.right-gap-r.right:0,y:r.top<b.top+gap?b.top+gap-r.top:r.bottom>b.bottom-gap?b.bottom-gap-r.bottom:0};}
export function facilityPopupPlacement({anchor,width,height,viewport,obstacles=[],softObstacles=[]}){
 const margin=12,gap=6,bounded={x:Math.max(margin,Math.min(viewport.width-margin,anchor.x)),y:Math.max(margin,Math.min(viewport.height-margin,anchor.y))};
 if(width>viewport.width-margin*2||height>viewport.height-margin*2)return null;
 const box=(x,y)=>({left:Math.max(margin,Math.min(viewport.width-width-margin,x)),top:Math.max(margin,Math.min(viewport.height-height-margin,y)),width,height});
 const preferred=[box(bounded.x-width/2,bounded.y-height-24),box(bounded.x+24,bounded.y-height/2),box(bounded.x-width-24,bounded.y-height/2),box(bounded.x-width/2,bounded.y+24)];
 const overlaps=(a,b)=>a.left<b.left+b.width+gap&&a.left+a.width>b.left-gap&&a.top<b.top+b.height+gap&&a.top+a.height>b.top-gap;
 const choose=items=>{const extra=placeMapLabel({anchor:bounded,width,height,viewport,obstacles:items,gap:margin}),candidates=[...preferred,...(extra?[extra]:[])].filter(c=>!items.some(o=>overlaps(c,o)));return candidates.sort((a,b)=>Math.hypot(a.left+width/2-bounded.x,a.top+height/2-bounded.y)-Math.hypot(b.left+width/2-bounded.x,b.top+height/2-bounded.y))[0]??null;};
 return choose([...obstacles,...softObstacles])??choose(obstacles);
}
export function compactFacilityPopup(infoWindow,node,{map,anchor,getObstacles=()=>[],onLayout=()=>{}}={}){
 let observer,root,frame=0,closed=true,dx=0,dy=0;
 const align=()=>{
  root=node.closest('.BMap_bubble_pop');if(!root)return;
  root.style.setProperty('transform','none','important');root.style.setProperty('--facility-popup-shift','0px');root.style.setProperty('--facility-popup-accent',node.style.getPropertyValue('--facility-accent'));fitFacilityPopupText(node);root.style.setProperty('width',node.offsetWidth+'px','important');root.style.setProperty('height',node.offsetHeight+'px','important');
  if(map&&anchor){const host=map.getContainer(),b=host.getBoundingClientRect(),r=root.getBoundingClientRect(),sx=host.clientWidth/b.width,sy=host.clientHeight/b.height,p=map.pointToPixel(anchor),base={x:(r.left-b.left)*sx-dx,y:(r.top-b.top)*sy-dy},obstacles=mapUiObstacles(host);obstacles.push({left:p.x-17,top:p.y-17,width:34,height:34});
   const softObstacles=getObstacles().filter(o=>Math.hypot(p.x-o.left-o.width/2,p.y-o.top-o.height/2)>.5),box=facilityPopupPlacement({anchor:p,width:root.offsetWidth,height:root.offsetHeight,viewport:{width:host.clientWidth,height:host.clientHeight},obstacles,softObstacles});
   if(box){dx=box.left-base.x;dy=box.top-base.y;root.style.setProperty('translate',dx+'px '+dy+'px','important');root.dataset.adaptivePlacement='true';}
  }onLayout();
 };
 const fit=()=>{frame=0;if(!closed)align();},schedule=()=>{if(!closed&&!frame)frame=requestAnimationFrame(fit);},events=['moving','moveend','zooming','zoomend','resize','heading_changed'];
 infoWindow.addEventListener('open',()=>{closed=false;dx=dy=0;root=node.closest('.BMap_bubble_pop');root?.style.setProperty('translate','0px 0px','important');align();schedule();if(root){observer=new ResizeObserver(schedule);observer.observe(root);}events.forEach(e=>map?.addEventListener(e,schedule));});
 infoWindow.addEventListener('close',()=>{closed=true;observer?.disconnect();if(frame)cancelAnimationFrame(frame);frame=0;events.forEach(e=>map?.removeEventListener?.(e,schedule));});
}
