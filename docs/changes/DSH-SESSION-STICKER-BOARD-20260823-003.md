# 0.1.2 选区按钮被 sidechat 遮挡

## 现象

在 DSH 消息中选择文字后，只能看到 dsh-sidechat 的“添加到对话”和“在侧边聊天中提问”，
看不到 dsh-session-sticker-board 的“添加贴纸”。

## 原因

两个插件都把选区工具栏定位在选区正上方。贴纸插件还在根容器上设置了
`position: relative; z-index: 0`，形成低层叠上下文。子按钮自身的 `z-index: 70`
无法越过该上下文，因此被 sidechat 工具栏完整遮住。

## 修复

- 删除贴纸根容器的低层叠上下文，让固定定位按钮参与页面浮层栈。
- 检测 `[data-dsh-sidechat] [role="toolbar"]`；存在时把“添加贴纸”排在该工具栏上方。
- 页面顶部空间不足时，自动把“添加贴纸”放到选区下方。
- 增加无 sidechat、正常向上避让、顶部向下避让三种定位回归测试。

## 验收

在同一条已完成消息内选择一小段非空文字，应同时看到：

1. 添加贴纸
2. 添加到对话
3. 在侧边聊天中提问

三个入口不得互相遮挡。

实际结果：

- `pnpm typecheck`：通过。
- `pnpm test`：7 个测试文件、24 项测试通过。
- `pnpm build`：通过，生成 `lib/client.js`。
- `pnpm knowledge:install`：安装 `dsh-session-sticker-board@0.1.2`，维护引擎状态为 healthy。
- 安装包 SHA-256：`F97D1603134C0C2BB856F2226B1E43CDB329D455301EDA0752AD1A60DFC8036F`。
- 冷启动 EAC 后，在真实 assistant 消息中选中 `PDF 查看界面点一条`，无点击写入操作；
  accessibility tree 同时返回“添加贴纸”“添加到对话”“在侧边聊天中提问”，截图确认三者未遮挡。
