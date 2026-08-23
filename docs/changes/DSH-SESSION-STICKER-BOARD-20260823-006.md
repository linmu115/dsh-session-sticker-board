# 0.1.5 原生 WikiLink 贴纸引用

## 现象

Obsidian 笔记里只有 `obsidian://deepharness` 可执行链接时，点击可以回到 DSH，但 Obsidian
原生反向链接系统不会把它识别为对贴纸伴生块的引用，DSH 侧因此看不到可靠反链。

## 原因

外部协议链接用于执行动作，不属于 Obsidian 内部 WikiLink 图。用文本扫描外部协议重建反链
会重复 Obsidian 的索引工作，也无法自然参与 Obsidian 的链接图和重命名维护。

## 修复

- 新增稳定贴纸 WikiLink：`[[DeepHarness/Sessions/<session>#^dsh-sticker-<id>|贴纸来源]]`。
- “复制笔记链接”复制原生 WikiLink和 `obsidian://deepharness` 回跳链接，两者职责分离。
- “复制引用 Markdown”的引用块增加 `来源` WikiLink。
- 反向链接只依赖原生 WikiLink，不再依赖外部协议文本扫描。

## 验证

- DSH 类型检查、单元测试和生产构建通过。
- 覆盖 WikiLink、回跳链接和完整引用 Markdown 的剪贴板契约。

## 回滚

回滚到 `change/DSH-SESSION-STICKER-BOARD-20260823-005` 可恢复 0.1.4。回滚代码不会修改
Vault 中已粘贴的 WikiLink 或贴纸伴生笔记。
