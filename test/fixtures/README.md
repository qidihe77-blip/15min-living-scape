# 百度 API 离线样例与回归证据

八项服务的通用响应样例是手工构造的状态处理夹具，不宣称与线上所有业务结构完全一致。

另外三份夹具来自已录制的真实证据：`wenjin-metro.json` 保存定向地铁检索和Walking核验；`walking36-boundary-validation.json` 保存三个地点的36方向边界与独立采集的验证点（验证点不参与建模）；`wenjin-measured-heat.json` 仅保存历史热力图测试所需的48个已测目的地，属于兼容性测试，并非生产采样配置。

数据来源与局限见 `docs/verification` 和 `ISOCHRONE_EXPERIMENT_CONCLUSION.md`。第三方地理数据权利归原提供方，不视为本项目代码许可证授权。测试全部离线，不得放入AK或触发网络请求。

`facility-v8-before-completeness.json`为上一版已构建源码中的v8.2分类配置基线，用于确认小类ID不变及展示关键词增量。18小类新增正反例为人工夹具；其检索返回数量不能宣称线上召回率。
