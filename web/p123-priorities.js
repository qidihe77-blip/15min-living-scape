export const p123Default=ids=>{const defaults={education:1,medical:1,transport:1,commerce:2,leisure:2,eldercare:3};return{order:[...ids].sort((a,b)=>(defaults[a]??2)-(defaults[b]??2)),levels:Object.fromEntries(ids.map(id=>[id,defaults[id]??2]))};};
export function p123Weights(model,ids){
 if(!model||model.order.length!==ids.length||new Set(model.order).size!==ids.length||model.order.some(id=>!ids.includes(id))||ids.some(id=>![1,2,3].includes(model.levels[id])))throw TypeError('P1/P2/P3 membership required');
 return Object.fromEntries(ids.map(id=>[id,4-model.levels[id]]));
}
export function mountP123Priorities(container,{categories,model,onChange,renderIcon}){
 const ids=categories.map(g=>g.id);let current=model?.levels?structuredClone(model):p123Default(ids),dragging=null;
 const commit=(next,focus)=>{current=next;render();onChange(structuredClone(current),p123Weights(current,ids));container.querySelector('[data-priority-card="'+focus+'"]')?.focus();};
 const set=(id,level)=>{if(![1,2,3].includes(level))return;commit({...current,levels:{...current.levels,[id]:level}},id);};
 function render(){container.classList.add('p123-priorities');container.classList.remove('priority-horizontal');container.innerHTML=current.order.map(id=>{const g=categories.find(g=>g.id===id),rank=current.levels[id];return'<div class="priority-card" data-priority-card="'+id+'" data-tier="'+(rank-1)+'" draggable="true" tabindex="0" style="--priority-color:'+g.color+'" aria-label="'+g.label+' P'+rank+'，方向键调整优先级与排序" title="拖到卡片中部并列，上下边缘升降级；↑↓调整P级，←→排序"><label class="priority-rank"><select data-p123-level="'+id+'" aria-label="'+g.label+'优先级">'+[1,2,3].map(n=>'<option value="'+n+'"'+(rank===n?' selected':'')+'>P'+n+'</option>').join('')+'</select></label>'+renderIcon(g)+'<strong>'+g.label+'</strong><span class="p123-grip" aria-hidden="true">⠿</span></div>';}).join('');}
 container.onchange=e=>{if(e.target.matches('[data-p123-level]'))set(e.target.dataset.p123Level,Number(e.target.value));};
 container.ondragstart=e=>{const c=e.target.closest('[data-priority-card]');if(!c)return;dragging=c.dataset.priorityCard;e.dataTransfer.setData('text/plain',dragging);};
 container.ondragover=e=>{if(dragging&&e.target.closest('[data-priority-card]'))e.preventDefault();};
 container.ondrop=e=>{const c=e.target.closest('[data-priority-card]');if(!c||!dragging)return;e.preventDefault();const id=dragging,target=c.dataset.priorityCard;dragging=null;if(id===target)return;
  const r=c.getBoundingClientRect(),portion=(e.clientY-r.top)/r.height,level=current.levels[target]+(portion<.25?-1:portion>.75?1:0),order=current.order.filter(x=>x!==id);order.splice(order.indexOf(target),0,id);commit({order,levels:{...current.levels,[id]:Math.max(1,Math.min(3,level))}},id);};
 container.ondragend=()=>dragging=null;
 container.onkeydown=e=>{if(e.target.matches('select'))return;const c=e.target.closest('[data-priority-card]');if(!c)return;const id=c.dataset.priorityCard,i=current.order.indexOf(id);
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))e.preventDefault();if(e.key==='ArrowUp')set(id,Math.max(1,current.levels[id]-1));if(e.key==='ArrowDown')set(id,Math.min(3,current.levels[id]+1));
  if(e.key==='ArrowLeft'||e.key==='ArrowRight'){const j=i+(e.key==='ArrowLeft'?-1:1);if(j<0||j>=ids.length)return;const order=[...current.order];[order[i],order[j]]=[order[j],order[i]];commit({...current,order},id);}};
 render();return{getModel:()=>structuredClone(current)};
}
