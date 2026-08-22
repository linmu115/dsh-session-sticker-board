# DSH Session Sticker Board

DSH 会话只读覆盖层：为消息提供持久高亮、贴纸、Obsidian 引用与精确回跳。

本仓库由 DSH Maintenance Engine 独立维护。首版只通过本机 Obsidian bridge 保存知识层数据，不修改 DSH 原始会话。

Bridge 默认监听 `127.0.0.1:18473`。维护引擎安装时会先检测端口，并通过
`DSH_OBSIDIAN_BRIDGE_PORT` 把最终选择写入浏览器产物，使 DSH 和 Obsidian 始终使用同一端口。
