# 普通贴纸详情：同步恢复区按状态拆分

对应版本 **0.7.4-rc2.8**。依据用户报告：贴纸面板下方出现一大排以前没有的按钮——「旧贴纸所在 Vault / 请选择 Vault / 保存目标 / 重试同步」，其中 Vault 目标与「保存目标」只有在写入真正失败时才有意义。

定位：`src/client/sticker-sidebar.tsx` 的 `StickerDetailForm`。原实现的恢复区渲染条件是 `syncStatus === "conflict" || syncStatus === "error" || syncStatus === "local-only"`，而 `local-only` 既是同步前的默认状态（`sticker-workspace.ts` 的 `syncStatuses.get(id) ?? "local-only"`），也是桥不可用时的降级状态，因此只要会话还没同步干净就会渲染出迁移年代控件；Vault 选择还用无条件的 `workspace.selectVault && vaults.length > 0` 守卫。

改法（仅展示层）：新增 `showsVaultTarget` 与 `showsSyncRecovery` 两个派生值。恢复区只在 `conflict`/`error`（或 `local-only` 且确有 `syncIssue` 时保留只读详情）渲染；Vault 选择与「保存目标」只在 `conflict`/`error` 渲染；`conflict` 给出两个冲突选择，`error` 给出「重试同步」，`local-only` 不再给出任何操作，仅保留 `syncIssue` 的「查看同步详情」。冲突判定（`sticker-workspace.ts` 的 `revision-conflict` 分支）与 `conflict` 文案的出现条件未改动；**未**加入冲突自动重读合并重试。

验证：typecheck/build 通过；全套 24 文件 136 项通过（新增 `tests/sticker-sidebar-recovery.test.tsx` 5 项，覆盖 local-only 无 Vault 目标与无恢复操作、local-only 保留只读详情、conflict 保留冲突文案与两个选择及绑定 Vault 目标、error 有重试且无冲突文案、synced 无恢复区）。做了反向校验：把展示层临时改回旧逻辑后该文件 2 项失败（断言直接命中被渲染出的 `<select>` 与恢复区），恢复后重建且 `lib/client.js` 哈希与改前一致。本版本号 9 处已同步（package.json、README、docs/INSTALL.md、3 份合同测试），CHANGELOG 补 0.7.4-rc2.8 条目。

边界：未安装、未重启、未提交、未推送，未改 Vault 内 `main.js`/`data.json`/笔记，也未改 DSH 实例内任何文件。发行附件不由本仓库直接 `pnpm pack` 产出，而是走既有 `scripts/package-independent-release.py` 流水线（`lib` + `cordis.patch.yml` + 4 份文档，剥 `src`/`.map` 与 region 注释）；本轮 rc2.8 附件产出到 `artifacts/architecture-upgrade-20260920/independent-preview-r27/`，37 文件，与 r13 形态一致。
