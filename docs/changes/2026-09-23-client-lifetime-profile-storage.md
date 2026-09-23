# 2026-09-23 普通贴纸生命周期与 profile 存储

用户授权修复插件动态依赖与卸载生命周期。本次实现位于 Sticker Board 工作树，最终版本 `0.7.4-rc2.12`，配套 Core .29 / Bridge .11。实际安装单独验收，本记录不代表已部署。

客户端在第一次异步等待前登记同步生命周期所有者，由可观察的异步子 fiber 执行初始化。Cordis 会等待异步启动结束才调用该 fiber 自身 disposer，因此不能只在原 async callback 前加一个卸载标记。依赖退出时，外层先取消未完成的挂载/配置等待；后返回的 remote 会被释放，不能再创建 React 根。配置读取即使一直未返回，取消仍会释放 descriptor 并结束初始化。真正的初始化失败保留为子 fiber 的 FAILED 状态，并回滚已取得的资源。

卸载等待 remote disposer；React 根在受管理的清理链中卸载，随后移除 DOM，不再依赖无归属的定时器。Bridge 动作/健康/sync、可选侧栏、workspace 都在清理范围内。底层 `$mount` 在返回 disposer 前没有取消 API，因此 pending `$mount` 必须等其返回才能完成释放，这是明确保留的协议边界。

默认宿主存储以 Bridge profileId 分目录，缺少身份时不猜 profile。显式 storageDirectory 保持兼容。旧默认文件不携带 profile，不能自动归属；新增离线迁移工具保留来源、建立原字节备份和唯一归属回执，再复制队列与冻结标记。安装前迁移步骤与恢复边界见 [迁移操作说明](../cli-operations-sticker-storage.md)。

本轮通过构建、类型检查，以及 22 个测试文件共 125 项测试。其中真实 Cordis 合成回归覆盖依赖失去/替换、pending 启动、晚返回 remote、配置永久等待的取消、React 初始化失败、卸载等待 remote；临时目录测试覆盖多 profile 隔离与安全迁移。React 生命周期测试使用可观测的 createRoot stub，验证资源归属，不构成真实页面视觉或交互验收。

真实实例升级、旧用户数据迁移、UI 与多 Vault 业务操作未验收。没有把已有版本发布状态或其他插件结果当作本候选的业务验收。
