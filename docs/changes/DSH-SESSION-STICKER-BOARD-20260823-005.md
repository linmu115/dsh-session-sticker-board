# 0.1.4 Obsidian 官方协议回跳与贴纸反向链接

## 现象

在 DSH 贴纸详情中复制链接并粘贴到 Obsidian 后，点击 `dsh://open/...` 没有打开 DSH。

## 原因

`dsh://` 不是 Windows 已注册协议，只依赖 Obsidian 页面级 DOM 拦截。Obsidian 对未知协议
的链接处理发生在应用内部，页面拦截不能作为稳定的公开入口。

## 修复

- 新复制的贴纸链接改为 `obsidian://deepharness?session=...&anchor=...&quoteHash=...&sticker=...`。
- 参数仍只包含稳定会话 ID、消息锚点和引用哈希，不携带 Vault 路径或敏感数据。
- Obsidian 伴侣插件负责通过官方协议处理器打开内部 DSH Web Viewer并投递定位动作。
- 旧 `dsh://` 链接由伴侣插件继续兼容，不批量重写用户现有笔记。
- 贴纸详情底部新增反向链接列表，打开侧栏时自动加载，也可手动刷新。
- 点击反向链接时优先使用 Obsidian 块 ID；普通粘贴链接没有块 ID 时使用准确行列定位。
- 新链接按贴纸 UUID 精确识别；旧链接按会话 ID、消息锚点和引用哈希三元组识别。

## 回滚

回滚到 `change/DSH-SESSION-STICKER-BOARD-20260823-004` 可恢复旧链接格式；Vault 中已有
贴纸与引用内容不会被删除。
