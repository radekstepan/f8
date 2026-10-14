---
'@f8/ui': patch
---

Curves points now remove on Shift-click or right-click instead of double-click: the double-click handler never fired because the drag captures the pointer to the graph element, which retargets the follow-up double-click event there. Removal now runs on the press itself (exact hits and near-misses within the grab radius), a right press on empty graph no longer drops a stray point, and the browser context menu stays suppressed over the graph. Keyboard removal with Delete/Backspace is unchanged.
