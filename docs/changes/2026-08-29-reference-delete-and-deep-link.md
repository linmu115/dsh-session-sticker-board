# 0.4.0 — 精准深链与双端删除

- 深链打开会等待目标会话真正切换并等待目标 DOM 渲染，避免 Web Viewer 刚打开时过早判定失败。
- 保留并传递 Annotation Core 的 `setId/referenceId`，定位消息后可直接打开对应引用详情。
- Bridge 动作队列新增 `reference-delete-request`；Obsidian 发起删除时调用 Core 的统一删除接口并确认回执。
- Obsidian 来源适配器新增已提交引用清理，用于 Core 删除后移除 Bridge 生成块。
- Harness/React/Core 运行时 peer 全部保持 `*` 且可选；仓库级构建关闭 peer 自动补装，Maintenance 可自由试验版本组合。
