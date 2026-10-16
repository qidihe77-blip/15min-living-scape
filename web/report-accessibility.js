import{hasConfirmedFacilityMembership}from'./facility-membership.js';
import{chartTip}from'./report-view.js';import{decisionSeconds}from'./walking-model.js';
import{boundWalkingEvidence}from'./reachable-presentation.js';
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tipAttr=tip=>' data-chart-tip="'+escape(JSON.stringify(tip))+'"';
export function categoryCountsHtml(groups,icon){
 const max=Math.max(1,...groups.map(g=>g.circlePoiCount??0));
 return groups.map(g=>'<button type="button" class="category-count-row" data-count-category="'+g.id+'" style="--group-color:'+g.color+'"'+tipAttr(chartTip(g.label,[['确认可达设施数',g.circlePoiCount===null?'步行信息暂无':g.circlePoiCount+'处']],'按统一设施身份去重，以真实Walking核验15分钟可达；圈内位置本身不作可达证明。'))+'>'+icon(g)+'<strong>'+escape(g.label)+'</strong><span class="category-count-track"><i style="width:'+(g.circlePoiCount??0)/max*100+'%"></i></span><b>'+(g.circlePoiCount??'—')+'</b></button>').join('');
}
export function boundPoiScore(row,origin){
 const r=row.routeEvidence;
 if(!hasConfirmedFacilityMembership(row)||!boundWalkingEvidence(row,origin))return{seconds:null,score:null};
 const seconds=decisionSeconds(r);return{seconds,score:seconds===null?null:seconds<=900?5:0};
}
export function subtypeAccessHtml(groups,rows,origin,opened=new Set()){
 return groups.map(g=>'<div class="subtype-access-group" data-chart-group="'+g.id+'" style="--category-color:'+g.color+'"><h3>'+escape(g.label)+'</h3>'+g.subtypes.map(s=>{
  const score=s.status==='reachable'?5:s.status==='no_reachable_in_declared_search'?0:null,scoreText=score===null?'未知':score+' /5',found=rows.filter(p=>p.subtypeIds?.includes(s.id)&&boundPoiScore(p,origin).score===5);
  const tip=chartTip(s.label,[['可达性评分',scoreText],['状态',s.statusText],['圈内设施',found.length+'处']],'采用现有小类可达存在性：已有≤15分钟有效证据5分，完整未发现0分，证据不足为未知；不按设施数量加分。');
  return '<details class="subtype-access-row" data-subtype-detail="'+s.id+'"'+(opened.has(s.id)?' open':'')+'><summary><strong>'+escape(s.label)+'</strong><span class="subtype-access-bar" data-subtype-bar="'+s.id+'" data-status="'+s.status+'" style="--access-width:'+(score===null?0:score/5*100)+'%"'+tipAttr(tip)+'><i></i></span><b>'+scoreText+'</b><span class="subtype-chevron">›</span></summary><div class="subtype-poi-list"><table><thead><tr><th>设施名称</th><th>状态</th><th>步行时间</th><th>距离</th><th>可达分</th></tr></thead><tbody>'+(found.length?found.map(p=>{const access=boundPoiScore(p,origin);return'<tr><td><button type="button" data-subtype-poi="'+escape(p.identityKey)+'">'+escape(p.name)+'</button></td><td>'+escape(p.statusText??(access.score===5?'可达':access.score===0?'超过15分钟':'暂无步行数据'))+'</td><td>'+(access.seconds===null?'—':Number((access.seconds/60).toFixed(1))+'分钟')+'</td><td>'+p.routeEvidence.distanceMeters+'m</td><td>'+(access.score===null?'未知':access.score+' /5')+'</td></tr>';}).join(''):'<tr><td colspan="5">'+escape(s.statusText)+' · 本次圈内暂无已确认可达设施</td></tr>')+'</tbody></table></div></details>';
 }).join('')+'</div>').join('');
}
export function roundedScoreRing(low,high){
 const perimeter=2*Math.PI*41,arc=n=>Math.max(0,Math.min(100,n))/100*perimeter;
 return'<svg class="rounded-score-svg" viewBox="0 0 100 100" aria-hidden="true"><circle class="score-track" cx="50" cy="50" r="41"/><circle class="score-possible" cx="50" cy="50" r="41" stroke-dasharray="'+arc(high)+' '+perimeter+'"/><circle class="score-arc" cx="50" cy="50" r="41" stroke-dasharray="'+arc(low)+' '+perimeter+'"/></svg>';
}
