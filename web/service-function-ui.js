const facets={vegetables:'蔬菜',fruit:'水果',fresh_meat:'鲜肉'};
export function functionalStatusText(d){return'生鲜服务：'+(d?.statusLabel??'自动识别中');}
export function serviceEvidenceText(d){if(!d)return'正在自动识别门店服务能力与1公里步行覆盖。';return[d.statusLabel,...Object.entries(facets).map(([id,label])=>label+'：'+(d.facets?.[id]?d.facets[id].name+'（步行'+Math.round(d.facets[id].distanceMeters)+'米）':'未取得覆盖证据')),...(d.searchComplete?[]:['本次检索窗口未完整覆盖，不能判定服务缺失。']),...(d.unknownCandidates?.length?['部分门店经营或步行证据不足，保留待核验。']:[]),'完整生鲜替代需同时支持蔬菜、水果和鲜肉。','独立1公里专项，不计入综合评分。'].join('\n');}
// Card-only diagnosis: no grid, map overlay, POI or layer control.
export function createServiceFunctionUI({cards,onNotice=()=>{}}){
 let field=null,id=null,controller=null,sequence=0;
 function renderCards(){const card=cards.querySelector('[data-specialty="market"]');if(!card)return;card.querySelector('.diagnosis-function')?.remove();const line=document.createElement('span');line.className='diagnosis-function';line.textContent=functionalStatusText(field?.originDiagnostic);line.dataset.functionStatus=field?.originDiagnostic?.status??'loading';line.title=serviceEvidenceText(field?.originDiagnostic);card.append(line);}
 const pause=signal=>new Promise(resolve=>{const done=()=>{clearTimeout(t);signal.removeEventListener('abort',done);resolve();},t=setTimeout(done,650);signal.addEventListener('abort',done,{once:true});});
 async function load(job){if(id===job.analysisId)return;id=job.analysisId;field=null;controller?.abort();controller=new AbortController();const signal=controller.signal,seq=++sequence;renderCards();
  try{const path='/api/analyses/'+encodeURIComponent(id)+'/service-functions';let r=await fetch(path,{signal}),data=await r.json();if(!r.ok)throw Error(data.error??'诊断读取失败');if(data.status==='not_started'){r=await fetch(path,{method:'POST',signal});data=await r.json();if(!r.ok)throw Error('自动诊断未完成');}
   while(!signal.aborted&&seq===sequence){if(data.field){field=data.field;renderCards();}if(data.status!=='running')break;await pause(signal);if(signal.aborted)return;r=await fetch(path,{signal});data=await r.json();if(!r.ok)throw Error('自动诊断读取失败');}
  }catch{if(signal.aborted)return;const line=cards.querySelector('.diagnosis-function');if(line){line.textContent='生鲜服务：待核验';line.title='自动诊断未取得完整证据。';}onNotice('生鲜服务诊断暂未取得完整证据，原设施评估已保留。');}
 }
 return{load,renderCards,destroy(){sequence++;controller?.abort();cards.querySelector('.diagnosis-function')?.remove();}};
}
