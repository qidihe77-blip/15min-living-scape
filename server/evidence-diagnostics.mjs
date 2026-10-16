import{searchCompleteness}from'../web/search-completeness.js';
// Stable machine-readable reasons. No keys, URLs or upstream response bodies.
const messages = {
 search_incomplete:'声明检索范围尚未完整检索。', search_not_requested:'未执行有效检索请求。',
 search_pages_incomplete:'检索分页或分片尚未完成。', invalid_candidate:'候选坐标或返回结构无效。',
 classification_pending:'原始类别和名称不能确定所需设施类型。', candidate_limit_reached:'仍有候选未做路网核验。',
 destination_variants_unverified:'同一UID存在不同定位或入口，未全部核验。',
 route_incomplete:'路线证据不完整。', timeout:'路线或范围请求超时。', no_route:'服务未返回路线，不能据此判定设施不存在。',
 permission_denied:'该服务权限或鉴权失败。', quota_exhausted:'该服务配额不足。', rate_limited:'该服务请求被限流。',
 route_request_limit_reached:'路线请求预算不足。', route_detail_limit_reached:'路线详情预算不足。',
 place_request_limit_reached:'地点检索预算不足。', service_halted:'该服务已因终止错误停用。',
 upstream_unavailable:'上游请求失败。', invalid_route:'路线成本、坐标系或端点证据不一致。',
 service_cooldown:'该接口连续失败后短暂冷却；当前证据不足，需在恢复后重新发起分析。',
 non_monotonic_sampling:'同一方向采样成本不单调，不能据此连接近似边界。',
 self_intersecting_boundary:'采样边界自交，未发布无效范围。',degenerate_boundary:'采样边界退化，不能形成有效范围。',
 collapsed_boundary_vertices:'采样边界顶点重合或过近，范围未知。',invalid_boundary_coordinates:'采样边界坐标无效，范围未知。',
 invalid_geometry:'提供方范围几何无效，不能发布。',geometry_complexity_unverified:'范围几何复杂度超过本次有界校验能力，未当作有效范围。',
 sampling_not_confirmed:'本任务未允许真实步行采样。', walking_budget_exhausted:'真实步行采样预算不足。',
 walking_route_unavailable:'真实步行采样服务未配置。', insufficient_sampling:'有效样点或方向不足，不能发布近似范围。',
 missing_path:'服务未返回真实路线折线。', invalid_path:'返回折线坐标无效。',
 unverified_endpoint_binding:'路线缺少起终点绑定证据。', outside_search_radius:'地点在声明搜索半径之外。',
 excluded_by_rule:'有明确排除规则，不纳入当前统计。', beyond_900_seconds:'有效步行路线超过900秒。',
 beyond_1200_meters:'真实步行距离超过1200米，按80m/min估算超过15分钟。',
 outside_official_distance_range:'候选不在官方返回的1200米步行等距范围内。',
 reachable_witness:'有真实步行耗时≤900秒的可达证据。', not_routed:'候选尚未核验路线。',
 nearest_verified_partial:'仅为已核验候选中最近，未证明完整窗口内最近。',
 analysis_timeout:'任务超时，保留已完成证据；范围未知。', cancelled:'任务被取消。',
 destination_outside_analysis_window:'起点生活圈可能超出分析地点检索窗口，窗口外设施未知。',
 endpoint_geometry_mismatch:'真实折线端点与请求点或服务返回的绑路点相距超过150米，暂不可绘制。',
 no_verified_reachable_facility:'本类尚无已核验可达设施；不代表不存在设施。',
 not_provided:'上游只返回距离和耗时，未提供折线。',
};
export const reasonDetail = (reasonCode, context = {}) => ({reasonCode,
 explanation:messages[reasonCode] ?? ('证据未完成：'+reasonCode), ...context});
export function attachSearchDiagnostics(access, search) {
 const codes=[...(access.unknownReasons ?? []), ...(search.errors ?? []).map(e=>e.code)];
 if(!search.searchComplete){codes.push(search.pages?.length?'search_pages_incomplete':'search_not_requested');}
 const reasonCodes=[...new Set(codes)];
 return {...access,retrieval:searchCompleteness(search),reasonCodes,reasonDetails:reasonCodes.map(c=>reasonDetail(c)),
  reasonCode:access.accessStatus==='unknown'?reasonCodes[0] ?? 'search_incomplete':null,
  explanation:access.accessStatus==='reachable'?access.walkingModelId==='walking80-v1'?'存在真实步行距离≤1200米的证据，80m/min估算≤15分钟。':'存在已核验≤900秒步行证据。':access.accessStatus==='unknown'
   ?'证据不足，不能判定本次未发现可达设施。':access.walkingModelId==='walking80-v1'?'本次声明窗口检索和候选路网核验完整，未发现真实步行距离≤1200米设施。':'本次声明窗口检索和候选路网核验完整，未发现≤900秒可达设施。'};
}
