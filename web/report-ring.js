import{specialtyDiagnostics}from'./specialty-diagnostics.js?v=a31-20261012';
import{LIGHT_TOOLTIP,scoreGrade}from'./report-theme.js';
const fmt=v=>Number.isFinite(v)?Number(v.toFixed(1)).toString():'—';
export function scoreRingLayout(width=200,height=width){
 const diameter=Math.max(1,Math.min(width,height)),radius=diameter*.435,stroke=Math.min(19,diameter*.08),innerDiameter=2*(radius-stroke);
 return{radius,stroke,innerDiameter,font:Math.min(34,innerDiameter*.25),unit:Math.min(11,innerDiameter*.075)};
}
export function ringScoreOption(m,{reduced=false,width=200,height=width}={}){
 const scored=m.view.overall.scored,score=scored?m.confirmedScore:0,{stroke,font,unit}=scoreRingLayout(width,height);
 return{animation:!reduced,animationDurationUpdate:650,tooltip:{...LIGHT_TOOLTIP,formatter:()=>'<b>综合匹配度 '+(scored?fmt(score):'—')+' /100</b><br>100 × Σ（确认可达小类比例 × 归一化优先级权重）<br>'+m.view.groups.map(g=>g.label+' '+g.reachable+'/'+g.subtypes.length+' · 权重'+fmt(g.score.normalizedWeight*100)+'% · 贡献'+fmt(g.score.contributionLow)+'分').join('<br>')+'<br><small>未知不计分，仍计入分母。等级为项目内部评价标准。</small>'},series:[{type:'gauge',startAngle:90,endAngle:-270,min:0,max:100,center:['50%','50%'],radius:'87%',pointer:{show:false},anchor:{show:false},axisTick:{show:false},splitLine:{show:false},axisLabel:{show:false},axisLine:{lineStyle:{width:stroke,color:[[1,'#E8F0F5']]}},progress:{show:true,roundCap:true,width:stroke},itemStyle:{color:{type:'linear',x:0,y:0,x2:1,y2:1,colorStops:[{offset:0,color:'#51C5BA'},{offset:1,color:'#369DC4'}]}},detail:{show:true,valueAnimation:!reduced,fontSize:font,fontWeight:700,color:'#284F66',offsetCenter:[0,0],formatter:v=>scored?'{score|'+fmt(v)+'}{unit| /100}':'{score|—}',rich:{score:{fontSize:font,fontWeight:700,color:'#284F66'},unit:{fontSize:unit,color:'#8AA2B2',padding:[10,0,0,2]}}},data:[{value:score}]}]};
}
export function scoreSummary(m,job,tree){const special=tree?specialtyDiagnostics(job,tree):[],specialtyCompleteness=special.length?special.filter(s=>s.status==='present').length/special.length*100:0;const grade=m.view.overall.scored?scoreGrade(m.confirmedScore):null;return{grade,specialtyCompleteness,community:job.analysis?.analysisLocation?.name??job.analysis?.origin?.name??'当前分析地点',reachablePoi:m.totalPoi,coverage:m.view.counts.total?m.view.counts.reachable/m.view.counts.total*100:0};}
