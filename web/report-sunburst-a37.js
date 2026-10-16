import {LIGHT_TOOLTIP} from './report-theme.js';
import {TYPE,auxiliaryText,dataText,categoryText,sunburstCategoryText} from './report-typography.js';

export const fmt = v => Number.isFinite(v) ? Number(v.toFixed(1)).toString() : '—';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Global coordinates keep the lighting radial across sectors, rather than
// restarting a diagonal gradient in each sector's individual bounding box.
const tint=(color,white)=>{const n=parseInt(color.slice(1),16);return '#'+[n>>16,(n>>8)&255,n&255].map(v=>Math.round(v+(255-v)*white).toString(16).padStart(2,'0')).join('');};
const gradient=(from,to,layout)=>({type:'radial',x:layout?.cx??.5,y:layout?.cy??.5,r:layout?.radius??.5,global:Boolean(layout),colorStops:[{offset:0,color:from},{offset:1,color:to}]});
const innerGradient=(color,layout)=>({...gradient(color,tint(color,.2),layout),colorStops:[{offset:0,color},{offset:.36,color},{offset:.66,color:tint(color,.2)},{offset:1,color:tint(color,.2)}]});

// Composition keeps the existing one-facility/one-sector allocation. It does not score coverage.
export function facilitySunburstData(m, E, layout) {
  return m.groups.map(g => ({
    id: g.id, name: g.label, categoryId: g.id, value: g.value,
    percent: m.totalPoi > 0 ? g.value / m.totalPoi * 100 : 0,
    itemStyle: {color: innerGradient(g.color,layout)},
    accentColor: g.color,
    emphasis: {focus: 'descendant'},
    children: g.children.map((s, i) => ({
      id: s.id, name: s.name, categoryId: g.id, subtypeId: s.id, value: s.value,
      percent: m.totalPoi > 0 ? s.value / m.totalPoi * 100 : 0,
      itemStyle: {color: gradient(tint(g.color,.26+i*.025),tint(g.color,.62+i*.025),layout)},
      accentColor: g.color,
      emphasis: {focus: 'self'},
      label: {show: false}
    }))
  }));
}

export function sunburstDisplayLayout(width,height){const base=Math.max(30,Math.min(width/2-70,height/2-58));return{cx:width/2,cy:height/2,radius:Math.max(30,Math.min(base*1.44,width/2-26,height/2-32)),baseRadius:base};}
export function sunburstCenterGraphics(total,{cx,cy,radius}){
  const hole=radius*.36,numberSize=Math.max(TYPE.module,Math.min(TYPE.core,Math.floor(hole*.9),Math.floor((hole*2-14)/(String(total).length*.62))));
  return[
    {id:'sunburst-center-surface',type:'circle',silent:true,z:11,shape:{cx,cy,r:Math.max(0,hole-2)},style:{fill:{type:'radial',x:.4,y:.25,r:1,colorStops:[{offset:0,color:'#FFFFFF'},{offset:1,color:'#F1F8FF'}]},stroke:'#FFFFFF',lineWidth:1,shadowBlur:7,shadowColor:'#416DA712'}},
    {id:'sunburst-center-total',type:'text',silent:true,z:16,x:cx,y:cy,info:{totalPoi:total},style:{fontFamily:TYPE.family,text:String(total),fontSize:numberSize,fontWeight:TYPE.coreWeight,lineHeight:numberSize*1.1,fill:'#376CAD',align:'center',verticalAlign:'middle'}}
  ];
}
export function facilitySunburstOption(m, E, width, height) {
  const {radius,cx,cy} = sunburstDisplayLayout(width,height);
  return {
    backgroundColor: 'transparent', textStyle: dataText,
    animationDuration: 600, animationDurationUpdate: 650, animationEasingUpdate: 'cubicOut',
    tooltip: {...LIGHT_TOOLTIP, textStyle:{...auxiliaryText,color:'#31536A'},formatter: p => '<b>' + esc(p.data.name) + '</b><br>设施占比：' + fmt(p.data.percent) + '%'},
    series: [{
      id: 'facility-composition', type: 'sunburst', center: [cx,cy], radius: [radius*.36, radius],
      sort: null, nodeClick: false, stillShowZeroSum: false, renderLabelForZeroData: false,
      data: facilitySunburstData(m, E,{cx,cy,radius}),
      labelLayout: {hideOverlap: true},
      label: {rotate: 0},
      itemStyle: {borderWidth: 1.7, borderColor: '#FFFFFF', borderRadius: 3},
      emphasis: {focus: 'descendant', itemStyle: {shadowBlur: 10, shadowColor: '#386FA333'}},
      blur: {itemStyle: {opacity: .3}, label: {opacity: .3}},
      levels: [{}, {
        r0: radius*.36, r: radius * .66,
        label: {...sunburstCategoryText,rotate: 0, color: '#fff', minAngle: 30, padding: 0},
        itemStyle: {borderRadius: 3, borderWidth: 2}
      }, {
        r0: radius * .67, r: radius,
        label: {...dataText,show:false,rotate: 0, color: '#315975', minAngle: 16,
          formatter: p => fmt(p.data.percent) + '%'},
        itemStyle: {borderWidth: 2, borderRadius: 4}
      }]
    }],
    graphic: sunburstCenterGraphics(m.totalPoi,{cx,cy,radius})
  };
}

