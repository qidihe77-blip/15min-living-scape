import {routeLines} from './walking-network.js';

const point=p=>p?.location ?? p;
const samePoint=(a,b)=>a&&b&&Number.isFinite(a.lng)&&Number.isFinite(a.lat)
 && Math.abs(a.lng-b.lng)<=.000001&&Math.abs(a.lat-b.lat)<=.000001;
// Read the backend's chosen representative. Never compute another nearest or score.
export function categoryRouteDescriptors(job) {
 return (job?.analysis?.categories ?? []).map(group=>{
  const supplied=job.representativeRoutes?.find(r=>r.categoryId===group.categoryId), row=group.nearestReachableAnySubtype;
  const r=supplied ?? {categoryId:group.categoryId,label:group.label,name:row?.name,uid:row?.facilityUid,
   identityKey:row?.identityKey,subtypeId:row?.subtypeId,origin:row?.origin,originUid:row?.originUid,
   destination:row?.destination,destinationUid:row?.destinationUid,geometry:row?.geometry,
   durationSeconds:row?.durationSeconds,distanceMeters:row?.distanceMeters,
   evidenceStatus:row?.routeStatus==='ok'?'verified_cost':'unknown',geometryStatus:row?.geometryStatus,
   coordinateSystem:row?.coordinateSystem,reasonCode:row?'missing_path':'no_verified_reachable_facility'};
  const validCost=r.evidenceStatus==='verified_cost'&&r.coordinateSystem==='BD-09LL'
   && Number.isFinite(r.durationSeconds)&&r.durationSeconds>=0&&r.durationSeconds<=900
   && Number.isFinite(r.distanceMeters)&&r.distanceMeters>=0
   && samePoint(point(r.origin),job.analysis.origin.location)
   && (r.origin?.uid ?? r.originUid ?? null)===(job.analysis.origin.uid ?? null);
  const lines=validCost?routeLines(r.geometry):[];
  return {...r,color:group.color,label:group.label,validCost,drawable:lines.length>0,lines,
   reasonCode:!validCost?'no_verified_reachable_facility':lines.length?null:r.reasonCode ?? r.geometryStatus ?? 'missing_path'};
 });
}
export function createCategoryRouteController({requestDetail,updateJob,onChange=()=>{},onStatus=()=>{}}) {
 let job=null,binding='',revision=0,globalVisible=true;
 const hidden=new Set(),pending=new Map(),attempted=new Set(),errors=new Map();
 const signature=j=>JSON.stringify([j?.analysisId,j?.analysis?.origin,j?.categoryMappingVersion]);
 function rows(){return categoryRouteDescriptors(job).map(r=>({...r,visible:globalVisible&&!hidden.has(r.categoryId),
  pending:pending.has(r.categoryId),reasonCode:errors.get(r.categoryId) ?? r.reasonCode}));}
 function notify(){onChange(rows());}
 function clear(){revision++;for(const c of pending.values())c.abort();pending.clear();attempted.clear();errors.clear();hidden.clear();job=null;binding='';notify();}
 function bind(next){const nextBinding=signature(next);if(nextBinding!==binding){clear();binding=nextBinding;}job=next;notify();}
 async function toggle(id){
  const r=rows().find(r=>r.categoryId===id);if(!r||pending.has(id))return;
  if(r.drawable){hidden.has(id)?hidden.delete(id):hidden.add(id);notify();return;}
  if(!r.validCost){onStatus('该类尚无可用的15分钟可达设施。');return;}
  const key=JSON.stringify([binding,r.identityKey,r.subtypeId]);
  if(attempted.has(key)){onStatus('该路线仍不可绘制：'+(errors.get(id) ?? r.reasonCode));return;}
  attempted.add(key);const current=revision,controller=new AbortController();pending.set(id,controller);notify();
  try{
   const response=await requestDetail(job.analysisId,{identityKey:r.identityKey,subtypeId:r.subtypeId,evidenceFingerprint:job.score.evidenceFingerprint},controller.signal);
   if(current!==revision||controller.signal.aborted)return;
   if(response.job&&signature(response.job)!==binding)return;
   pending.delete(id);
   if(response.job){job=response.job;updateJob(response.job);}
   const updated=categoryRouteDescriptors(job).find(x=>x.categoryId===id);
   if(!updated?.drawable){errors.set(id,response.routeStatus!=='ok'?response.routeStatus:updated?.reasonCode ?? 'missing_path');onStatus('已有路线成本，折线不可绘制：'+errors.get(id));}
   else {hidden.delete(id);errors.delete(id);onStatus('已显示真实步行路线。');}
  }catch(error){if(current===revision&&!controller.signal.aborted){errors.set(id,'detail_request_failed');onStatus(error.message);}}
  finally{if(current===revision){pending.delete(id);notify();}}
 }
 return {bind,clear,toggle,rows,setGlobalVisible(value){globalVisible=Boolean(value);notify();}};
}
