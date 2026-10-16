// Product copy only. Machine states, unknown evidence and scores are unchanged.
export function productText(text){return String(text??'').replace(/暂无已核验设施/g,'本次未查到设施').replace(/待核验|未核验/g,'暂无结果').replace(/已核验/g,'已获取').replace(/核验/g,'查询');}
