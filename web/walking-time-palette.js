// Seven supplied colour nodes. Map alpha and the legend soften the colours.
export const TIME_SURFACE_STOPS=Object.freeze([
 {seconds:0,color:'#306DE0'},
 {seconds:180,color:'#26AFD1'},
 {seconds:300,color:'#23BEA4'},
 {seconds:480,color:'#80CC75'},
 {seconds:600,color:'#E5D35C'},
 {seconds:720,color:'#F1A052'},
 {seconds:900,color:'#E16C5C'},
]);
export function surfaceColor(seconds){
 const t=Math.max(0,Math.min(900,seconds)),i=Math.max(0,TIME_SURFACE_STOPS.findIndex((s,n)=>n<TIME_SURFACE_STOPS.length-1&&t<=TIME_SURFACE_STOPS[n+1].seconds)),a=TIME_SURFACE_STOPS[i],b=TIME_SURFACE_STOPS[i+1],k=(t-a.seconds)/(b.seconds-a.seconds);
 const rgb=c=>[1,3,5].map(n=>parseInt(c.slice(n,n+2),16));
 return'rgb('+rgb(a.color).map((v,n)=>Math.round(v+(rgb(b.color)[n]-v)*k)).join(',')+')';
}
export const TIME_SURFACE_GRADIENT='linear-gradient(90deg,'+TIME_SURFACE_STOPS.map(s=>s.color+' '+s.seconds/9+'%').join(',')+')';
