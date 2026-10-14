---
'@f8/core': patch
'@f8/web': patch
---

Undoing a Denoise apply now takes effect on the photo immediately. Previously the pixels-to-recipe sync re-stored the denoised strength right after the undo cleared it, so the photo stayed denoised (and the redo stack was lost).
