# Task 1: ML button + revert per adjustment category

## What changed

Each auto-capable adjustment category (White Balance, Lightness, Hue & Saturation)
now carries an **ML button** in its section header instead of an Auto pill:

- First click snapshots the category's current values and applies the automatic
  adjustment. The button highlights (`aria-pressed`, `.is-active`) and a small
  **revert icon** (undo glyph) appears right beside it.
- Clicking the **ML button again or the revert icon** restores the pre-ML
  snapshot. Revert goes through the normal edit path, so it stays undoable.
- The header **toggles now show/hide their category** (shared state with the
  disclosure chevron) instead of bypassing the adjustment effect. Toggle
  labels changed from `Enable X` to `Show X`.
- New `computeColorAuto` (saturation from mean saturation, extracted verbatim
  from `computeAutoEnhance`, which now reuses it with zero behavior change)
  gives Hue & Saturation its first automatic action.
- Sliders are no longer disabled by the enabled flags; the first manual drag
  in a legacy-disabled category re-enables it, and every ML apply re-asserts
  its category's enabled flag. Curves/Effects sliders are untouched (they
  never had enabled flags).
- Reset, preset/paste, and both enhance actions clear the photo's per-category
  ML state, so the revert icon never offers a stale snapshot after a
  wholesale recipe change. A run token also cancels an in-flight async apply
  if a revert (or wholesale change) lands before the decoded values arrive.

## Decisions

- **ML buttons only where a real automatic computation exists.** Curves,
  Details, Effects, and Black & White have no auto algorithm, so they get no
  ML button — an "ML" button with nothing automatic behind it would be fake
  UI. The computation stays histogram-based (see README); the ML label marks
  the automatic action per the request.
- **Toggles = content visibility**, matching "toggles toggle visibility of the
  category". The bypass capability they used to provide is replaced by
  ML + revert; the `*Enabled` recipe flags remain (pipeline, presets, and
  legacy recipes still honor them).
- **Black & White keeps its effect toggle** (`Enable black & white` via a new
  `toggleLabel` override): it has no sliders, and the toggle IS the binary
  look. Repair/denoise/face toggles are unrelated and untouched.
- **Manual slider edits keep the applied flag and snapshot** (revert still
  restores pre-ML values). Highlight-vs-revert refinement after manual edits
  is explicitly a later task's scope.
- **ML state is session-only and per photo** (flags in state, snapshots in a
  ref, like `enhanceSnapshots`): returning to a photo preserves revert, but
  reloads drop it — same tradeoff as straighten's snapshot. Undo/redo can
  benignly desync a flag (values move, flag stays); the next ML click still
  does the safe thing.
- **No DOM test stack added.** The repo tests UI via SSR markup + core unit
  tests; this change follows that (11 SSR + 13 core tests). The async hook
  glue follows the existing untested-`useEditor` precedent; the
  snapshot-covers-writes invariant is pinned at the data level instead.

## Files

- `packages/core/src/mlCategories.ts` (new): `MlCategory`, key tables,
  `snapshotMlCategory`.
- `packages/core/src/vision/enhance.ts`: `computeColorAuto` + reuse in
  `computeAutoEnhance`.
- `packages/ui/src/hooks/useEditor.ts`: per-photo applied flags, snapshots,
  run-token guard, `autoColor`, clears on reset/preset/enhance.
- `packages/ui/src/components/Inspector.tsx`: `AdjustmentMl` on
  `AdjustmentSection` (exported for tests), controlled visibility, ML wiring
  for WB/Lightness/Color, `toggleLabel` for B&W.
- `apps/web/src/App.tsx`: passes `mlApplied` + `onAutoColor`.
- `apps/web/src/index.css`: `.ml-button` / `.ml-revert` styles.
- `README.md`: one-line accuracy fix (Auto buttons → ML buttons).
- Tests: `mlCategories.test.ts` (new), `enhance.test.ts` (+5),
  `adjustmentMl.test.tsx` (new), `onAutoColor` added to 8 existing suites.

## Verification

- `yarn workspace @f8/core test` — 46 files / 771 tests pass.
- `yarn workspace @f8/ui test` — 22 files / 155 tests pass.
- `typecheck` clean for `@f8/core`, `@f8/ui`, `@f8/web` (rebuilt core/ui
  `dist`, which typechecks resolve against).
- Playwright not run (per task rules); e2e has no coverage of these
  headers (only straighten's untouched Auto pill).
