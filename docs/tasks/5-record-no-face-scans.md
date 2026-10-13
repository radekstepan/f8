# Task 5: Record Enhance Faces scans that find no faces

## What changed

A face scan that finds nothing used to evaporate: the hook dismissed back
to idle, the section showed its generic explainer again, and the next visit
re-ran detection with no memory of the checked outcome. The empty result
is now saved in the recipe (`EditState.faceAdjust`), so it persists across
photo switches and reloads like any other edit.

- `FaceAdjustState` gains optional `checked: true`, meaning "detection ran
  and this record is its outcome" — including the empty outcome. New core
  helpers: `emptyFaceScan(source)` builds the record, and
  `isEmptyFaceScanStored(state, source)` detects an identical record so a
  re-store never stacks a duplicate undo entry.
- `isFaceAdjustStored` now also returns true for a checked record, so the
  section treats a recorded scan as applied info. `isFaceAdjustActive`
  stays pixel-based (a recorded empty scan is stored but never active),
  so the render pipeline and `isNeutralEdit` treat it as a no-op.
- `apps/web/src/App.tsx` auto-saves the empty outcome the moment detection
  resolves (one undo step + toast), mirroring the selective-mask auto-store:
  no Apply step for an empty result. The effect is the single storer — the
  context-menu auto-apply's zero-face branch only dismisses, because it runs
  in the same commit with a stale edit and storing there would double the
  undo entry. Clear on a recorded scan toasts "Recorded face scan cleared."
- `Inspector.tsx` shows a recorded empty scan as a `No faces found · ML`
  badge (no `· ML` for the classical scan) with Rescan and Clear but no
  enable toggle — there is nothing to bypass. The header `ML` button
  highlights with its revert icon, since highlight means "face adjust
  stored" and revert clears the recorded scan.

Files: `packages/core/src/types.ts`,
`packages/core/src/vision/face-exposure.ts` (+ tests),
`apps/web/src/App.tsx`, `packages/ui/src/components/Inspector.tsx` (+ tests).

## Decisions

- Auto-save on resolve rather than an explicit Save click: the selective
  mask already auto-stores its result, and an empty outcome has nothing to
  review — the badge plus toast is the confirmation.
- Reuse `faceAdjust` with a flag instead of a new `EditState` field: the
  applied plumbing (badge, header highlight, revert, undo, server persist)
  keys off that one field, so the change stays small and legacy recipes
  (no flag) behave exactly as before.
- An empty scan marks the photo non-Original (any `faceAdjust != null`
  does), consistent with a stored neutral selective mask: recorded scan
  state is recipe data, not a free annotation.
- No README change: one optional recipe flag plus an auto-save, no
  architecture or complex-feature change.

## Tests

- Core (`face-exposure.test.ts`, new `recorded empty face scans` block):
  factory shape, stored-but-never-active for both sources, legacy empty
  records still unstored, render + neutral no-op, same-scan guard
  (other source / stored hit / null all re-store correctly).
- UI (`faceEnhance.test.tsx`): recorded ML scan shows the badge without
  the toggle, with Rescan/Clear, highlighted header `ML` + revert;
  classical scan omits the `· ML` tag.
- `yarn workspace @f8/core test`: 812 passed (47 files).
- `yarn workspace @f8/ui test`: 214 passed (26 files).
- `yarn typecheck`: all 4 packages pass.
