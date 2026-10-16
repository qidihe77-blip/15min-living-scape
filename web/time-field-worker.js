import{buildDirectionalTimeField as buildTimeFieldRaster}from'./directional-time-field.js';
self.onmessage=({data})=>{try{const r=buildTimeFieldRaster(data.job,data.rows,data.category);self.postMessage({id:data.id,result:r},r.pixels?[r.pixels.buffer,r.values.buffer]:[]);}catch(e){self.postMessage({id:data.id,error:e.message});}};
