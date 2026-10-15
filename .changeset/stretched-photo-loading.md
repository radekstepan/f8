---
'@f8/ui': patch
'@f8/web': patch
---

Fixed photos briefly loading stretched across the canvas and then snapping to their correct dimensions. The cached instant preview no longer clears the loading state when it appears — the frame keeps its predicted aspect and the stale canvas stays hidden until the real paint lands — and the preview image covers the frame instead of stretching into it.
