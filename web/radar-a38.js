import {contributionRadarOption} from './report-charts-light.js';
import {TYPE,auxiliaryText,dataText,compactLegendText,radarCategoryText} from './report-typography.js';
import {iconImage} from './hierarchy-rose.js?v=a33-20261012';
const fmt=v=>Number.isFinite(v)?Number(v.toFixed(1)).toString():'—';
export function refinedRadarOption(m,width,height){
 const o=contributionRadarOption(m),r=Math.max(18,Math.min(width/2-50,height/2-68)),cy=height/2;
 o.textStyle={...dataText};o.radar={...o.radar,radius:r,center:[width/2,cy],splitNumber:4,axisName:{show:false},axisLine:{show:true,lineStyle:{color:'#D0D8E2',width:.8,opacity:.85}},splitLine:{show:true,lineStyle:{color:'#C9D2DD',width:.8,opacity:.9,type:'solid'}},splitArea:{show:true,areaStyle:{color:['#FAFCFE33','#F3F7FB33']}}};
 o.legend={show:false,top:0,right:0,orient:'vertical',textStyle:{...compactLegendText,color:'#355C83'},data:['期望权重','实际贡献占比']};
 const expected=o.series[0].data[0],actual=o.series[0].data[1];expected.name='期望权重';expected.lineStyle={color:'#3467F4',type:'dashed',width:2};expected.itemStyle={color:'#3467F4',borderColor:'#fff',borderWidth:1.8};expected.areaStyle={color:{type:'linear',x:0,y:0,x2:0,y2:1,colorStops:[{offset:0,color:'#76B3FF26'},{offset:1,color:'#A6CDFF08'}]},opacity:1};
 actual.lineStyle={color:'#06B5A5',type:'solid',width:2.5};actual.itemStyle={color:'#06B5A5',borderColor:'#fff',borderWidth:1.8};actual.areaStyle={color:{type:'linear',x:0,y:0,x2:0,y2:1,colorStops:[{offset:0,color:'#1FC9BA50'},{offset:1,color:'#54DCCE1C'}]},opacity:1};
 o.series[0].symbol='circle';o.series[0].symbolSize=7;o.animationDurationUpdate=650;return o;
}
export function radarAxisGraphics(m,c,max,width){
 const graphics=[];m.view.groups.forEach((g,i)=>{const p=c.dataToPoint(max,i),dx=p[0]-c.cx,dy=p[1]-c.cy,vertical=Math.abs(dx)<1;
 const icon=vertical?[p[0],p[1]+(dy<0?-20:20)]:[p[0]+(dx<0?-26:26),p[1]-10],label=vertical?[p[0],p[1]+(dy<0?-49:49)]:[icon[0],p[1]+20];
 graphics.push({id:'radar-dot-'+g.id,type:'circle',silent:true,z:25,shape:{cx:p[0],cy:p[1],r:3},style:{fill:g.color,stroke:'#fff',lineWidth:1}},
 {id:'radar-icon-bg-'+g.id,type:'rect',silent:true,z:29,shape:{x:icon[0]-13,y:icon[1]-13,width:26,height:26,r:7},style:{fill:g.color+'19',stroke:g.color+'2B',lineWidth:.8}},
 {id:'radar-icon-'+g.id,type:'image',silent:true,z:30,originX:icon[0],originY:icon[1],style:{image:iconImage(g.id,g.color),x:icon[0]-9,y:icon[1]-9,width:18,height:18}},
 {id:'radar-name-'+g.id,type:'text',silent:true,z:30,x:label[0],y:label[1],style:{...radarCategoryText,text:g.label,fill:g.color,align:'center',verticalAlign:'middle'}},
 {id:'radar-axis-highlight-'+g.id,type:'line',silent:true,z:24,shape:{x1:c.cx,y1:c.cy,x2:p[0],y2:p[1]},style:{stroke:g.color,lineWidth:1.8,opacity:0}});
 for(const[k,value,color]of[['expected',g.score.normalizedWeight*100,'#3467F4'],['actual',m.contributionShares.find(s=>s.id===g.id)?.share,'#06B5A5']]){if(value===null||!Number.isFinite(value))continue;const q=c.dataToPoint(value,i);graphics.push({id:'radar-node-'+k+'-'+g.id,type:'circle',silent:true,z:31,shape:{cx:q[0],cy:q[1],r:5},style:{fill:color,stroke:'#fff',lineWidth:2,opacity:0,shadowBlur:5,shadowColor:color+'44'}});}
 });
 return graphics;
}
export function radarAxisTooltip(g,total){if(!g)return'';const expected=g.score.normalizedWeight*100,actual=total>0?g.score.contributionLow/total*100:null;
 return'<b>'+g.label+' · '+g.score.priorityLabel+'</b><br>期望权重：'+fmt(expected)+'%<br>实际贡献占比：'+(actual===null?'暂无贡献':fmt(actual)+'%');
}
export function radarTooltipPosition(axis,areas,width,height,size,{rect={left:0,top:0},viewport={width:width+500,height:height+500},center}={}){
 const a=areas.find(a=>a.id==='radar-icon-'+axis?.id);if(!a)return[10,10];const[w,h]=size,cx=center?.cx??width/2,cy=center?.cy??height/2,r=(center?.r??Math.min(width/2-52,(height-108)/2))+48,ix=a.x+a.w/2,iy=a.y+a.h/2;
 const choices={left:[cx-r-w-12,iy-h/2],right:[cx+r+12,iy-h/2],top:[ix-w/2,cy-r-h-12],bottom:[ix-w/2,cy+r+12]};
 const preferred=Math.abs(ix-cx)<3?(iy<cy?['top','left','right','bottom']:['bottom','left','right','top']):ix<cx?['left','top','bottom','right']:['right','top','bottom','left'];
 const fits=([x,y])=>x+rect.left>=8&&x+rect.left+w<=viewport.width-8&&y+rect.top>=8&&y+rect.top+h<=viewport.height-8;
 for(const side of preferred)if(fits(choices[side]))return choices[side];
 // Use the outer edge when viewport space is limited, keeping the card out of the plotted circle.
 const bounded=Object.values(choices).map(([x,y])=>[Math.max(8-rect.left,Math.min(viewport.width-w-8-rect.left,x)),Math.max(8-rect.top,Math.min(viewport.height-h-8-rect.top,y))]);
 const overlap=([x,y])=>Math.max(0,Math.min(x+w,cx+r-48)-Math.max(x,cx-r+48))*Math.max(0,Math.min(y+h,cy+r-48)-Math.max(y,cy-r+48));return bounded.sort((a,b)=>overlap(a)-overlap(b))[0];
}
