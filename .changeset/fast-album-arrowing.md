---
'@f8/core': patch
'@f8/ui': patch
'@f8/web': patch
---

Arrowing through an album is now faster with both a warm and a cold cache: the photos around the selection preload once navigation settles, every visited photo reopens from its cached last render (previously only repaired photos did), and the hidden Compare layer no longer repaints on every step.
