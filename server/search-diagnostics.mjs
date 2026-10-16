const labels={place_request_limit_reached:'本次地点检索预算已用完',service_halted:'地点服务调用被暂停',rate_limited:'地点服务限流',quota_exhausted:'地点服务配额已用完',permission_denied:'地点服务权限未通过',service_cooldown:'地点服务短暂冷却',timeout:'地点服务响应超时',upstream_unavailable:'地点服务暂不可用',invalid_response:'地点服务响应异常',cancelled:'检索已取消'};
export function facilitySearchDiagnostics(analysis){
 const searches=analysis?.diagnostics?.searches??[];
 const pages=new Set(searches.flatMap(s=>(s.pages??[]).map(p=>JSON.stringify([s.recalledCategoryId??s.subtypeId,p.keyword,p.shardId,p.pageNum,p.retrievedAt]))));
 const codes=[...new Set(searches.flatMap(s=>(s.errors??[]).map(e=>e.code)))];
 const failed=searches.length>0&&pages.size===0&&codes.length>0;
 return{status:failed?'failed':codes.length?'partial':'available',successfulPages:pages.size,reasonCodes:codes,
  message:failed?'地点检索未成功：'+codes.map(c=>labels[c]??c).join('、')+'。请稍后重试。':''};
}
