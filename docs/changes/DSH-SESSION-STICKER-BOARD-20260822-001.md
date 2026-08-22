# DSH-SESSION-STICKER-BOARD-20260822-001

## 目标

建立 DSH 会话贴纸插件的独立仓库、包身份和双向知识协议 v1 基线。

## 基线

- 修改前：仓库不存在。
- 修改后：`dsh-session-sticker-board@0.1.0`，协议版本 `1`。

## 改动

- 添加独立 pnpm workspace、锁文件、TypeScript 与 Vitest 配置。
- 定义 deep-link、open-note、pending-citation、resolved-citation 和 session-note 消息。
- 定义贴纸 UUID、消息锚点、引用哈希、颜色、标签和 Vault 位置字段。
- 添加 Obsidian bridge client：短期 token 自动续期、401 单次重握手、FIFO apply/ack 和可见性轮询退避。
- 添加 session-note 读写、resolved citation 回传与 Obsidian 笔记打开请求。
- 添加 node/seq、quote hash 与 occurrence 组成的稳定消息锚点，重渲染后可重建选区。
- 添加不可变贴纸状态快照；删除只重排显示编号，不改变其他贴纸 UUID。
- 添加 rc.2 客户端窄接口镜像，不从 `@deepseek-ai/*` 动态导入运行时模块。
- 添加 `user`、`steering`、`assistant-step` 单消息选段捕获、四色持久高亮和错位红点。
- 添加 Markdown 贴纸编辑、标签、颜色选择、关联笔记打开、逻辑链接/引用 Markdown 复制和删除确认。
- 添加 Codex 风格引用托盘：卡片可删除、悬停查看全文，删除后显示编号自动顺延。
- 使用私有原生 reference codec 将 Obsidian 选段序列化进模型上下文；输入框中的内部引用占位符和 `@` 均隐藏。
- 在发送事务开始时记录 conversation 基线，只在真实的新 `user` 节点落地后回传 resolved citation。
- 添加每会话 revision 工作区；Vault 保存失败时不提交本地新增、编辑或删除。
- 添加 DSH host/client 双入口构建、Cordis patch 和客户端依赖纯度保护。
- 添加 `dsh://` deep-link 状态机：打开目标会话、最多回载 50 页、校验 quote/full-message hash、精确滚动并闪烁 2 秒。
- 成功定位后自动打开目标消息红点；已删除会话、缺失锚点、内容变化和 DOM 未就绪均返回可诊断状态。

## 验证

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm --dir ..\.. vitest run tests/knowledge-protocol-contract.test.ts
```

Task 7 本地验证结果：23 个插件测试通过；`lib/client.js` 仅引用 React 平台模块，没有 `@deepseek-ai/*` 值依赖或 Node 内建模块。

## 回退

首个提交是仓库基线；后续通过 Git 标签和 DSH Maintenance generation 选择旧提交，不直接修改已发布产物。
