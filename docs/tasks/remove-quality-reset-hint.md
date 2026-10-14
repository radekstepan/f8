# Remove "Double click to reset quality" hint

Task: `Remove "Double click to reset quality", it's not needed.`

## What changed

- `packages/ui/src/components/EditorUI.tsx`: `RangeControl` gains an
  optional `disableReset` prop. When set, the range input renders with no
  `data-tooltip` reset hint and no `onDoubleClick` handler (the spread and
  the conditional handler mirror the existing `valueHint` opt-in pattern).
  Default behavior is unchanged.
- `packages/ui/src/components/EditorDialogs.tsx`: the export dialog's
  `Quality` slider (`label="Quality"`, 10–100%) now passes `disableReset`,
  so the "Double-click to reset quality" tooltip is gone.
- `packages/ui/src/components/exportQualityResetHint.test.tsx` (new, 4
  tests): the export dialog contains no `Double-click to reset quality`
  text; the Quality range input carries no `data-tooltip` at all; an
  ordinary slider still renders its reset hint (scope guard); and the new
  prop drops the tooltip while the conditional handler wiring is pinned at
  source level (handlers are invisible to static markup).

## Important decisions

- **Quality-only, not global**: the hint comes from the shared
  `RangeControl`, whose reset affordance is intentional elsewhere (pinned
  by `Tooltip.test.tsx` and `brushSizeOrigin.test.tsx`). The fix is an
  opt-out prop used only by the export Quality slider.
- **Removed the handler too, not just the text**: the Quality slider never
  passed `defaultValue`, so double-click reset to `0` on a 10–100 scale —
  out of range and meaningless. Keeping a hidden broken reset while
  deleting its hint would be worse than removing both.
- **No README update**: single-hint UI removal, no architecture or feature
  change.

## Tests (unit/integration only, no Playwright)

- `exportQualityResetHint.test.tsx` (new, 4 tests): hint absence in the
  export dialog, tooltip-free Quality input, ordinary-slider hint kept,
  and `disableReset` unit + handler source pin — all via
  `renderToStaticMarkup`.
- Full suite: `@f8/ui` 445/445 pass (57 files). `@f8/ui` typecheck clean.
