# 普通贴纸接入统一 Bridge — 第一阶段

版本：Sticker Board `0.7.4-rc2.1`；共享通道要求 Bridge Lifecycle `0.4.0-rc2.1`。Bridge peer 为可选，但安装旧版 Bridge 不满足本轮兼容声明。

## 归属与接口

- Sticker 保留普通贴纸数据、UI、笔记关联与解除的业务校验、Maintenance 知识接口、logical/native 定位、迁移 freeze/stage/activate 协议以及普通 selection action。
- `createStickerBridgeChannel` 按操作取得当前 `obsidianBridgeLifecycle.transport`，只借用 `readSessionNote`、`saveSessionNote`、`deleteStickerBacklinks`、`openNote`、`listBacklinks`、`knowledge`。不持有或释放 transport，不调用公共 poll/ack。
- 普通定位通过 `registerActionHandler('session-sticker-board', { accepts, handle })` 接收；Bridge 挂载/恢复时经 `mountWhenReady` 请求同步。健康数据由 `registerHealthSource('stickers', ...)` 提供，通用健康入口归 Bridge。
- 关联笔记的 `handoffReference({ sessionId, operationId, prepare, commit, assertCurrent })` 由 Sticker 提供业务回调，Bridge 协调 Core add 与失败补偿；Sticker 不直接执行 Core 写入。原有笔记关联删除意图及乐观并发处理保留。
- Bridge 晚挂载、退出、重新挂载时，操作动态借用当前服务，处理器随依赖生命周期注销。Sticker 不保留旧服务的连接。

## 缺席边界

无 Bridge 时，远端操作以 `BridgeUnavailableError` 结束；独立本地普通贴纸继续读写，回链删除意图保留以便重连。无 Maintenance 的未纳管对象仍走原本地持久化。已纳管数据读取/写入失败会向用户报告，不会切换成旧副本写入；迁移冻结保持原有约束。

本阶段没有新增多 Vault 绑定、SM Adapter 或 SM 直连通道。未写用户 Vault，未部署或推送远端。

## 验证

- 当前依赖实体验证：本地链接 Core `0.3.12-rc2.19`、Bridge `0.4.0-rc2.1`，manifest 与 lock importer 同步。
- TypeScript 无输出类型检查通过；声明输出与 tsdown Host/Client 构建通过。
- 全套 `19` 个测试文件、`114` 条测试通过。新增覆盖共享服务晚挂载与替换、借用能力边界、handoff 回调和业务校验、无 Bridge 本地 CRUD、纳管存储失败不回退。
- 使用真实 Cordis fiber（`inject: []`）验证 Host 在没有 Bridge/Maintenance 时能启动，修正原有未注入属性读取；测试中替换 Remote Service 构造以避免真实 Host I/O。
- 既有 deep-link、普通 selection、迁移与远端持久化验证通过。未进行真实实例或用户 Vault 联调。

构建前核实 `lib` 是工作树内真实目录；清空目录的命令被执行策略拦截，随后使用原位构建并按明确文件名清理失效声明，未递归删除目录。原有私有轮询实现和对应测试已移除；共享队列/确认语义由统一 Bridge 的测试负责。
