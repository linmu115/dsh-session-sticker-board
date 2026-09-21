# DSH Session Sticker Board（普通贴纸）

**0.7.4-rc2.7 · DSH 0.1.5-rc.2 · 依赖 Core + DSH Obsidian Bridge**

提供普通贴纸、正文/选文保存和笔记关联。通过 Core 接入选文与引用，通过共享 Bridge 交接 Obsidian；不依赖 Maintenance 或 Launcher。Better Sidebar 是可选展示位置，不是基础服务启动条件。

在会话中选中文字并选择普通贴纸动作，编辑后保存；使用插件入口查看贴纸和笔记关联。笔记跳转需要安装 Companion 并绑定 Vault。普通贴纸与 DAG 提供的会话贴纸职责分开，安装此包不会替代 DAG。

本批更新对齐独立会话数据接入和发布依赖。实际测试实例已验证加载正常；完整创建、编辑、删除及跨端回链组合仍须按使用场景验收，不以自动测试代替全部真实操作。

## 安装、配置与使用

[完整命令行与手动安装教程](docs/INSTALL.md) · [下载本版本附件](https://github.com/linmu115/dsh-session-sticker-board/releases/tag/v0.7.4-rc2.7)

本批为预发布，安装顺序、数据保留、更新卸载和故障定位均在教程中。无需用户的 LLM 才能完成基础配置。当前能力和未完成验收见 [发布验证记录](docs/RELEASE-20260920.md)。
