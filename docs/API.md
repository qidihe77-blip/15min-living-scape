# HTTP接口

本地默认 `http://127.0.0.1:4173`，同源JSON，服务端AK不返回前端。

| 方法 / 路径 | 用途 |
| --- | --- |
| GET `/api/health` | 服务、队列与授权开关，不消费算路额度 |
| GET `/api/config` | 浏览器AK和生产算法ID |
| GET `/api/facility-categories?version=facility-categories-v8` | 6类18小类树 |
| GET `/api/places?lat=…&lng=…&category=…&radius=1500` | 周边检索，消费Place额度 |
| POST `/api/analyses` | 创建任务，202返回analysisId |
| GET `/api/analyses/:id` | 完整结果；`?view=ui`精简投影 |
| GET `/api/analyses/:id/geojson`、`metrics` | 边界、阶段诊断 |
| POST `/api/analyses/:id/score` | 复用证据重算优先级，需匹配指纹 |
| POST `/api/analyses/:id/cancel` | 取消任务 |
| POST `/api/analyses/:id/route` | 按需真实路径 |
| GET/POST `/api/analyses/:id/representative-routes` | 代表路线 |
| POST `/api/analyses/:id/walking-navigation` | 导航步骤，按需或缓存 |
| POST `/api/map-style` | 公开地图样式的缓存代理 |
| GET `/api/reports/:id` | 结构化结果JSON，不是文件导出 |

当前创建任务请求由 `web/facility-view.js` 的 `makeFacilityTask` 生成，校验见 `server/facility-job.mjs` 的 `validateFacilityV3Input`。请在页面真实选择地点后提交；不要用旧版本字段、其他坐标系或虚构UID拼接请求。

无AK可执行 `npm run verify:http` 检查启动、静态文件、分类及非法请求隔离。在线创建分析会消费自己的配额。完整路径清单可运行 `rg -n '/api/' server/index.mjs`。

服务还保留历史walking-samples、weather、service-functions、time-field兼容端点；当前首页不调用天气、生鲜替代或额外时间场，不作为现有产品功能。没有PDF导出路由。

旧八类POST /api/walking-validation已退役，返回410且不调用API。原独立核验模块保留供历史兼容回归。
