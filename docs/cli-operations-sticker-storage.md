# 普通贴纸 profile 存储与旧数据迁移

本说明对应 `0.7.4-rc2.12` 发行包。运行环境为 DSH 0.1.5-rc.2 / web；实际安装状态另见部署回执。

默认存储现在使用 Bridge 已核验的 `runtimeIdentity.profileId`，目录是 `<DSH_HOME>/plugin-data/dsh-session-sticker-board/profiles/<profileId 的 SHA-256>`。精确区分大小写及包含路径字符的 profile，不能用显示名称或推测的 `web` 替代。显式配置 `storageDirectory` 的既有安装仍读取该目录，不自动搬迁或改写它。

旧默认目录 `<DSH_HOME>/plugin-data/dsh-session-sticker-board/sessions` 没有 profile 归属；记录中的可选实例 ID 也不能证明同一 home 下的 profile。新版发现此类旧会话时返回 `STICKER_STORAGE_SCOPE_REQUIRED`，保留文件，阻止自动分配、复制及回链重投。**有旧默认数据的安装必须在切换新包之前完成下面的归属核对与迁移，不能直接升级后把“空列表”当作验收通过。**

## 离线迁移

1. 从正式实例身份核对 home 与目标 profile；确认旧目录所有会话和待删除回链属于该 profile。如果旧目录混入多个 profile，先在备份中人工核对分区，本工具不猜测归属。
2. 按 Launcher 正常流程停止所有共用这个 home 的实例/profile，保留 flush/drain/close 回执；不能通过杀进程或删除锁代替。`--offline-confirmed` 是操作者确认，工具不自动检查或停止运行实例。
3. 使用已构建源码目录或包含该工具的新发行包执行：

   ```text
   node scripts/migrate-storage.mjs --source "<核验的旧默认存储根目录>" --profile "<核验的 profileId>" --offline-confirmed
   ```

4. 核对输出中的 `profileId`、源/目标/备份目录、文件数及 `completed: true`。输出不含会话正文或连接令牌。再完成新包安装与正常启动，业务验收包括旧贴纸重开、待删除回链及冻结会话行为。

工具只复制 `sessions` 中的既有文档与 `.ownership` 冻结标记，按原字节备份并核对 SHA-256，保留 outbox 与 Vault 身份；**从不删除原始会话文件，也不覆写不同内容的目标文件**。`profile-migration.json` 在复制前记录整个来源目录的唯一明确归属；其他 profile 此后使用自己的空目录，不能再领取同一份旧数据。

同一来源用独占 `.profile-migration-lock` 防止并发归属。正常成功或失败会释放锁，进程崩溃留下的锁不会自动清除；先核对没有存活的迁移进程与所有回执再处理。失败后的同 profile 重试复用相同备份和待完成回执，拒绝来源变化及目标冲突；已完成的重试不覆盖随后正常修改的目标数据。若已完成目标文件遗失，默认存储明确报错，需核对备份恢复，不能声称重试已修复遗失。

源目录在迁移后继续保留为历史备份。旧版本若再次写入来源，默认读取会提示源数据已改变，不重新静默导入。回退旧包前也必须正常停机并处理新旧差异；本工具不提供自动反向合并。

## 本轮验证边界

合成临时目录已覆盖同 home 多 profile、大小写/路径字符隔离、旧数据归属阻断、原字节/outbox/冻结标记保留、独占并发、目标冲突、重试和旧来源后续变化。真实实例数据迁移、安装、贴纸 UI、真实回链和多 Vault 交互均未验收。
