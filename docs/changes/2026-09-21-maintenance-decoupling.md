# 贴纸 0.7.4-rc2.9：移除 Maintenance 解耦残留

对应版本 **0.7.4-rc2.9**。本轮不再保留任何 Maintenance 耦合：插件只保存普通贴纸，笔记关联、笔记搜索、Vault 选择与旧贴纸迁移面板均不再属于本包。

## 删除面

- 客户端：`knowledge-links.tsx`、`knowledge-panel.tsx`、`knowledge.ts`、`linked-notes.tsx`、`linked-notes.css`、`note-scope.ts`、`unlink-note.ts`、`vault-choice.tsx`。
- 客户端构建：`tsdown.config.ts` 的 client `alwaysBundle` 去掉已退休的 `dsh-obsidian-bridge/api`。
- 测试：`knowledge-availability`、`knowledge-migration`、`linked-notes`、`projection-availability` 四份文件连同其用例一并删除。
- 同步调整 `bridge-channel`、`deep-link`、`index.tsx`、`remote.ts`、`sticker-workspace`、`styles.css`、`src/host/local-store.ts`、`src/remote/{service,typert}.ts` 及受影响用例。

## 保留的本地写入围栏

宿主 `StickerLocalStore.ownership()` 继续读取会话旁路的 `.ownership` 冻结标记：本包已不再写它（写入方随迁移面一起删除），但只要标记存在，`assertWritable` 与远程服务仍会拒绝重新写入本地副本，避免旧版本迁出后又被本版本复活成双写。标记损坏时的报错文案已改为不指向 Maintenance 的「贴纸归属登记损坏，暂停写入」。

## 版本与断言对齐

- `package.json` 版本 `0.7.4-rc2.8` → `0.7.4-rc2.9`；`README.md`、`docs/INSTALL.md` 的本批版本与附件名同步。
- 三处硬编码版本断言（`tests/bundle-contract.test.ts`、`tests/package-manifest.test.ts`、`tests/native-context-cohort.test.ts`）同步到 rc2.9。
- 两处标题仍在描述活的 Bridge/Maintenance 集成，改为描述真实剩余契约（未注入远端知识服务时本地 CRUD 仍可用）：`tests/sticker-workspace.test.ts`、`tests/host-optional-bridge.test.ts`。`tests/bundle-contract.test.ts` 中「Maintenance 已消失」的两条负向断言保持原样，只把注释说明为负向护栏而非活体集成。

## 验证

`tsc --noEmit` 零错误；构建产物重建；全套 20 文件 / 113 项通过；`src/` 内已无 `maintenance` 引用（`tests/bundle-contract.test.ts` 的负向断言按设计仍含该字符串）。

## 边界

未安装到活动 DSH profile、未重启或触碰运行中的 DSH、未推送、未打 tag、未产出发行附件。发行附件由独立发行流水线（维护于 Maintenance 仓库 `dsh-obsidian-bridge`，不在本仓库内）产出，本仓库不包含打包脚本；发行流程不在本轮范围。
