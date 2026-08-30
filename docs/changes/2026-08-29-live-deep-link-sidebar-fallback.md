# 0.4.2 - Live deep-link sidebar fallback

The first 0.4.1 live validation showed that the root DSH context does not always expose Better Sidebar through `get()`, even though the injected service is active. The plugin now retains that injected service and also detects the sidebar's stable DOM contract as a runtime fallback. Existing version-open integration remains unchanged.

Verified behavior: an Obsidian deep link can collapse the visible plugin drawer before the target conversation message is located.
