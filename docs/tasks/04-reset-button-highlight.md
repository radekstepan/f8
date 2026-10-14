# Task 4: Reset button stays highlighted after "Reset to original"

## Root cause

Two defects combined so the Reset button never de-highlighted after a reset
(the report named DSC06323.ARW, but it reproduced on every photo):

1. `isDefaultEdit()` (`packages/core/src/data.ts`) compared recipes with
   `JSON.stringify(rest) === JSON.stringify(base)`. `useEditor.reset()`
   nulls the optional ML look fields (`sceneEnhance`, `faceAdjust`,
   `selectiveAdjust`) so they do not survive the spread-merge — but those
   keys are absent from `DEFAULT_EDIT`, so the reset-produced recipe always
   carried three extra `null` keys and the stringify comparison always
   failed. Since `App.tsx` drives the button with
   `canReset={!isDefaultEdit(editor.edit)}`, the button stayed highlighted
   (and enabled) after every reset. Confirmed with a repro script: fresh
   default → `true`, after-reset recipe → `false`.
2. `reset()` never cleared `denoise`, so a denoised photo kept its denoise
   strength in the recipe (and would re-run the server pass on reopen)
   while also keeping the button highlighted.

## Change

- `packages/core/src/data.ts`
  - Rewrote `isDefaultEdit()` as a per-key comparison over `DEFAULT_EDIT`'s
    keys (order-independent) plus explicit handling of the optional ML
    fields: `sceneEnhance`/`faceAdjust`/`selectiveAdjust` must be nullish,
    and `denoise` must be nullish or strength ≤ 0 (0 = off, mirroring the
    existing `isOriginalLook` convention).
  - Added an exported `RESET_PATCH` (`...DEFAULT_EDIT` plus nulls for all
    four ML look fields, including `denoise`) as the single source of
    truth for the reset patch.
- `packages/ui/src/hooks/useEditor.ts`: `reset()` now applies
  `change({ ...RESET_PATCH })` instead of an inline patch.

## Decisions

- Fix the predicate, not just the patch: even a patch that stripped the
  null keys would leave the stringify comparison fragile (key order, future
  optional fields). The per-key check matches how `isOriginalLook` already
  treats the optional fields.
- `denoise: null` in `RESET_PATCH` even though `handleAction('reset')`
  already calls `denoise.clearApplied()`: that only clears session pixels,
  while the recipe strength persisted and re-ran on reopen.
- No `README.md` update: pure bug fix, no architecture change.

## Tests

- `packages/core/src/data.test.ts` — extended `isDefaultEdit` (accepts the
  reset-produced null-keyed shape, ignores key order, rejects set ML look
  fields, treats nulled/zero-strength denoise as default) and added a
  `RESET_PATCH` case merging the real patch over a fully dirty edit
  (sliders, geometry, retouches, Custom preset, all ML fields, denoise) and
  asserting `isDefaultEdit` is `true` and `denoise` is `null`.
- `packages/ui/src/hooks/resetDehighlights.test.ts` (new) — pins
  `useEditor.reset()` to the shared `RESET_PATCH` (source pin, following
  the `toolbarReset.test.tsx` precedent) and re-verifies the
  patch→predicate loop through the built `@f8/core` barrel.
- Full suites green: core 52 files / 889 tests, ui 474 tests (incl. the 3
  new ones); `yarn build` clean in both packages.
