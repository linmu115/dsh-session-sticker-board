# 历史 README：不作为当前安装教程

# DSH Session Sticker Board

本轮独立组件升级候选及边界见[2026-09-20 架构升级](docs/changes/2026-09-20-independent-components.md)。源码候选不代表运行副本已升级。

当前 0.7.4-rc2.5 在原 peer 范围中加入 Bridge 0.4.1-rc2.3。运行源码保持不变；123 项测试、类型检查与本机两包严格依赖安装通过，真实运行插件 active。后续条目保留各版本历史。

## 0.7.4-rc2.3：独立 Sticker 与单一 Bridge

本插件独立安装，普通贴纸功能同时需要 **Annotation Core、dsh-obsidian-bridge 0.4.1-rc2.1、Better Sidebar**。三者缺席时界面等待依赖就绪，不把缺失配置当作完整可用；服务晚加载后自动接入，卸载后释放界面。Maintenance 仍可选。无需分别安装 Suite、Reference Adapter、Lifecycle 或 Protocol，已有贴纸数据和归属保护不变。见 [包边界与验证](docs/changes/2026-09-18-single-bridge-package.md)。


## 0.7.4-rc2.2：多 Vault 笔记关联

搜索和回链保留每条笔记的 Vault 身份；打开、关联和引用固定到该目标。旧关联没有归属时，请选择正确的 Vault，系统核验笔记身份后保存选择。旧贴纸同步与迁移保存所选 Vault；删除回链按原目标集合逐一确认。详情见 [路由与恢复报告](docs/changes/2026-09-18-vault-routing.md)。

## 0.7.4-rc2.1：统一 Bridge 通道

普通贴纸与笔记关联的界面、归属校验和数据操作继续由 Sticker Board 维护。Obsidian 请求借用 **Bridge Lifecycle 0.4.0-rc2.1** 的共享通道；贴纸只注册自己的定位处理器，不再创建连接、轮询或确认公共队列。关联笔记的引用通过 Bridge 交接给 Core，由 Core 保持引用状态、提交与失败补偿。通用 Obsidian 健康页由 Bridge 提供。

此段描述前序构建：当前普通贴纸依赖 Core、Bridge、Better Sidebar 三者，未满足时等待就绪。Maintenance 可选，待删除的回链保留在本地队列。已纳管会话仍遵守 Maintenance 与迁移冻结协议，不会因服务缺席改写旧副本。接入共享通道需要上述新 Bridge 版本，不兼容旧版 Bridge 接口。

本轮仅本地构建验证，未发布或部署；详细边界和验证见 [施工报告](docs/changes/2026-09-18-shared-bridge-channel.md)。下文旧组合版本描述保留为前序功能背景，不作为本轮依赖安装清单。

## 当前功能归属

自 0.7.3-rc2.19 起，本插件保留普通贴纸、普通贴纸旧数据迁移和 Obsidian 双向链接。会话贴纸面板、跨会话蓝色来源标记由 ThoughtDAG 0.4.14-rc2.14 提供；原有 stickers 对象身份与数据不迁库。旧贴纸冲突处理入口为「贴纸与笔记链接 → 迁移旧贴纸」。

本补丁配套 Annotation Core **0.3.12-rc2.12**，跨会话引用选择器使用 DSH 会话栏的可读标题。见[组合兼容说明](docs/changes/2026-09-15-picker-title-cohort.md)。

在 DSH 中保留原文高亮、Markdown 贴纸和会话入口，并把选中的已完成回复连接到另一个真实会话。配套 ThoughtDAG 可显示接收会话的上下文主干；Obsidian 的笔记引用、回链和会话贴纸关联由对应 Bridge 服务协作完成。

当前源码版本为 **`dsh-session-sticker-board` 0.7.3-rc2.18**，本定制分支的验证基线为 **DeepSeek Harness 0.1.5-rc.2**。这里的版本指当前代码及本地验证包，不表示相同版本已发布到 npm 或提供公网下载。早期 0.6.x / DSH 0.1.2-alpha.1 的说明不能作为本轮安装依据。

## 三种入口

| 入口 | 用途 |
|---|---|
| 普通贴纸与红色符号 | 为原文选区添加 Markdown、标签和高亮；查看与维护贴纸、Obsidian 回链。 |
| 会话贴纸 | 从标题栏 **会话贴纸** 管理真实会话入口，选择已有会话，或先选工作区再创建独立会话。 |
| 来源蓝色引用符号 | 标记哪些会话引用了这段已完成回复，进入对应真实会话，或精确删除其中一条引用。 |

普通贴纸、会话贴纸对象、上下文引用与真实会话有不同用途。删除一个贴纸对象不等于删除真实会话；要解除某条跨会话引用，应使用蓝色符号或图中对应连接的删除操作。

## 配套组件

