import {accessibilityTrend} from './circle-presentation.js';
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function accessibilityTrendSvg(rows,origin){
 const points=accessibilityTrend(rows,origin),max=Math.max(4,...points.map(p=>p.count)),step=Math.max(1,Math.ceil(max/4)),ceiling=step*4;
 const x=m=>42+m/15*370,y=n=>151-n/ceiling*110,line=points.map(p=>[x(p.minutes),y(p.count)].join(',')).join(' ');
 return '<svg class="accessibility-trend-svg" viewBox="0 0 440 193" role="img" aria-label="步行可达性增长趋势，按已有有效步行证据累计UID去重">'
  +'<defs><linearGradient id="access-trend-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3299ed" stop-opacity=".23"/><stop offset="1" stop-color="#3299ed" stop-opacity=".02"/></linearGradient></defs>'
  +'<text x="12" y="18" class="trend-unit">累计可达设施（个）</text>'
  +[0,1,2,3,4].map(i=>'<path class="trend-grid" d="M42 '+y(i*step)+'H412"/><text class="trend-tick" x="31" y="'+y(i*step)+'" text-anchor="end" dominant-baseline="middle">'+i*step+'</text>').join('')
  +'<polygon points="42,151 '+line+' 412,151" fill="url(#access-trend-fill)"/><polyline class="trend-line" points="'+line+'"/>'
  +points.map(p=>{const tip={title:p.minutes+'分钟累计可达',rows:[['设施数量',p.count+'个']],note:'已有有效步行证据，按UID去重；暂无步行数据的设施不计入。'};
   return '<g class="trend-point" tabindex="0" role="img" data-chart-tip="'+escape(JSON.stringify(tip))+'" aria-label="'+p.minutes+'分钟 '+p.count+'个"><circle class="trend-hit" cx="'+x(p.minutes)+'" cy="'+y(p.count)+'" r="12"/><circle class="trend-dot" cx="'+x(p.minutes)+'" cy="'+y(p.count)+'" r="4.5"/><text class="trend-value" text-anchor="middle" x="'+x(p.minutes)+'" y="'+(y(p.count)-12)+'">'+p.count+'</text><text class="trend-tick" text-anchor="middle" x="'+x(p.minutes)+'" y="178">'+p.minutes+'分钟</text></g>';
  }).join('')+'</svg>';
}
