---
'@f8/core': patch
'@f8/web': patch
---

Heal e2e waits no longer fail the suite on a transiently unreachable test hook: `waitForHealingStart`, `waitForHealingDone`, `waitForMlReady`, and the heal-queue call-count poll now treat a missing `window.__f8Test` as "not yet" and keep polling (via the new `healWaitStarted`/`healWaitSettled` core helpers) instead of throwing a `TypeError` on one tick.
