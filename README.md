# DSH Session Sticker Board（普通贴纸）

**0.7.4-rc2.9 · DSH 0.1.5-rc.2 · 依赖 Core + DSH Obsidian Bridge**

提供普通贴纸、正文/选文保存和笔记关联。通过 Core 接入选文与引用，通过共享 Bridge 交接 Obsidian；不依赖 Maintenance 或 Launcher。Better Sidebar 是可选展示位置，不是基础服务启动条件。

在会话中选中文字并选择普通贴纸动作，编辑后保存；使用插件入口查看贴纸和笔记关联。笔记跳转需要安装 Companion 并绑定 Vault。普通贴纸与 DAG 提供的会话贴纸职责分开，安装此包不会替代 DAG。

本批更新对齐独立会话数据接入和发布依赖。实际测试实例已验证加载正常；完整创建、编辑、删除及跨端回链组合仍须按使用场景验收，不以自动测试代替全部真实操作。

## 部署方法

**环境要求**：Node.js 24，可正常启动的 DSH `0.1.5-rc.2` / `web` profile。**必须先安装 Annotation Core 和 DSH Obsidian Bridge**，贴纸依赖这两者。Better Sidebar 是可选展示位置，不是启动条件。

从 [Release v0.7.4-rc2.9](https://github.com/linmu115/dsh-session-sticker-board/releases/tag/v0.7.4-rc2.9) 下载 `dsh-session-sticker-board-0.7.4-rc2.9.tgz`，然后：

```powershell
$env:DSH_HOME = '<你的 DSH_HOME>'
dsh plugin --profile web add ./dsh-session-sticker-board-0.7.4-rc2.9.tgz
```

安装顺序为 Core → Bridge → 贴纸。安装命令会把包写进 profile 并在 `dsh.profile.bundles` 注册，**不要**再手工插入同名插件节点。随后正常重启 DSH 使新版本加载。

**用法**：在会话中选中文字，选择普通贴纸动作，编辑后保存；使用插件入口查看贴纸和笔记关联。笔记跳转需要目标 Vault 已安装 Companion 并完成绑定。

普通贴纸与 DAG 提供的「会话贴纸」是两项不同功能，安装本包不会替代 DAG。

**更新**：停止 DSH，备份 DSH_HOME，`plugin add` 新 tgz，重启并刷新页面。
**卸载**：`dsh plugin --profile web remove dsh-session-sticker-board`。

完整说明（安装顺序、数据保留、故障定位）：[INSTALL.md](docs/INSTALL.md)。本批为预发布，当前能力和未完成验收见 [发布验证记录](docs/RELEASE-20260920.md)。
