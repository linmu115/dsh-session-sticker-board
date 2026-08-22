# DSH-SESSION-STICKER-BOARD-20260823-002

## 问题

浏览器插件把 Obsidian Bridge 固定为 `127.0.0.1:27124`。Windows Hyper-V/WSL/容器网络可能把该端口纳入动态保留范围，导致 Obsidian 报 `listen EACCES`；即使手工修改 Obsidian 设置，DSH 端仍会继续访问旧端口。

## 修复

- 默认端口移到 `18473`。
- 浏览器构建支持 `DSH_OBSIDIAN_BRIDGE_PORT`，由维护引擎把经过本机检测的端口固化进安装产物。
- 构建时验证端口范围和替换标记，避免生成两端配置不一致的包。

## 验证

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- 使用非默认端口构建后，确认 `lib/client.js` 只引用指定 Bridge origin。
- 真实 EAC 4.4.1 / DSH 0.1.1-rc.2 冷启动后，划选会话内容出现“添加贴纸”。
- 已安装 `lib/client.js` 指向 `http://127.0.0.1:18473`，与 Obsidian Bridge 一致。

## 回退

回退到 `change/DSH-SESSION-STICKER-BOARD-20260822-001`。
