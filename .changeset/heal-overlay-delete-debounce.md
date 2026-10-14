---
'@f8/web': patch
'@f8/ui': patch
'@f8/core': patch
---

Dragging unrelated sliders (Vignette, Fade) no longer fires repeated DELETE heal-overlay requests: orphaned heal overlays are now purged exactly once per photo instead of being re-deleted on every slider tick.