| 组件 | 本轮本地验收版本 | 用途 |
|---|---|---|
| DeepSeek Harness | 0.1.5-rc.2 | 原生工作区、会话与输入框 |
| 本插件 | 0.7.3-rc2.18 | 贴纸、会话选择与蓝色来源入口 |
| Annotation Core | 0.3.12-rc2.12 | 统一引用气泡、发送与授权恢复 |
| Maintenance 插件 / Engine | 0.2.26-rc2.15 / 0.1.33-rc2.19 | 会话贴纸存储、固定来源、关系撤销及归档同步 |
| ThoughtDAG | 0.4.14-rc2.8 | 可选的会话主干图视图 |

使用完整 Obsidian 工作流时，还需配套：

- **dsh-obsidian-bridge 0.4.1-rc2.1**：统一连接、绑定、Obsidian 引用与业务信息页；通过同一个服务接入 Sticker。
- [Obsidian 伴侣插件](https://github.com/linmu115/obsidian-deepharness-bridge/tree/codex/dsh-0-1-5-rc2)：安装到实际使用的 Vault。
- [Better Sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)：普通贴纸所需的侧栏服务。

会话贴纸与跨会话来源保存在当前实例的 Maintenance 中。基础会话贴纸不要求 Obsidian 在线；笔记打开、镜像和回链能力需要相应 Bridge。不要把其它实例的 Home、Engine 或 Vault 连接混入同一组合。

## 安装与首次设置

本轮应使用同批构建并验证的本地包。通过 Launcher 更新目标实例的包组合，或在该实例原有的 Home/profile 环境里使用本地 `.tgz` 文件。若本插件已经是 Suite 的子成员，应随 Suite 更新，保留父子拓扑，不要另加一个重复的顶层成员。

源码开发时，先准备配套 RC2 依赖，再执行：

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm pack
```

`pnpm test` 和 `pnpm pack` 会执行项目配置的构建步骤；打包生成本地 `dsh-session-sticker-board-0.7.3-rc2.18.tgz`。部分配套 RC2 依赖不一定存在于公开注册表，需要使用同批本地包或已配置的工作区依赖。

对于已有依赖、且没有将本插件作为 Suite 子成员的 profile，可在包所在目录执行：

```sh
dsh plugin --profile web add ./dsh-session-sticker-board-0.7.3-rc2.18.tgz
```

完成同批更新后重启目标 DSH 实例并刷新页面。裸包名或 `@latest` 不保证取得这个定制组合；本文没有提供尚未确认发布的下载地址。

如果使用 Obsidian：

1. 在 Vault 的 **DeepHarness Bridge** 设置中确认 Bridge 已启动。
2. 核对 DSH 插件连接与 Obsidian 显示的 **Bridge Origin** 完全一致；默认地址为 `http://127.0.0.1:18473`，实际配置优先。
3. 按配置流程连接当前实例。贴纸本地修改可在 Bridge 暂时离线时继续；涉及笔记镜像和回链的操作会显示同步状态并在恢复连接后重试。

## 会话贴纸：开始一段真实对话

从会话标题栏打开 **会话贴纸**，可以选择已有会话，或点击 **新建独立会话**：

1. 已有会话按“工作区 → 会话”分页选择。
2. 新会话先选择工作区，再点击 **在「工作区」中新建会话**；取消选择不创建。
3. 点击已保存的会话贴纸，进入完整原生会话页。这里没有另一套独立聊天输入框，也不替用户发送。
4. 删除、恢复列表中的贴纸只修改贴纸对象，保留真实会话。笔记关联的卡片还显示来源笔记及短选文，**打开来源笔记** 是单独操作。

从 Obsidian 笔记选段建立的会话贴纸属于知识关联，单纯打开贴纸或来源笔记不会把内容自动交给模型。

## 从已完成回复建立跨会话引用

1. 在来源会话 X 的已完成助手回复内选择文字，使用选区的会话贴纸入口。
2. 选择接收会话 Y，或先选择工作区、确认创建独立会话。创建前会核对来源回复是否完整保存。
3. 插件保留所选回复的固定版本、真实消息位置和选文，建立引用后进入 Y 的真实会话。
4. 引用显示在目标输入框的统一气泡中。检查草稿后自行发送；已有正文和附件保留，不自动发起模型回答。

来源选文长度为 1–4,000 字。确认的来源版本和已完成回复截止不会因 X 后来追加消息而扩大。首轮材料在预算内包含所选回复所在问答，此前获准历史由模型通过工具按需读取，而非复制全部来源历史。准备状态不等于已交付；实际范围可从 ThoughtDAG 对应边的读取日志查看。

X → Y 属于 **Y 的主干**。安装 [ThoughtDAG 定制分支](https://github.com/linmu115/thoughtdag/tree/codex/rc2-maintenance-graph) 后，从标题栏 **思维图** 可看到来源在上、接收方在下的布局，并通过卡片/空白/边右键管理。图和贴纸面板跟随 DSH 的明暗主题。

## 蓝色符号：跳转、精确删除与同步

引用成功后，回到 X 可看到选文高亮与蓝色来源符号。普通贴纸保留红色符号；同一选区已有普通贴纸时，不覆盖其高亮颜色。

- 一个目标：点击蓝色符号进入该真实会话。
- 多个目标：先选择目标会话；同一目标的多条引用在跳转列表中去重。
- 右键符号：选择 **进入会话** 或 **删除引用**。删除保留每条独立引用，同名目标可按引用序号区分。
- 菜单支持方向键、Home/End、Escape、菜单键和 Shift+F10。

删除先等待服务器确认精确引用已撤销，再更新蓝色符号与目标主干。同一选文的其他引用、普通红色贴纸、剩余引用和普通贴纸所需的高亮，以及源正文保留。最后一条引用解除后，不再保留仅属于该引用的蓝色入口。失败时原符号及菜单保留，可重试；本地气泡清理尚未完成时会提示，不把已成功的撤销当作失败或恢复引用。

来源打开、窗口恢复、页面重新可见和引用事件都会核对蓝色入口；可见页面每 15 秒补充刷新。临时断线不被当作删除，导航前仍会重新检查权限。

原生 DSH 或 Maintenance 归档会话时，会撤销以该会话为来源或目标的活动引用、清除相关待绑定连线并归档自身主干。蓝色入口与图自动同步。已经打开的主干变为只读并保留未保存布局；恢复会话不会复活已撤销引用或已清除连接。

## 普通 Markdown 贴纸与 Obsidian 回链

在用户或助手消息内选择文字并添加普通贴纸，可编辑 Markdown、标签和高亮颜色。多行、列表及跨加粗节点的选区通过真实文字位置恢复；消息旁的普通贴纸按钮可打开详情。

**复制笔记链接** 生成可粘贴到 Obsidian 的受管链接；详情可查看反向链接并跳转到相应笔记。删除普通贴纸先提交 DSH 本地状态，在线时同步清理回链，离线时保留待同步任务。旧贴纸迁移按会话显式执行；若本地与 Vault 内容冲突，先选择保留哪一份，迁移后由 Maintenance 保存，避免两处继续写入。

从 Obsidian 文段引用到 DSH 的流程由 Reference Adapter 负责：引用进入统一气泡，发送、快照校验和回链遵循 Adapter 的规则。它与从 DSH 回复建立的固定跨会话引用是不同来源类型，详见 [Reference Adapter 使用说明](https://github.com/linmu115/dsh-obsidian-reference-adapter/tree/codex/rc2-session-context-graph)。

## 常见问题

| 情况 | 处理方式 |
|---|---|
| 没有会话贴纸或统一气泡 | 检查当前实例的 Maintenance 与 Annotation 能力及配套版本，完成同批更新后重启。 |
| 开始已有会话时提示提交记录缺失 | 使用本轮配套 Core 的权威授权恢复；从图刷新并重试，不手工改绑或重新发送旧引用。 |
| 删除后蓝色入口仍在 | 先看是否有另一条独立引用；如果显示同步错误，重试并核对服务器状态。 |
| 已归档会话不能进入 | 先从会话列表恢复。恢复不恢复旧引用，需要时明确重新建立来源。 |
| 看不到右侧普通贴纸详情 | 启用可选 Better Sidebar，或使用浮层入口。 |
| Obsidian 打不开或回链未同步 | 核对 Bridge 状态、Origin、当前实例/Vault 配对及连接状态；基础会话贴纸仍可独立使用。 |

## 开发与验收记录

本轮 Sticker 全量 **140 项测试**、类型检查与构建通过。合成测试覆盖工作区选择、取消与重试、固定来源、蓝色符号多目标、精确删除、服务失败保留和键盘菜单；真实业务删除/归档交互与公开发布不由这些测试替代。

- [先选工作区再创建会话](docs/2026-09-14-workspace-first-session-stickers.md)
- [来源蓝色符号与恢复](docs/2026-09-14-source-reference-markers.md)
- [蓝色符号右键删除](docs/2026-09-15-source-marker-context-menu.md)
- [笔记选段会话贴纸](docs/changes/2026-09-14-note-selection-sticker-display.md)
- [整组生命周期与副本验收](https://github.com/linmu115/dsh-session-maintenance/blob/codex/rc2-session-context-graph/docs/reports/2026-09-15-graph-reference-lifecycle-release.md)

[MIT 许可](LICENSE)

本次配套更新支持 Maintenance 的轻量引用目录，详见[兼容变更说明](docs/changes/2026-09-15-maintenance-reference-directory.md)。
