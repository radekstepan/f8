---
'@f8/ui': patch
---

Enhance Faces no longer shows its Reset button or highlighted ML state after a scan that found no faces. Those indicators now appear only when faces were found and the enhancement was actually applied; an empty scan keeps its "No faces found" row with Rescan/Clear.

## Task writeup (docs/tasks/29-enhance-faces-no-faces.md)

## Request

If "Enhance Faces" finds no faces, why is the Reset button showing
and "ML" highlighted. It should only do that if we actually apply
any change.

## Answer

Fixed: a recorded no-face scan no longer lights the Enhance Faces
header. The section shows its "No faces found" content row with
Rescan/Clear as before, but the header ML button stays unhighlighted
(offering a fresh scan) and no section reset renders. The highlight
and reset now appear only when faces were found and the enhancement
was actually applied.

## Change

- `packages/ui/src/components/Inspector.tsx`: new `faceChanged`
  flag — `applied` is non-null **and** `applied.faces > 0` — now
  drives the Enhance Faces header (`ml.applied`, `ml.canRevert`,
  the ML/re-detect toggle routing, `onReset`, and `dirty`) instead
  of bare `Boolean(faceAssist.applied)`. The `applied` doc comment
  notes the faces-0 semantics. The content row, the auto-save of
  the empty scan in `App.tsx`, and the core `emptyFaceScan` /
  `isFaceAdjustStored` helpers are untouched.
- `packages/ui/src/components/faceEnhance.test.tsx`: the recorded
  no-face scan test now pins the quiet header (plain `ml-button`,
  `aria-pressed="false"`, "Automatically adjust…" tooltip, no
  `Reset enhance faces` control) alongside the existing
  Rescan/Clear assertions. The faces-1 highlight test already pins
  the applied branch, so both sides are covered.

## Decisions

- Kept the recorded empty scan (recipe entry + "No faces found"
  row with Rescan/Clear) rather than deleting the feature: the
  complaint was about the applied-change indicators, not the
  checked memory. A no-face scan is pixel-neutral and
  `isNeutralEdit`-clean, so the only lie was the header state.
- The header ML click on a recorded no-face scan now re-runs
  detection (via the `faceChanged` toggle routing) instead of
  clearing the record — matching its "run ML" tooltip. Clearing
  stays one click away in the content row.
- No README update: a bug fix with no behavior contract or
  architecture change beyond the header indicators.
