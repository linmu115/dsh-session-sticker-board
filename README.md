# DSH Session Sticker Board

把 DSH 会话变成可交互的笔记看板：可以为消息添加高亮和 Markdown 贴纸，也可以把 Obsidian 选段作为真正的模型上下文引用，并在 DSH 与 Obsidian 之间双向跳转。

## 兼容版本

- DeepSeek Harness 官方 `0.1.1-rc.2`
- `dsh-session-sticker-board` `0.2.x`
- `dsh-annotation-core` `0.1.x`

## 安装依赖

必须安装：

1. [`dsh-annotation-core`](https://github.com/linmu115/dsh-annotation-core)：统一的注释气泡、编号、发送和历史显示。它是基础组件，没有单独看板。
2. 本插件 `dsh-session-sticker-board`。
3. [`obsidian-deepharness-bridge`](https://github.com/linmu115/obsidian-deepharness-bridge)：安装到实际 Obsidian Vault，用于选段引用、保存贴纸和双向跳转。

推荐安装：

- [`dsh-better-sidebar`](https://github.com/omdsh-dev/DSH-better-sidebar)：提供右侧“贴纸”详情页。没有它时，贴纸仍可使用，但会回退到浮层菜单。

按 `dsh-annotation-core → dsh-session-sticker-board → dsh-better-sidebar（可选）` 的顺序安装 DSH 插件，然后安装并启用 Obsidian 伴侣插件，最后重启 DSH 和 Obsidian。

正式 npm 包发布后，使用标准 Profile Bundle 命令安装：

```sh
dsh plugin --profile web add dsh-annotation-core
dsh plugin --profile web add dsh-session-sticker-board
dsh plugin --profile web add dsh-better-sidebar
```

`dsh-better-sidebar` 是可选项；前两个包是完整引用与贴纸工作流的必需组件。

## 首次设置

1. 在 Obsidian 的 `DeepHarness Bridge` 设置中确认 Bridge 已启动。
2. 在 DSH 的插件设置中打开 `dsh-session-sticker-board`，确认 `Bridge Origin` 与 Obsidian 显示的地址完全相同。默认是 `http://127.0.0.1:18473`。
3. 重启 DSH。Obsidian 暂时未启动时，普通贴纸仍可加载；重新打开 Obsidian 后连接会自动恢复。

## 使用方法

### 在 DSH 中添加贴纸

在用户或助手消息内选择文字，点击“添加贴纸”。消息旁会出现无编号的贴纸按钮；点击它可在右侧栏查看和编辑 Markdown、标签与高亮颜色。

“复制笔记链接”会生成可粘贴到 Obsidian 的链接。Obsidian 笔记引用该贴纸后，贴纸详情下方会出现反向链接；点击后只切换 Obsidian 主编辑区的 Markdown 笔记，不会关闭 DSH Web Viewer 页签。

### 从 Obsidian 引用到 DSH

在 Obsidian 中选择一段文字并执行 DeepHarness 的引用命令。引用会进入当前 DSH 输入框上方的统一注释气泡，而不会变成输入框里的引用文本。

发送后：

- 选中文字、可选注解和整篇笔记快照会成为会话上下文的一部分；
- DSH 会在用户提问旁显示 `N 条注释`；
- Obsidian 笔记中会写入回到对应 DSH 提问位置的链接；
- 引用过的注释随会话历史保留，并遵循 DSH 的普通上下文压缩规则。

如果笔记在发送前发生变化，插件会使用最新版重新校验；Obsidian 离线时使用引用时保存的快照。内容过大时会明确阻止发送，不会静默截断。

## 常见问题

- 看不到统一注释气泡：确认 `dsh-annotation-core` 已安装、启用且版本为 `0.1.x`，然后重启 DSH。
- 看不到右侧贴纸页：安装并启用 `dsh-better-sidebar`；不安装时可使用贴纸浮层菜单。
- Obsidian 引用没有到达 DSH：检查两边的 `Bridge Origin` 是否完全一致，并确认 Obsidian Bridge 状态为已启动。
- 端口被占用：在 Obsidian 中换一个本机端口，再把同一地址填入 DSH 插件设置并重启。
