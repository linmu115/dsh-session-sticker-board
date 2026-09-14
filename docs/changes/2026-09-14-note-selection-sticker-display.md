# 笔记选段会话贴纸的来源显示

配合 Companion 和共享合同的选段创建能力，完成系统审计 F07 的 Sticker 显示部分。版本暂不调整，交由组合发布统一处理。

- 会话贴纸的 `note` 显示来源笔记名；`noteSelection` 显示最多 240 个 Unicode 字符、最多三行的选文预览，截断时不拆开表情字符。
- “打开来源笔记”是独立按钮，通过现有认证桥接的 `knowledge('note-open', { noteId, blockId })` 定位稳定笔记和块。
- 贴纸主体仍打开完整原生会话页，删除和恢复仍只修改贴纸对象。
- 卡片说明这是知识关联，不自动加入模型请求。查看笔记不创建模型引用，也不修改用户草稿。
- 沿用现有 DSH 配色、卡片、窄屏布局和弹窗焦点管理。

## 验证

- TypeScript 类型检查及完整构建通过。
- 4 个迁移测试通过。
- 8 项合成浏览器流程通过，页面错误为 0。新增场景使用实际打包客户端、认证 Lifecycle 传输和真实 Companion `VaultKnowledgeStore`，用户数据和笔记 IO 均为合成 fixture。
- 新场景核对表情选文长度上限、来源笔记名、稳定块参数、来源按钮不关闭会话面板、主体打开原生会话及不自动新增模型引用/改草稿。
- 原有新建、挂接、删除/恢复、迁移、单处解除双链、窄屏、深色和 Escape 返回焦点场景继续通过。

stdout 和截图保存在 `D:/AI/DeepSeekHarness-Plugin/artifacts/system-fixes-20260914/sticker/`：`typecheck.log`、`build.log`、`knowledge-migration.log`、`browser.log`、`browser/verification.json`。浏览器测试等待真实认证桥接响应完成后才断言来源已打开。

没有修改真实 Vault、操作副本或调用模型。本改动不负责 Companion 端选区创建/持久意图；该部分由配套仓库实现。
