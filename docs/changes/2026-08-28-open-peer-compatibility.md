# Sticker Board 0.2.1: version-open peers

All host, React, Typert, Cordis, and Annotation Core peer dependencies now use `*`. The fixed DSH compatibility declaration is removed, so experimental host and Core versions are admitted and judged by runtime behavior.

Development dependencies remain pinned to the verified baseline for deterministic builds. Annotation and sticker protocol versions remain explicit data contracts; they are not package-version gates.
