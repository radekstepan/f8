---
'@f8/ui': patch
'@f8/web': patch
---

Fixed photos still briefly loading stretched across the canvas before snapping to their correct dimensions. The old photo's pixels no longer fade out stretched into the new frame while loading (the canvas now hides instantly and the fresh paint still crossfades in), the Compare original layer stays hidden until the new photo is ready, and its backing store is cleared on photo switch so no stale frame can flash through.
