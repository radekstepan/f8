# Task 2: Histogram starts flat, rises from zero

## Change
The histogram used to open with a 28-bar skeleton wave that swapped into the
real RGB curves once `PhotoCanvas` computed the distribution — the swap read
as a weird morph from individual bars into the finished histogram.

Now the histogram starts flat: the svg shell (grid, zero baseline, range
markers, axis) always renders, with no curve paths at all until the data
lands (`packages/ui/src/components/Inspector.tsx`). The `HistogramSkeleton`
component and its bar field are gone. While loading, the section keeps the
`is-loading` class plus `aria-busy="true"`, and the svg is labelled `Loading
color distribution` instead of the channel distribution.

When the data lands, the channel paths mount inside a new
`<g className="histogram-live">` group. The `histogram-bloom` keyframes were
moved from the whole svg onto that group (`apps/web/src/index.css`) and now
start at `scaleY(0)` instead of `scaleY(.55)`, so the curves rise from the
horizontal zero with a bottom transform origin while the grid stays static.
Later data updates only change the paths' `d` attributes, so the entrance
plays once and never re-animates on slider drags or channel switches. The
`histogram-wave` keyframes and skeleton rules were deleted, and the
reduced-motion override now freezes `.histogram-live`.

Since the same svg shell renders in both states, there is no element swap and
no layout jump at all — strictly better than the old skeleton, which only
matched the curves' 68px slot.

## Decisions
- No curve paths (rather than flat zero-height paths) while loading: a
  zero-area path still strokes a colored hairline over the baseline, which
  would violate "no lines/areas".
- Animate the curve group, not the svg: scaling the whole svg from zero would
  have launched the grid lines up from the bottom too.
- Kept the `histogram-bloom` name and 450ms timing: same entrance character,
  just starting from true zero.

## Tests (`packages/ui/src/components/histogramLoading.test.tsx`)
Rewrote the file to the new contract (same SSR + stylesheet-pin approach):
- `starts flat: grid shell with no curve paths while the data is missing`:
  `is-loading` + `aria-busy`, svg shell with grid, no `histogram-live`, no
  `fill-opacity`/`mix-blend-mode`, no skeleton, exactly 8 paths (6 grid + 2
  markers).
- `keeps the heading, axis, and camera settings visible while loading`:
  unchanged from before.
- `mounts the curves inside the rising group once the data lands`: live
  group with all three channel fills, `RGB color distribution` label.
- `adds only the live curve group when the data lands, swapping no shell
  markup`: loading vs loaded markup is byte-identical after stripping the
  live group and normalizing the loading markers.
- `rises the curves from the zero baseline, frozen under reduced motion`:
  no skeleton/wave rules anywhere in the stylesheet, bloom on
  `.histogram-live` with bottom origin, keyframes start at `scaleY(0)`,
  no animation on `.histogram-curves`, 68px shell slot, reduced-motion
  freeze.

## Verification
- `yarn workspace @f8/ui test`: 58 files, 462 tests, all pass.
- `yarn workspace @f8/ui typecheck`: clean.
- No `histogram-skeleton` / `histogram-wave` references remain in
  `packages/*/src` or `apps/*/src` (only negative assertions in the test).
- No README change: behavior-only fix, no architecture or feature change.
