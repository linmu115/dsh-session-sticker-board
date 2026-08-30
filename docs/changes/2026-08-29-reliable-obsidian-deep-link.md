# 0.4.1 - Reliable Obsidian deep links

- Obsidian deep links now collapse an open Better Sidebar before locating the target message, so the native conversation is visible on narrow and desktop layouts.
- Annotation opening is awaited after message location and uses Core's session-addressed API when available. This also restores cold references after a Harness restart.
- Core and Better Sidebar integration remains capability-detected at runtime. No peer version is locked, and older combinations keep their existing fallback behavior.
- Regression coverage verifies the reveal, locate, and annotation sequence as well as the no-op path when the conversation is already visible.
