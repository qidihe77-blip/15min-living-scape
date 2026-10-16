# 三地测试验证

**[本次发布验收结果](RELEASE_VERIFICATION.md)** · [三地真实记录明细](THREE_LOCATIONS.md) · [快照索引](../../data/demo/manifest.json)

本次为2026-10-16对当前源码的离线回放及实际浏览器验证，未重新发起三地Place检索或POI/边界Walking。武汉使用A86已保存的当前归类回放；杭州、南昌保留历史分类与搜索完成状态。历史结果不能冒充今天实时检索。

## 可复现命令

~~~sh
npm test
npm run verify:records
npm run verify:http
npm run check
npm run build
~~~

真实快照SHA-256、来源ID、时间和规则版本保存在manifest。verify:records核验UID、真实路线绑定、≤1200m、6类18小类、评分一致、缺失资格、灰面并集及互斥面积统计。合成单元夹具明确放在test/fixtures，不与真实快照混用。

## 浏览器复验

先配置自己的AK，执行npm run demo:prepare与npm start。可选浏览器依赖：

~~~sh
npm install --no-save --package-lock=false playwright@1.62.1
npx playwright install chromium
npm run verify:browser
~~~

默认检查1920×992单个视口，输出output/browser。BASE_URL、BROWSER_CHANNEL（例如msedge）可用环境变量指定。此脚本禁止所有业务POST，地图样式代理除外；覆盖恢复、图例、盲区、全量/最近设施、两行弹窗、去重与刷新。不会调用实时检索、补算路径或导航。实际通行节点历史调用证据另列，不声称本轮刷新了导航API。

## 历史证据

- [A80三地功能报告](history/a80-three-locations.md)：原27个场景、15项记录检查，包含当时范围，**不代表当前盲区范围**。
- [A80浏览器原始结果](history/a80-browser.json)、[记录检查](history/a80-record-checks.json)、[路径异常清单](history/a80-route-anomalies.json)。
- [A82性能记录](history/a82-performance.md)、[采样原始诊断](history/a82-sampling.json)：历史网络/缓存条件，不作为今日耗时。
- [A78补点记录](history/a78-adaptive.md)：局部改善与限制。

杭州沿用历史文锦参考定位点而非本次重新定位的小区入口；三份任务都有不完整检索部分。本次验证计算与交互一致，不宣称真实世界设施普查完备。未做PDF导出检查（功能已取消）或四屏专项验收。Linux实现采用Node标准库和POSIX shell，但当前执行主机是Windows，不能标成Linux实机测试通过。
