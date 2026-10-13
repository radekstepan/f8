# Task 10: Grid-size slider direction

The album grid's preview-resize slider (`PhotoBrowser` in
`packages/ui/src/components/PhotoStrips.tsx`) ran backwards: the slider
value fed `--grid-columns` directly (`min={2} max={5} value={size}`), so
dragging right added columns and *shrank* the previews, while dragging
left removed columns and enlarged them.

## What changed

1. **Mirrored mapping** (`PhotoStrips.tsx`). The slider value is now the
   preview *size* (drag right for larger previews) and converts to a
   column count via the exported `gridColumnsForSliderValue(value)`
   helper: `GRID_SLIDER_MIN + GRID_SLIDER_MAX - value` (2..5 mirrors to
   5..2 columns). The previously hardcoded `min`/`max` are now the
   `GRID_SLIDER_MIN`/`GRID_SLIDER_MAX` constants.
2. **Preserved default look.** The grid opened at 3 columns; the slider
   default is now the mirrored value (4 of 2..5) via
   `DEFAULT_GRID_COLUMNS`, so first paint is unchanged.
3. **Icons: nothing to swap.** The control holds a single `Grid2X2` icon
   leading the slider — a direction-neutral glyph with no trailing
   counterpart — so no icon change was needed. A test pins that
   one-icon layout so a future second icon gets a conscious decision.
4. **Tests:** added `gridSizeSlider.test.tsx` (5 tests: left end yields
   the most columns / smallest previews; right end yields the fewest
   columns / largest previews; one column per step across the range;
   default markup pairs slider value 4 with `--grid-columns:3`; the
   control keeps its single leading icon).

## Decisions

- **Mirror in state mapping, not CSS.** A `direction: rtl` / `scaleX(-1)`
  flip would also reverse keyboard arrows and focus-ring motion in some
  browsers; an explicit value→columns function keeps arrow keys, screen
  readers, and the thumb all agreeing that right means bigger.
- **Export the helper from the component module.** The mapping is tiny
  and grid-specific, so it lives next to `PhotoBrowser` rather than in
  `@f8/core`; exporting it makes the direction unit-testable under the
  repo's node-environment (SSR-only) test setup.
- **No README change.** Slider-direction fix with no architecture or
  API-surface change.

## Verification

- `yarn workspace @f8/ui test`: 43 files, 335 tests, all pass (330
  pre-existing + 5 new).
- `yarn workspace @f8/ui typecheck`: clean.
- `yarn workspace @f8/web typecheck`: clean.
- Playwright not run (per brief).
