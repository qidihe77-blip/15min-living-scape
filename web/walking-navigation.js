import{mapUiObstacles,placeMapLabel}from'./map-label-layout.js';
const glyphs={
 crosswalk:'<path d="m4 6 3-2m-1 6 4-3m-1 7 4-3m-1 7 4-3m-1 7 3-2M3 18 18 3M6 21 21 6"/>',
 overpass:'<path d="M2 19h4l2-9h8l2 9h4M7 13h10M9 10V6m6 4V6M3 19v-4m18 4v-4M9 6h6"/>',
 underpass:'<path d="M3 5h18M4 8v4h3v3h3v4h4v-4h3v-3h3V8M10 19v2m4-2v2"/>',
 street_crossing:'<circle cx="13" cy="4" r="2"/><path d="m10 8 5 1 3 4m-7-5-3 5H5m7-3-1 6-4 5m4-5 5 5"/>'
};
const colors={crosswalk:'#328ADD',overpass:'#8870CD',underpass:'#2AA0AF',street_crossing:'#CF9A42'};
export const WALKING_NODE_SIZE=36;
export function walkingNodeSvg(kind){return'<svg viewBox="0 0 24 24" aria-hidden="true">'+(glyphs[kind]??glyphs.street_crossing)+'</svg>';}
const intersects=(a,b)=>a.left<b.left+b.width+4&&a.left+a.width>b.left-4&&a.top<b.top+b.height+4&&a.top+a.height>b.top-4;
export function layoutWalkingNodes(nodes,{width,height,obstacles=[]}){
 const occupied=[...obstacles],result=[],size=WALKING_NODE_SIZE,half=size/2,offsets=[[0,0],[0,-44],[44,0],[-44,0],[0,44],[40,-40],[-40,-40],[40,40],[-40,40]];
 for(const n of nodes){if(!Number.isFinite(n.x)||!Number.isFinite(n.y)||n.x<0||n.y<0||n.x>width||n.y>height)continue;
  for(const[dx,dy]of offsets){const box={left:n.x+dx-half,top:n.y+dy-half,width:size,height:size};if(box.left<10||box.top<10||box.left+size>width-10||box.top+size>height-10||occupied.some(o=>intersects(box,o)))continue;occupied.push(box);result.push({...n,...box,dx,dy});break;}
 }return result;
}
export function createWalkingNavigationLayer({map,B,request,getObstacles=()=>[],onState=()=>{}}){
 const host=map.getContainer(),layer=document.createElement('div'),links=document.createElementNS('http://www.w3.org/2000/svg','svg'),buttons=document.createElement('div'),tip=document.createElement('div');
 layer.className='walking-nodes-layer';links.classList.add('walking-node-links');tip.className='walking-node-tip';tip.hidden=true;tip.setAttribute('role','status');layer.append(links,buttons,tip);host.parentElement.append(layer);
 let selection=null,nodes=[],status='idle',token=0,controller=null,frame=0,disposed=false,activeNode=null,placed=[],requestCount=0;const cache=new Map();
 const keyOf=(job,r)=>JSON.stringify([job.analysisId,r.identityKey,r.evidenceId,r.geometry]),publish=()=>onState({identityKey:selection?.route.identityKey??null,status,nodeCount:nodes.length,visibleNodeCount:placed.length,nodes,placements:placed.map(n=>({id:n.id,x:n.x,y:n.y,dx:n.dx,dy:n.dy})),requestCount});
 function hideTip(){tip.hidden=true;activeNode=null;}
 function draw(){frame=0;if(disposed)return;const w=host.clientWidth,h=host.clientHeight;layer.style.width=w+'px';layer.style.height=h+'px';const obstacles=[...mapUiObstacles(host),...getObstacles()];
  const popup=host.querySelector('.poi-info');if(popup){const b=host.getBoundingClientRect(),r=popup.getBoundingClientRect(),sx=w/b.width,sy=h/b.height;obstacles.push({left:(r.left-b.left)*sx,top:(r.top-b.top)*sy,width:r.width*sx,height:r.height*sy});}
  placed=layoutWalkingNodes(nodes.map(n=>({...n,...map.pointToPixel(new B.Point(n.location.lng,n.location.lat))})),{width:w,height:h,obstacles});links.setAttribute('viewBox',`0 0 ${w||1} ${h||1}`);links.replaceChildren();buttons.replaceChildren();
  for(const n of placed){if(n.dx||n.dy){const line=document.createElementNS(links.namespaceURI,'line');for(const[k,v]of Object.entries({x1:n.x,y1:n.y,x2:n.x+n.dx,y2:n.y+n.dy,stroke:colors[n.kind]}))line.setAttribute(k,v);links.append(line);}
   const button=document.createElement('button');button.type='button';button.className='walking-node';button.style.cssText=`left:${n.left}px;top:${n.top}px;--walking-node-size:${WALKING_NODE_SIZE}px;--walking-node-color:${colors[n.kind]??colors.crosswalk}`;button.dataset.nodeId=n.id;button.dataset.nodeKind=n.kind;button.setAttribute('aria-label',n.label);button.innerHTML=walkingNodeSvg(n.kind);button.addEventListener('pointerdown',e=>e.stopPropagation());button.onclick=e=>{e.stopPropagation();activeNode=activeNode===n.id?null:n.id;showTip();};buttons.append(button);
  }showTip();publish();
 }
 function showTip(){const n=placed.find(n=>n.id===activeNode);if(!n){tip.hidden=true;return;}tip.replaceChildren();const title=document.createElement('strong'),body=document.createElement('span');title.textContent=n.label;body.textContent=n.instruction;tip.append(title,body);tip.hidden=false;const box=placeMapLabel({anchor:{x:n.x+n.dx,y:n.y+n.dy},width:tip.offsetWidth,height:tip.offsetHeight,viewport:{width:host.clientWidth,height:host.clientHeight},obstacles:[...mapUiObstacles(host),...placed.map(p=>({left:p.left,top:p.top,width:WALKING_NODE_SIZE,height:WALKING_NODE_SIZE}))]});if(!box){tip.hidden=true;return;}tip.style.left=box.left+'px';tip.style.top=box.top+'px';}
 const schedule=()=>{if(!frame&&!disposed)frame=requestAnimationFrame(draw);};
 function clear(){token++;controller?.abort();controller=null;selection=null;nodes=[];placed=[];status='idle';hideTip();buttons.replaceChildren();links.replaceChildren();publish();}
 async function select(job,route){clear();if(!route?.identityKey)return;selection={jobId:job.analysisId,route,key:keyOf(job,route)};const current=token,key=selection.key;status='loading';publish();let result=cache.get(key);
  if(!result){controller=new AbortController();requestCount++;try{result=await request(job.analysisId,{identityKey:route.identityKey,evidenceId:route.evidenceId},controller.signal);cache.set(key,result);while(cache.size>64)cache.delete(cache.keys().next().value);}catch(error){if(current!==token)return;status='unavailable';publish();return;}}
  if(current!==token||disposed)return;nodes=result.status==='available'?(result.nodes??[]).filter(n=>glyphs[n.kind]&&[n.location?.lng,n.location?.lat].every(Number.isFinite)):[];status=result.status??'missing_steps';draw();
 }
 const events=['moving','moveend','zoomend','zooming','resize','heading_changed'];events.forEach(e=>map.addEventListener(e,schedule));const observer=new ResizeObserver(schedule);observer.observe(host);
 return{select,clear,identity:()=>selection?.route.identityKey??null,reconcile(jobId,routes){if(selection&&(selection.jobId!==jobId||!routes.some(r=>keyOf({analysisId:jobId},r)===selection.key)))clear();},refresh:schedule,destroy(){clear();disposed=true;cancelAnimationFrame(frame);observer.disconnect();events.forEach(e=>map.removeEventListener?.(e,schedule));layer.remove();}};
}
