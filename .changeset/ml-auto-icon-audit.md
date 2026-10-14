---
'@f8/ui': patch
'@f8/web': patch
---

Scene Enhance and Dust Spots now carry the Auto label instead of ML: neither runs a trained model (both use hand-tuned classifiers over classical heuristics), so their header buttons, menu entries, shortcut labels, and result copy say Auto. Subject & Background, Enhance Faces, One-Click Removal, super-resolution, and ML Repair keep their ML labels — those run real neural models.
