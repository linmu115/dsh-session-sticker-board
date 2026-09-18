# 普通贴纸入口与维护服务边界 · 2026-09-18

用户要求恢复选中文本的普通贴纸入口，调查维护引擎迟启动/不可用时的行为。UI样式由原任务处理；本提交不改overlay/styles。

发现：client/index.tsx在挂载整个普通贴纸UI前等待托管knowledge status。状态请求失败会使菜单与侧栏注册都中断。改为后台读取身份；Bridge runtimeIdentity仍优先，无法取得身份时保持严格scope匹配，未放宽所有权。

knowledge请求遇到网络失败、超时、非JSON响应时返回明确不可用错误，不把HTML200当保存回执。真实冲突错误码仍保留。不自动重放写操作，也不启用第二存储。无Maintenance时普通UI可挂载，托管数据操作明确不可用；未迁移/未映射边界仍按既有协议拒绝。

typecheck/build通过；knowledge-availability/remote/overlay 18项合成测试通过，另native-context cohort已检查。实际历史Failed to fetch未在本任务复现，不把启动顺序推测记成唯一根因。生产只读Status保持原boot/run；没有真实贴纸写入或部署。
