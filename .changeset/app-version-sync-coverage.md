---
'@f8/core': patch
---

The top-right version indicator stays pinned to the changesets-managed app version: the release-time sync step is now covered by an automated test, so a future `yarn version-packages` cannot silently stop updating the displayed version.
