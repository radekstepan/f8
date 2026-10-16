---
'@f8/core': patch
'@f8/web': patch
---

Selective Color sliders drag with much less lag (the per-pixel color pass now runs from a per-render plan at ~1.8x the speed with identical output), and the range swatches show a single tight selection ring instead of the color circle plus a gapped yellow outline.
