---
'@f8/web': patch
'@f8/ui': patch
'@f8/core': patch
---

Analysis of whether the White Balance and Lightness auto adjustments would benefit from ML: White Balance (learned illuminant estimation) would gain the most, Lightness less so, and the cheapest near-term win is applying the existing heuristics per subject/background mask. No behavior changed.
