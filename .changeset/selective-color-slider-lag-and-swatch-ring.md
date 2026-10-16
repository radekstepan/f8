---
'@f8/core': patch
'@f8/web': patch
---

Selective Color sliders drag with much less lag (the per-pixel color pass now runs from a per-render plan at ~1.8x the speed with identical output), and the range swatches show a single tight selection ring instead of the color circle plus a gapped yellow outline.

## Task writeup (docs/tasks/63-selective-color-slider-lag-and-swatch-ring.md)

## Request

"Selective Color dragging the slider has a bit of a lag. Also there are
double circles when I select a color, the circle of the color, then a
gap, then a yellow outline. Weird."

## Investigation

Lag: every slider tick re-renders the preview frame (up to 1800px on the
long edge, ~2M pixels) synchronously on the main thread through
`renderAdjustedPixels`. Benchmarking that function on an 1800x1200 frame
showed Selective Color as the dominant cost once any range is touched:

- neutral: 43ms, exposure-only: 74ms per frame;
- selective color, 1 range touched: 334ms; 3 ranges: 503ms.

So each drag tick paid ~260ms extra for a single touched range. The
per-pixel `applySelectiveColor` did an allocating HSL round-trip (array
returns, a closure per pixel), a `Map` lookup plus range-array hop per
range, modulo-based hue distance, and a full eleven-slot packed scan per
pixel — plus one `smoothstep` gate evaluation per range instead of per
pixel.

Double circles: the swatch button was a 26px circle with 3px padding and
a 1px transparent border, with the color dot inside. The selected state
colored the button border accent (`--accent`, the yellowish ring), which
— separated from the dot by the 3px padding — read as color circle,
gap, yellow outline. On top of that, keyboard focus (and Safari
click-focus) added the global `button:focus-visible` 2px outline with a
3px offset: a third ring.

## Change

- `packages/core/src/selective-color.ts`: the pixel loop now runs from a
  per-render plan. `planSelectiveColor(packed)` resolves the packed
  triples once per render to the active slots only (in slot order, with
  `hasChromatic`/`hasAchromatic` gate flags); `applySelectiveColorPlan`
  is the hot entry point. The shared core inlines the HSL round-trip
  (scalar, no allocations), reads range metadata from a static slot
  table (no `Map` lookups), folds hue distance without modulo, and
  evaluates each saturation gate once per pixel. Every operation is
  op-for-op identical to the `rgbToHsl` / `selectiveColorWeight` /
  `hslToRgb` reference — including the `+360` rounding inside
  `selectiveHueDistance` and slot-order accumulation — so renders are
  bit-identical. `applySelectiveColor` (packed) stays as the public
  single-call API over the same core, so the two cannot drift.
- `packages/core/src/adjustments.ts`: `PointParameters.selectiveColor`
  is now the plan (`SelectiveColorPlan | null`), resolved once in
  `pointParameters`; the pixel loop calls `applySelectiveColorPlan`.
- `apps/web/src/index.css`: swatch buttons hug the dot (22px, no
  padding/border) and the selection/hover state is a single tight ring
  drawn as `box-shadow` directly on the dot — no gap, no second circle.
  Keyboard focus reuses the same tight ring (`outline: none` on the
  button plus the accent `box-shadow` on the dot) instead of the global
  offset outline. Applied identically to the Selective Clarity chips,
  which shared the same double-circle structure.
- Tests: `selective-color.test.ts` gains a differential sweep (~2.8k
  colors x 8 recipes, exact `toEqual`) pinning the fast packed and plan
  paths against the exported-primitive reference, plus a plan-shape test
  (null while neutral, slot order, gate flags).
  `selectiveColor.test.tsx` / `selectiveClarity.test.tsx` pin the new
  single-ring CSS (zero padding, tight `box-shadow` ring, focus-visible
  override).

Result: 1 touched range renders in 183ms (was 334ms), 3 ranges in 265ms
(was 503ms) — ~1.8x, with byte-identical output.

## Decisions

- Bit-identical over faster-but-close: the differential test initially
  caught a 1-ulp drift from "simplifying" the hue-distance modulo (the
  `+360` step rounds and does not round-trip). Rather than relaxing to
  approximate equality, the fast path replicates the exact rounding with
  a conditional subtract, keeping previews, exports, and cached renders
  pixel-identical. Any future drift fails loudly in the sweep.
- Plan derived from packed bits, not rescaled from the recipe: the plan
  reads values straight out of the `Float32Array`, so float32 rounding
  cannot disagree between the two paths.
- Fixed Selective Clarity chips too: same component pattern, same visual
  defect; leaving them double-ringed while fixing their sibling would be
  inconsistent.
- No reduced-resolution or coalesced rendering in this change: fully
  eliminating drag jank needs interactive Specific rendering (rAF
  coalescing or reduced-res-while-dragging), which is architectural work
  needing visual verification — explicitly out of scope here (no
  Playwright). Noted as the follow-up below.

## Known limitation

A slider tick still re-renders the full frame on the main thread (~183ms
with one Selective Color range at 1800px), so fast drags can still feel
heavy — just markedly less than before. The structural fix is coalescing
renders to one per animation frame and/or rendering at reduced
resolution while a slider drag is active (RangeControl already reports
drag state via `onDraggingChange`), then painting full resolution on
release.

## Verification

- `yarn workspace @f8/core test`: 67 files / 1157 tests pass.
- `yarn workspace @f8/ui test`: 87 files / 680 tests pass.
- `yarn workspace @f8/server test`: 19 files / 181 tests pass.
- `yarn typecheck` and `yarn build` pass.
- Benchmarks (`/tmp/selcolor-bench.mjs`, `/tmp/selcolor-micro.mjs`, kept
  out of the repo): 334ms -> 183ms (1 range), 503ms -> 265ms (3 ranges)
  at 1800x1200; per-pixel 91ns -> ~50ns on the plan path.
- Playwright not run (per task rules).
