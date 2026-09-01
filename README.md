# DSH Session Sticker Board

把 DSH 会话变成可交互的笔记看板：为消息添加高亮和 Markdown 贴纸，并在 DSH 与 Obsidian 之间维护贴纸回链。Obsidian 文段引用由独立的 `dsh-obsidian-reference-adapter` 负责。

## 兼容版本

- DeepSeek Harness（当前客户端基线为官方 `0.1.2-alpha.1`，安装不限制版本）
- `dsh-session-sticker-board` `0.6.x`
- `dsh-annotation-core`（按运行时能力探测，不锁定版本）

## 安装依赖

必须安装：

推荐直接安装 [`dsh-obsidian-session-reference-suite`](https://github.com/linmu115/dsh-obsidian-session-reference-suite) Bundle。它以一个父组组合：

1. `dsh-annotation-core`：通用引用状态、事务和基础上下文引用。
2. `dsh-obsidian-bridge-lifecycle`：外部 Bridge 状态、租约和热插拔附件。
3. `dsh-obsidian-reference-adapter`：Obsidian 文段引用、刷新、删除和回链。
4. 本插件 `dsh-session-sticker-board`：贴纸状态、UI 和贴纸回链。

此外还需把 [`obsidian-deepharness-bridge`](https://github.com/linmu115/obsidian-deepharness-bridge) 安装到实际 Obsidian Vault。

推荐安装：

- [`dsh-better-sidebar`](https://github.com/omdsh-dev/DSH-better-sidebar)：提供右侧“贴纸”详情页。没有它时，贴纸仍可使用，但会回退到浮层菜单。

Suite 的子插件顺序已经固定为 `Core → Lifecycle → Reference Adapter → Sticker Board`，卸载时逆序释放。然后安装并启用 Obsidian 伴侣插件，最后重启 DSH 和 Obsidian。

正式 npm 包发布后，使用标准 Profile Bundle 命令安装：

```sh
dsh plugin --profile web add dsh-obsidian-session-reference-suite
dsh plugin --profile web add dsh-better-sidebar
```

`dsh-better-sidebar` 是可选项；Suite 是完整引用与贴纸工作流的组合入口。

## 首次设置

1. 在 Obsidian 的 `DeepHarness Bridge` 设置中确认 Bridge 已启动。
2. 在 DSH 的插件设置中打开 `dsh-session-sticker-board`，确认 `Bridge Origin` 与 Obsidian 显示的地址完全相同。默认是 `http://127.0.0.1:18473`。
3. 重启 DSH。贴纸正文首先保存到当前 Launcher 实例自己的 DSH Home；Obsidian 暂时未启动时，创建、编辑和删除仍可用。重新打开 Obsidian 后，会话笔记镜像与双链会自动补同步。

## 使用方法

### 在 DSH 中添加贴纸

在用户或助手消息内选择文字，点击“添加贴纸”。消息旁会出现无编号的贴纸按钮；点击它可在右侧栏查看和编辑 Markdown、标签与高亮颜色。

“复制笔记链接”会生成可粘贴到 Obsidian 的受管链接。Obsidian 笔记引用该贴纸后，贴纸详情下方会出现反向链接；点击后只切换 Obsidian 主编辑区的 Markdown 笔记，不会关闭 DSH Web Viewer 页签。删除贴纸时先提交 DSH 本地记录，再由 Bridge 在线清理回链；Bridge 离线时清理与会话笔记镜像会等待重连，不会阻止本地删除。

多行、列表及跨加粗节点的选择使用规范化文字映射恢复到真实 DOM 范围，因此保存完成后仍会在原文位置显示高亮和贴纸按钮。

### 从 Obsidian 引用到 DSH

在 Obsidian 中选择一段文字并执行 DeepHarness 的引用命令。引用会进入当前 DSH 输入框上方的统一注释气泡，而不会变成输入框里的引用文本。

发送后：

- 选中文字、可选注解和整篇笔记快照会成为会话上下文的一部分；
- DSH 会在用户提问旁显示 `N 条注释`；
- Obsidian 笔记中会写入回到对应 DSH 提问位置的链接；
- 引用过的注释随会话历史保留，并遵循 DSH 的普通上下文压缩规则。

如果笔记在发送前发生变化，插件会使用最新版重新校验；Obsidian 离线时使用引用时保存的快照。内容过大时会明确阻止发送，不会静默截断。

## 常见问题

- 看不到统一注释气泡：确认 `dsh-annotation-core` 已安装并启用，然后重启 DSH；版本组合由运行时能力探测和实测结果决定。
- 看不到右侧贴纸页：安装并启用 `dsh-better-sidebar`；不安装时可使用贴纸浮层菜单。
- Obsidian 引用没有到达 DSH：检查两边的 `Bridge Origin` 是否完全一致，并确认 Obsidian Bridge 状态为已启动。
- 端口被占用：在 Obsidian 中换一个本机端口，再把同一地址填入 DSH 插件设置并重启。
