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

## 验证

```powershell
pnpm typecheck
pnpm --dir ..\.. vitest run tests/knowledge-protocol-contract.test.ts
```

## 回退

首个提交是仓库基线；后续通过 Git 标签和 DSH Maintenance generation 选择旧提交，不直接修改已发布产物。
