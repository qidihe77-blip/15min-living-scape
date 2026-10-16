export function categoryViewport(points,{width,height,padding=65,maxZoom=18}={}){
 const p=points.filter(p=>Number.isFinite(p?.lng)&&Number.isFinite(p?.lat)&&Math.abs(p.lat)<85);
 if(!p.length)return null;const project=lat=>Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))/(2*Math.PI),ys=p.map(p=>project(p.lat));
 const west=Math.min(...p.map(p=>p.lng)),east=Math.max(...p.map(p=>p.lng)),south=Math.min(...ys),north=Math.max(...ys);
 const zoom=Math.floor(Math.min(Math.log2(Math.max(40,width-2*padding)/(Math.max((east-west)/360,1e-7)*256)),Math.log2(Math.max(40,height-2*padding)/(Math.max(north-south,1e-7)*256))));
 return{center:{lng:(west+east)/2,lat:(2*Math.atan(Math.exp((north+south)/2*2*Math.PI))-Math.PI/2)*180/Math.PI},zoom:Math.max(10,Math.min(maxZoom,zoom))};
}
