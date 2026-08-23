# 0.1.3 贴纸右侧栏详情与无编号引用按钮

## 现象

消息旁的贴纸入口显示连续编号，点击后只出现贴近消息的浮层菜单。贴纸较长时不适合持续
阅读和编辑，也无法复用 DSH 已有的右侧工作区。

## 原因

0.1.2 只有页面覆盖层和 Obsidian bridge 工作区，没有向 `dsh-better-sidebar` 注册贴纸
标签类型。按钮的交互目标因此只能是覆盖层内部的 `StickerMenu`。

## 修复

- 将贴纸入口改为无数字的 Lucide `Quote` 图标，保留稳定 `stickerId` 和精确锚点。
- 通过 Cordis 可选注入消费 `betterSidebar`，注册隐藏的单实例 `贴纸`标签页。
- 点击引用图标时创建或复用同一标签页，通过 `tab.meta.stickerId` 切换当前贴纸，并使用
  内容型 `path` 请求让已折叠的右侧栏自动展开。
- 详情页支持编辑 Markdown、逗号分隔标签和四种高亮颜色，保存继续调用同一个
  `StickerWorkspace.save()`，因此保留 Vault revision 冲突保护。
- 详情页保留打开关联笔记、复制 DSH 链接、复制引用 Markdown 和删除引用操作。
- 当 `betterSidebar` 不存在、被禁用或缺少 `updateTab/tabMeta` 能力时，点击自动回退到
  原有浮层菜单；新建贴纸仍使用原浮层编辑器。

## 关键位置

- `src/client/sticker-sidebar.tsx`：侧栏注册、单实例聚焦、贴纸定位和详情编辑。
- `src/client/overlay.tsx`：无编号引用按钮与侧栏/浮层降级分流。
- `src/client/index.tsx`：可选服务注入和共享 StickerWorkspace 装配。
- `src/client/styles.css`：引用按钮和侧栏详情布局。
- `tests/sticker-sidebar.test.ts`：标签页切换及降级规则。

## 回滚

回滚到标签 `change/DSH-SESSION-STICKER-BOARD-20260823-003` 可恢复 0.1.2 的数字按钮和
浮层菜单。回滚不删除 Vault 中的贴纸记录，也不改变 Obsidian 伴侣插件。

## 验收

- `pnpm typecheck`：通过。
- `pnpm test`：8 个测试文件、26 项测试通过。
- `pnpm build`：通过，生成包含侧栏详情的 `lib/client.js`。
- `pnpm knowledge:install`：已把 `dsh-session-sticker-board@0.1.3` 安装到
  `C:\Users\19717\.dsh\profiles\web-desktop`，Bridge 保持在 `127.0.0.1:18473`。
- 冷启动 EAC 后插件正常加载；用户在真实会话中确认无编号引用按钮、右侧栏跳转和编辑页
  功能正确。
