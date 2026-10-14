---
'@f8/core': patch
'@f8/web': patch
---

Generate thumbnail no longer returns the same photo every time: it now picks randomly from the most interesting tier (favorites first, else the highest rating) and skips the album's current cover while an alternative exists, so repeated clicks walk through the best candidates instead of repeating one.
