// Retrieval completeness is independent of Walking/classification certainty.
export const SEARCH_STATE_LABELS=Object.freeze({complete:'检索完整',truncated:'结果截断',failed:'检索失败',pending:'待核验'});
const failures=new Set(['upstream_unavailable','timeout','permission_denied','quota_exhausted','rate_limited','invalid_response','service_halted','service_cooldown']);
export function searchCompleteness(search={}){
 const errors=search.errors??search.searchErrors??[],pages=search.pages??search.searchPages??[],codes=errors.map(e=>e.code),complete=search.searchComplete===true&&!search.truncated&&!search.searchTruncated&&!errors.length&&!search.invalidCandidateCount&&search.status!=='failed'&&search.searchStatus!=='failed';
 const state=complete?'complete':codes.some(c=>failures.has(c))||search.status==='failed'||search.searchStatus==='failed'?'failed':search.truncated||search.searchTruncated||search.continuation||pages.length||codes.some(c=>/cap|limit|budget|page|incomplete/.test(c))?'truncated':'pending';
 return{state,label:SEARCH_STATE_LABELS[state],complete,partialResults:!complete&&(search.candidatesFound??search.candidates?.length??search.candidatesRetrieved??0)>0,reasonCodes:[...new Set(codes)],scope:'returned_provider_queries_in_declared_window',absenceClaim:false};
}
