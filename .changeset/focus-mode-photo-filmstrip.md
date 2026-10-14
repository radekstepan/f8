---
'@f8/core': patch
'@f8/web': patch
---

Focus Mode (Shift F) now strips the shell down to the open photo and the album filmstrip. Previously it only hid the side panels; the menu bar, toolbar, preset strip, and status bar now unmount too, the filmstrip is forced on even when normally closed, and the panel preferences are left untouched so leaving the mode restores the exact previous layout. A floating button offers the way out (Shift F and Esc still work).
