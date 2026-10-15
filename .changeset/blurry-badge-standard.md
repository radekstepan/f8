---
'@f8/ui': patch
'@f8/web': patch
---

The blurry flag now looks the same everywhere: both the library grid and the photo-view heading show a monochrome warning icon plus "Blurry", replacing the red "Blurry · ML" grid pill and the amber "Might be blurry · ML" photo hint. Hovering the badge explains the flag and shows the detector's confidence (e.g. "Flagged blurry by ML cull assist · 80% confidence"); flags added by hand say "Marked blurry by hand" instead.
