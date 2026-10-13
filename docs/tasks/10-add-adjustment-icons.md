# Task 10 — Add Adjustment icons sit next to the label

## Problem
The "+" and chevron icons on the Add Adjustment button were pushed to the
far left and right edges of the full-width button instead of sitting next
to the label.

## Fix
- `apps/web/src/index.css`: removed the opposing `margin-right: auto` /
  `margin-left: auto` rules on `.add-adjustment > svg:first-child` and
  `svg:last-child`. The button already centers its content with
  `justify-content: center` + `gap: 7px`, so deleting the auto margins is
  the whole fix; the chevron keeps its explicit `width: 12px`. No markup
  change in `Inspector.tsx`.

## Decisions
- Pure CSS fix: the button's flex centering was already correct, the auto
  margins were just fighting it. Kept the 12px chevron width (matches the
  lucide `size={12}` prop) rather than touching the component.

## Verification
- `packages/ui/src/components/addAdjustmentLayout.test.tsx` (new): 2 tests
  (button centers content as one group; no icon rule carries auto margins).
- Full UI suite: 118 pass; `tsc --noEmit` clean in `@f8/ui`.
