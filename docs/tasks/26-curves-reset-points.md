# Task: Curves reset button + addable points

## Request

Curves shouldn't use "double click to reset" but instead have a reset
button like other tools. Also, the curve line with one dot — how useful
is it? The slider does the same thing. Are we supposed to be able to
add a new dot as well?

## Answer

Yes — you are now. The Curves graph is a real tone-curve editor: click
the line to drop a control point (up to sixteen) and keep dragging it
in the same gesture, drag any dot to reshape, Delete/Backspace or
right-click removes the focused dot. The Midtones slider keeps its
midtone bend, and its double-click reset is gone: the Curves header
reset clears dots and Midtones together, like every other tool.

## Change

- `packages/core/src/types.ts`: new `CurvePoint` (`{x, y}` normalized
  0..1) and required `EditState.curvePoints` (empty = identity curve).
- `packages/core/src/toneCurve.ts` (new): pure curve math — normalize
  (sort/clamp/dedupe/cap), `add/move/removeCurvePoint` reducers,
  Fritsch–Carlson monotone spline (`evaluateToneCurve`), the 256-entry
  `buildToneCurveTable` (null while identity, so the pipeline skips the
  lookup), the Midtones display bend, and `toneCurveDisplayPath` for the
  graph. Also owns `MIDTONE_CURVE_RESPONSE` (0.6), now shared with the
  pipeline instead of a magic number.
- `packages/core/src/adjustments.ts`: `PointParameters.curveTable`
  remaps every channel after the tonal offsets; `isNeutralEdit`
  treats anchors as non-neutral. Preview canvas and export both run
  through `renderAdjustedPixels`, so both pick the curve up with no
  further wiring (the CSS `getPhotoFilter` stays a thumbnail-only
  approximation, as documented).
- `packages/core/src/data.ts`: `DEFAULT_EDIT.curvePoints: []`, and
  `isDefaultEdit`/`isOriginalLook` compare anchors by length like
  retouches — a server recipe deserializing a fresh `[]` must still
  read as default/Original (reference equality would have marked
  every loaded photo Edited/Custom).
- `packages/ui/src/components/Inspector.tsx`: new exported
  `ToneCurveEditor` (press-to-add + drag with pointer capture,
  per-dot `role="slider"` with arrow keys/Delete, right-click
  removes); the Curves reset is now `{ curve: 0, curvePoints: [] }`
  with matching dirty, and Midtones passes `disableReset`.
- `apps/web/src/index.css`: `.curve-point` dot styling + focus ring.
- `docs/features.md`: catalogue bullet for the editor; the
  double-click line now notes the Midtones exception.

## Decisions

- Kept the Midtones slider and made dots additive (parametric bend +
  point curve, Lightroom-style) rather than replacing the slider:
  existing recipes keep rendering identically, and each control does
  one job — the "slider does the same thing" overlap is gone because
  the graph no longer bends from a bare drag.
- Fritsch–Carlson monotone cubic over piecewise-linear: smooth like a
  real curve tool, but the slope limiter guarantees no overshoot past
  a placed anchor. The graph draws the exact render mapping (spline
  over the bend), so the editor is WYSIWYG.
- No double-click anywhere in Curves (not even dot-delete — Delete /
  right-click / drag-off isn't needed), per the request's spirit;
  dots clamp between neighbors so a drag never reorders them.
- The graph tooltip sits on the wrapper div: `TooltipHost` only reads
  `HTMLElement`, so svg/circle nodes can never trigger it.
- No README change: the short-form function list already covers tone
  work ("tone"), and `readme.test.ts` pins its shape; the full
  catalogue entry went to `docs/features.md`.
- Changeset is `minor` (new editor capability, not a fix) and was
  hand-written in the CLI's exact format: `yarn changeset` needs an
  interactive TTY for package selection, which this session has not.

## Verification

- New `toneCurve.test.ts` (36 tests: reducers, spline properties,
  table, display bend pinned against the pipeline bell, display path
  corners), extended `adjustments.test.ts` (channel remap, pinned
  extremes, identity fast path), `data.test.ts` (fresh-`[]`
  round-trip reads as default/Original), new `curvesPoints.test.tsx`
  (7 UI tests), extended `resetPerAdjustment.test.tsx` (anchors
  light exactly `Reset curves`).
- `yarn workspace @f8/core test`: 56 files / 1001 tests pass.
  `yarn workspace @f8/ui test`: 68 files / 541 tests pass.
  `yarn typecheck` (all four workspaces) and `yarn build` pass.
  Server suite not run (untouched area; its EditState use is covered
  by the typecheck). No Playwright, per the task rules.
