import{validBd09ll}from'./walking-provider.mjs';
export function createBaiduWeatherProvider({client,requestLimit=32,now=Date.now}={}) {
 if(!client?.requestJson)throw new TypeError('Weather client required');
 let used=0,last=-Infinity;const cache=new Map(),pending=new Map();
 async function query(point){
  if(!validBd09ll(point))throw new TypeError('Invalid weather location');
  const key=point.lng.toFixed(3)+','+point.lat.toFixed(3),entry=cache.get(key);
  if(entry&&entry.expires>now())return {...structuredClone(entry.value),cached:true};
  if(pending.has(key))return pending.get(key);
  if(used>=requestLimit)return {status:'unavailable',reasonCode:'weather_budget_exhausted'};
  if(now()-last<1000)return {status:'unavailable',reasonCode:'weather_rate_limited'};
  used++;last=now();
  const promise=(async()=>{try{
   const{data,meta}=await client.requestJson({service:'weather',path:'/weather/v1/',params:{location:key,coordtype:'bd09ll',data_type:'now',output:'json'},cacheTtlMs:300000});
   const r=data.result,n=r?.now;if(!n||typeof n.text!=='string'||!Number.isFinite(n.temp)||n.temp<-100||n.temp>100)return {status:'unavailable',reasonCode:'invalid_weather_response'};
   const value={status:'available',source:'baidu_weather',location:{...point},area:String(r.location?.city??r.location?.name??'当地天气').slice(0,60),
    temperature:n.temp,text:n.text.slice(0,40),windDirection:String(n.wind_dir??'').slice(0,20),windClass:String(n.wind_class??'').slice(0,20),
    humidity:Number.isFinite(n.rh)?n.rh:null,providerUpdatedAt:typeof n.uptime==='string'?n.uptime:null,retrievedAt:meta.retrievedAt,cached:meta.cached===true};
   cache.set(key,{value,expires:now()+300000});return structuredClone(value);
  }catch(e){return {status:'unavailable',reasonCode:e.code??'weather_unavailable',apiStatus:e.apiStatus??null,httpStatus:e.httpStatus??null};}
  })();pending.set(key,promise);try{return await promise;}finally{pending.delete(key);}
 }
 return {query,stats:()=>({requests:used,limit:requestLimit})};
}
