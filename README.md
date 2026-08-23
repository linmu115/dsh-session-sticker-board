# DSH Session Sticker Board

DSH 会话只读覆盖层：为消息提供持久高亮、贴纸、Obsidian 引用与精确回跳。

在消息内选择文字后，`添加贴纸` 会与 dsh-sidechat 的选区工具栏错位排列，避免被
`添加到对话 / 在侧边聊天中提问` 覆盖。

已有贴纸显示为无编号的引用图标。点击后会打开或聚焦 dsh-better-sidebar 中的
`贴纸`详情页，可编辑 Markdown、标签和高亮颜色；侧栏不可用时自动回退到原浮层菜单。

“复制笔记链接”生成 `obsidian://deepharness?...`，由 Obsidian 伴侣插件的官方协议入口
打开或聚焦 Obsidian 内的 DSH Web Viewer，再定位到原消息。

贴纸详情下方显示引用当前贴纸的 Obsidian 笔记。点击反向链接时优先定位到稳定块 ID，
没有块 ID 时回退到链接所在行；列表可手动刷新，旧版无贴纸 UUID 的链接继续兼容。

本仓库由 DSH Maintenance Engine 独立维护。首版只通过本机 Obsidian bridge 保存知识层数据，不修改 DSH 原始会话。

Bridge 默认监听 `127.0.0.1:18473`。维护引擎安装时会先检测端口，并通过
`DSH_OBSIDIAN_BRIDGE_PORT` 把最终选择写入浏览器产物，使 DSH 和 Obsidian 始终使用同一端口。
