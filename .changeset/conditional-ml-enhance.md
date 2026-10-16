---
'@f8/core': minor
'@f8/ui': minor
'@f8/web': minor
---

ML Auto Enhance is now conditional on subject instead of one global style: each learned edit is tagged with the photo's top ML label, so once three same-subject photos show a consistent habit, enhancing a similar photo generalizes their shared style onto it. Subjects with too little evidence fall back to the overall medians, and a ready subject enhance names whose style it applies.
