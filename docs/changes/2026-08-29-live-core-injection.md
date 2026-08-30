# 0.4.3 - Live Annotation Core injection

Obsidian deep links now wait for the live `annotationCore` service instead of
capturing a one-time lookup during plugin startup. A deep link carrying an
annotation set remains pending until Core is available, then opens the exact
session, set and reference.

Conversation reveal now treats Better Sidebar's mounted body attribute as the
authoritative visual state. This avoids stale per-session service snapshots
leaving the plugin manager panel open over the referenced message.