export function sunburstNameGraphics(chart) {
  const series = chart.getModel().getSeriesByIndex(0), data = series?.getData();
  if (!data) return [];
  const width = chart.getWidth(), height = chart.getHeight(), candidates = [];
  data.each(i => {
    const d = data.getRawDataItem(i), l = data.getItemLayout(i);
    if (!d?.subtypeId || !d.value || !l || l.angle < .14) return;
    const a=(l.startAngle+l.endAngle)/2,nx=Math.cos(a),ny=Math.sin(a),tx=-ny,ty=nx,
      text=d.name,w=d.name.length*TYPE.body,h=TYPE.body*TYPE.lineHeight,
      distance=l.r+8+w/2*Math.abs(nx)+h/2*Math.abs(ny),x=l.cx+nx*distance,y=l.cy+ny*distance;
    let low=-50,high=50;for(const[value,coefficient,min,max]of[[x,tx,w/2+6,width-w/2-6],[y,ty,h/2+6,height-h/2-6]]){
      if(Math.abs(coefficient)<1e-8){if(value<min||value>max){low=1;high=0;}continue;}
      const a=(min-value)/coefficient,b=(max-value)/coefficient;low=Math.max(low,Math.min(a,b));high=Math.min(high,Math.max(a,b));
    }
    if(low>high)return;const shift=Math.max(low,Math.min(high,0)),xx=x+tx*shift,yy=y+ty*shift,
      box={left:xx-w/2,right:xx+w/2,top:yy-h/2,bottom:yy+h/2},edgeDistance=Math.min(Math.abs(nx)>1e-8?w/2/Math.abs(nx):Infinity,Math.abs(ny)>1e-8?h/2/Math.abs(ny):Infinity);
    candidates.push({d,l,text,x:xx,y:yy,box,w,h,nx,ny,edge:[xx-nx*edgeDistance,yy-ny*edgeDistance]});
  });
  const accepted=[],boxes=[];for(const c of candidates.sort((a,b)=>b.l.angle-a.l.angle)){
    if(boxes.some(b=>c.box.left<b.right+4&&c.box.right>b.left-4&&c.box.top<b.bottom+4&&c.box.bottom>b.top-4))continue;
    boxes.push(c.box);const p=[c.l.cx+c.nx*c.l.r,c.l.cy+c.ny*c.l.r],color=c.d.accentColor??'#91C6DC';
    accepted.push({id:'sunburst-leader-'+c.d.id,type:'polyline',silent:true,z:14,shape:{points:[p,[p[0]+c.nx*7,p[1]+c.ny*7],c.edge]},style:{stroke:color,opacity:.45,lineWidth:1,fill:null}},
      {id:'sunburst-label-dot-'+c.d.id,type:'circle',silent:true,z:15,shape:{cx:p[0],cy:p[1],r:3},style:{fill:color,stroke:'#fff',lineWidth:1.5}},
      {id:'sunburst-name-'+c.d.id,type:'text',silent:true,z:15,x:c.x,y:c.y,rotation:0,info:{categoryId:c.d.categoryId,subtypeId:c.d.subtypeId,labelBox:c.box},style:{...dataText,text:c.text,fill:color,align:'center',verticalAlign:'middle'}});
  }return accepted;
}
