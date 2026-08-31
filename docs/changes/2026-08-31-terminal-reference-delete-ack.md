# 0.4.21 — 已缺失引用的终态确认

- 当 Annotation Core 返回 `deleted: false, scope: "sent"` 时，Sticker Board 现在向 Obsidian Bridge 发送同一引用身份的 `reference-delete-commit`，结束 Bridge 的持久删除墓碑。
- 终态确认失败时不会 ACK 原动作，Bridge 会继续投递；成功后才结束动作，保留原有的可重试语义。
- 正常 `deleted: true` 删除仍由 Core 的 committed-delete outbox 后台同步，不改变既有双端删除路径。
- Host 与 Web Viewer 两个动作消费者共用同一终态确认函数，避免由任一表面先消费动作时留下半完成状态。
