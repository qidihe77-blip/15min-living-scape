import{buildServiceGapSummary}from'./service-gap-summary.js?v=a86';
import{facilityGlyph}from'./poi-icons.js';
import{TYPE}from'./report-typography.js';
import{gapStackShapes}from'./gap-stack-geometry.js';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const areaText=v=>!Number.isFinite(v)?'—':v>0&&v<1000?Number((v/1e6).toPrecision(3)).toString():(v/1e6).toFixed(3);
const percentText=v=>!Number.isFinite(v)?'—':v>0&&v<.001?Number((v*100).toPrecision(2)).toString():(v*100).toFixed(1);
const check='<svg class="gap-stack-check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4 10-11"/></svg>';
const grayPairs=[['#E7EBEF','#BCC6D0'],['#E1E7ED','#B3BFCC'],['#DAE2EA','#ABB8C6']];
let chartSequence=0;

// Do not turn incomplete evidence into a third visible result or false coverage.
export function serviceGapCardState(model){
 if(!(model.determinateArea>0)||!Number.isFinite(model.determinateGapArea)||!Number.isFinite(model.determinateRatio))return null;
 return model.determinateGapArea<1e-5?'covered':'available';
}
export function renderServiceGapReport(node,job,rows,tree,models){
 node.gapStackCleanup?.();
 const model=buildServiceGapSummary(job,rows,tree,models),cardState=serviceGapCardState(model),section=node.closest('.service-gap-report-section');
 window.lifeCircleServiceGapSummary={...model,chartType:'rounded_stacked_bar',segments:[]};
 if(section)section.hidden=!cardState;
 node.hidden=!cardState;node.innerHTML='';delete node.dataset.status;
 if(!cardState)return model;
 const valid=true,area=model.determinateGapArea,ratio=model.determinateRatio,covered=cardState==='covered',segments=[{kind:'covered',area:model.determinateArea-area,fraction:1-ratio,label:'非盲区'},...model.determinateCombinations.map(c=>({...c,kind:'gap',fraction:c.area/model.determinateArea,label:c.labels.join('＋')}))].filter(s=>s.area>1e-5);
 node.dataset.status=cardState;
 node.innerHTML='<dl class="gap-stack-metrics"><div><dt>盲区面积占比</dt><dd>'+percentText(ratio)+(valid?'<small>%</small>':'')+'</dd></div><div><dt>盲区面积</dt><dd>'+areaText(area)+(valid?'<small>km²</small>':'')+'</dd></div><div><dt>等时圈总面积</dt><dd>'+areaText(model.totalArea)+'<small>km²</small></dd></div></dl>'
 +'<div class="gap-stack-strip'+(covered?' is-covered':'')+'" role="group" aria-label="15分钟生活圈可判定面积100%"><svg class="gap-stack-surface" aria-hidden="true" preserveAspectRatio="none"></svg>'+segments.map((s,i)=>{const groupId=s.categoryIds?.[0],icon=s.kind==='covered'?check:s.compound?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 10 6-10 6L2 8Z M2 13l10 6 10-6 M2 18l10 6 10-6"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true">'+facilityGlyph(groupId)+'</svg>',label=covered?'无盲区':s.label;
  return'<div class="gap-stack-segment '+(s.kind==='covered'?'is-covered':'is-gap')+(s.compound?' is-compound':'')+'" data-gap-segment="'+i+'" style="width:'+(s.fraction*100)+'%" role="img" aria-label="'+esc(label+'，'+percentText(s.fraction)+'%，'+areaText(s.area)+'平方公里')+'"><span class="gap-stack-segment-copy">'+icon+'<span>'+esc(label)+'</span>'+(covered?'':'<b>'+percentText(s.fraction)+'%</b>')+'</span></div>';
 }).join('')+'</div>'
 +'<div class="gap-stack-legend" aria-label="服务盲区图例"><span><i class="is-covered"></i>非盲区</span><span><i class="is-gap"></i>盲区</span></div>';
 const chartId='gap-stack-'+(++chartSequence),strip=node.querySelector('.gap-stack-strip'),surface=node.querySelector('.gap-stack-surface');
 const measure=document.createElement('canvas').getContext('2d');
 function fit(){const w=strip.clientWidth,h=strip.clientHeight,shapes=gapStackShapes(segments.map(s=>s.fraction),w,h);surface.setAttribute('viewBox',`0 0 ${w||1} ${h||1}`);
  surface.innerHTML='<defs>'+segments.map((s,i)=>{const colors=s.kind==='covered'?['#E4F7C9','#B8E89B','#8CCD79']:s.compound?['#DFE6ED','#C8D2DC','#AAB8C6']:[grayPairs[i%grayPairs.length][0],grayPairs[i%grayPairs.length][0],grayPairs[i%grayPairs.length][1]];return'<radialGradient id="'+chartId+'-'+i+'" cx="30%" cy="0%" r="110%"><stop stop-color="'+colors[0]+'"/><stop offset=".48" stop-color="'+colors[1]+'"/><stop offset="1" stop-color="'+colors[2]+'"/></radialGradient>';}).join('')+'</defs>'+shapes.map((s,i)=>'<path d="'+s.path+'" fill="url(#'+chartId+'-'+i+')"/>').join('')+shapes.slice(0,-1).map(s=>'<path d="M'+(s.right.x-s.right.bend)+' 0Q'+(s.right.x+2*s.right.bend)+' '+h/2+' '+(s.right.x-s.right.bend)+' '+h+'" fill="none" stroke="#FFFFFFA0" stroke-width="1"/>').join('');
  if(!measure)return;measure.font=TYPE.bodyWeight+' '+TYPE.body+'px '+TYPE.family;for(const el of node.querySelectorAll('[data-gap-segment]')){const s=segments[Number(el.dataset.gapSegment)],copy=el.querySelector('.gap-stack-segment-copy'),label=covered?'无盲区':s.label,need=measure.measureText(label).width+(covered?0:measure.measureText(percentText(s.fraction)+'%').width)+20+12+(covered?0:6)+16;copy.hidden=el.clientWidth<need;}}
 const observer=new ResizeObserver(fit);observer.observe(node);fit();document.fonts.ready.then(()=>{if(node.isConnected)fit();});
 // Only missing-service segments have a tooltip. Composite entries keep the
 // mutually exclusive area fraction; each constituent also has its own total.
 const tip=document.createElement('div');tip.className='gap-stack-tooltip';tip.role='tooltip';tip.hidden=true;node.append(tip);
 for(const el of node.querySelectorAll('.is-gap[data-gap-segment]')){
  const s=segments[Number(el.dataset.gapSegment)];el.tabIndex=0;
  const show=()=>{const ids=s.categoryIds??[],lines=ids.map((id,i)=>{const fraction=segments.filter(x=>x.kind==='gap'&&x.categoryIds?.includes(id)).reduce((n,x)=>n+x.fraction,0);return'<div><span>'+esc(s.labels?.[i]??s.label)+'</span><b>'+percentText(fraction)+'%</b></div>';});tip.innerHTML=lines.join('');tip.hidden=false;const b=el.getBoundingClientRect(),p=node.getBoundingClientRect(),scale=p.width/node.clientWidth||1;tip.style.left=Math.max(4,Math.min(node.clientWidth-tip.offsetWidth-4,(b.left-p.left+b.width/2)/scale-tip.offsetWidth/2))+'px';const above=(b.top-p.top)/scale-tip.offsetHeight-6;tip.style.top=(above>=0?above:Math.max(0,Math.min(node.clientHeight-tip.offsetHeight,(b.bottom-p.top)/scale+6)))+'px';};
  el.addEventListener('pointerenter',show);el.addEventListener('focus',show);el.addEventListener('pointerleave',()=>{tip.hidden=true;});el.addEventListener('blur',()=>{tip.hidden=true;});
 }
 node.gapStackCleanup=()=>{observer.disconnect();tip.remove();};
 window.lifeCircleServiceGapSummary={...model,chartType:'rounded_stacked_bar',displayArea:area,displayRatio:ratio,segments:segments.map(s=>({kind:s.kind,categoryIds:s.categoryIds??[],area:s.area,fraction:s.fraction,compound:s.compound??false}))};return model;
}
