---
'@f8/ui': patch
---

Curves points now remove on double-click instead of right-click: the right-click handler never fired reliably (the browser context menu opened instead). Right-click on a point now only suppresses the menu; keyboard removal with Delete/Backspace is unchanged.
