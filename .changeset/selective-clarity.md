---
'@f8/core': minor
'@f8/ui': minor
---

Color Adjustments gained Selective Clarity: pick Shadows, Midtones, or Highlights from the chip row and tune that range's texture (fine detail) and clarity (broad detail). Adjusted ranges keep a dot on their chip, the header toggle resets every range, and the effect renders in the canvas, Compare, and exports.

## Task writeup (docs/tasks/59-selective-clarity.md)

## Request

Implement Selective Clarity adjustments like in Photomator: target
Shadows, Midtones, and Highlights tonal ranges, adjusting Texture and
Clarity per range.

## Investigation

No per-range detail control existed: the only detail sliders were the
global Clarity (wide-radius unsharp, midtone-weighted) and Sharpness
(3x3 unsharp) in the Details section, and there was no Texture concept
anywhere in the pipeline. The recently added Selective Color (commit
5ede446 — see `54-selective-color.md`) supplied the full pattern to
mirror: sparse per-range recipe entries, a self-contained
`selective-<x>.ts` core module (range table, normalize/active/params/
set/resolve helpers), render integration in `adjustments.ts`, a
swatch-picker + sliders `AdjustmentSection` in `Inspector.tsx` with the
manual toggle contract, and the three length-vs-reference comparisons
(`isDefaultEdit`, `isOriginalLook`, `isNeutralEdit`).

One structural difference from Selective Color: that feature is a point
operation (per-pixel HSL), while clarity/texture are neighborhood
operations (unsharp over blurred luminance planes). The render side
therefore extends the detail passes in `renderAdjustedPixels` rather
than the point pass — but like Selective Color it still lands in the
one shared pipeline, so canvas preview, Compare, histogram, and export
all pick it up together.

## Change

- `packages/core/src/types.ts`
  - New `SelectiveClarityRange` (`shadows` | `midtones` |
    `highlights`), `SelectiveClarityParams` (texture/clarity, each
    -100..100), and `SelectiveClarityEntry` (range + params).
  - New `EditState.selectiveClarity: SelectiveClarityEntry[]` — sparse
    like `selectiveColor`: one entry per touched range, empty is the
    identity.
- `packages/core/src/selective-clarity.ts` (new)
  - Range table in Photomator's tonal order with labels and tonal
    swatch chips (dark → mid → light gray).
  - `selectiveClarityWeight`: luminance bells matching the global
    tonal weights (shadows = shadowWeight, midtones = midtoneWeight,
    highlights = highlightWeight), so the ranges and the global
    sliders agree on what "Shadows" means. Kept local (not imported
    from `adjustments.ts`) so the module stays dependency-free like
    `selective-color.ts`; the equality is pinned by test.
  - Recipe helpers mirroring selective-color.ts: `normalizeSelectiveClarity`
    (sanitize/clamp/dedupe/prune/sort, never throws),
    `isSelectiveClarityActive`, `selectiveClarityParams`,
    `setSelectiveClarityRange` (immutable upsert, prunes ranges
    dragged back to neutral).
  - Render helpers: `resolveSelectiveClarity` packs three
    [textureDelta, clarityDelta] pairs (6 floats, null while neutral,
    so the pixel loop skips the extra blur passes);
    `selectiveDetailScales` accumulates one pixel's weight-summed
    texture/clarity scales.
  - Response: both sliders ride `SELECTIVE_DETAIL_RESPONSE` (1.5, the
    global clarity gain) — Texture and Clarity differ only in
    frequency, not strength.
- `packages/core/src/adjustments.ts`
  - New `textureRadiusForSize`: a medium radius clamped 1..5, between
    sharpness (1) and clarity (2..10) at every size, so the three
    detail controls each own a frequency band.
  - `renderAdjustedPixels` detail section: the wide double-blurred
    plane is now computed once and shared by the global clarity loop
    and the new per-range clarity loop; a separate medium-blur plane
    serves the per-range texture loop. Per-pixel range scales gate
    each delta, so untouched tones skip. Selective Clarity is NOT
    gated on `detailsEnabled` — it is its own section with its own
    toggle (the Selective Color / Hue & Saturation precedent).
    `isNeutralEdit` includes the new field so canvas and export agree.
- `packages/core/src/data.ts`
  - `DEFAULT_EDIT.selectiveClarity = []`; `isDefaultEdit` and
    `isOriginalLook` compare it by length (fresh deserialized arrays
    still read as default). `RESET_PATCH` inherits it via the
    `DEFAULT_EDIT` spread.
- `packages/ui/src/components/Inspector.tsx`
  - New `SelectiveClaritySection` between Details and Effects: a
    three-chip range picker (tonal dots, dark to light), the selected
    range's name, and Texture/Clarity sliders. Adjusted ranges keep a
    dot on their chip; the header toggle follows the manual
    Selective Color contract (lights on first tweak, resets all
    ranges, disabled while off); each slider drag coalesces to one
    undo step via a `selective-clarity:<range>:<param>` merge key.
    Section defaults to open, sibling to Selective Color.
- `apps/web/src/index.css`
  - Chip row, dot, active ring, dirty dot, and range caption rules
    mirroring the selective-color set.
- Tests
  - `packages/core/src/selective-clarity.test.ts` (new, 22 tests):
    range order, weight peaks/cutoffs, bell equality with the global
    tonal weights, full-luminance ownership, normalize/active/params/
    set/resolve helpers, per-pixel scale accumulation, radius banding,
    and pipeline integration (neutrality, default/original-look flags,
    byte-identical neutral render, shadows-clarity and
    highlights-texture targeting on a split checkerboard, no Details
    gating, stacking with global clarity).
  - `packages/ui/src/components/selectiveClarity.test.tsx` (new, 7
    tests): placement, three chips with shadows active, slider values
    from the selected range, dirty dots, toggle off/disabled at
    defaults and lit when touched, one switch and no reset in the
    section, CSS pins.
  - Extended six section-enumerating suites for the new panel:
    `collapsePanels` titles, `adjustmentConsistency` toggle ids and
    switch count (9→10), `autoMlToggle` row/switch counts (11→12),
    `singleResetIcon`'s fully-applied fixture now carries a shadows
    tweak with its toggle asserted on, and the two global
    `>Clarity</label>` absence pins (`detailsToggle`, `adjustmentMl`)
    now scope to the Details slice bounded by the new heading — the
    open Selective Clarity section legitimately owns a Clarity slider.
- `README.md`, `docs/features.md`: short-form list entries plus a
  Selective Clarity bullet in the Adjust catalogue.

## Decisions

- Sparse list, not a fixed three-slot object: mirrors
  `selectiveColor`/`curvePoints`, keeps recipes small, makes "empty is
  default" a length check, and prunes neutral entries on write.
  Same accepted trade-off: a hand-edited recipe with all-neutral
  entries reads as non-default by length while rendering neutral.
- Texture and Clarity share one gain (1.5) and differ only in radius:
  Texture is fine detail (medium radius, single blur), Clarity is
  broad detail (the global clarity radius, shared double blur). One
  strength scale keeps the two sliders comparable; the frequency split
  is the Lightroom/Photomator Texture-vs-Clarity distinction.
- No Texture global slider: the task asks only for per-range
  Texture/Clarity, so no new global control was added. Texture exists
  purely as the per-range fine-detail pass.
- No midtone gate on the selective passes: global clarity weights by
  midtoneWeight, but applying that on top of the range weights would
  mute Shadows exactly where it should bite. The range bells already
  localize, so selective clarity applies them unweighted.
- No `detailsEnabled` gating: Selective Clarity is its own section
  with its own toggle, not part of Details — bypassing it via the
  Details toggle would surprise. (Legacy disabled-category recipes
  predate the field, so there is nothing to migrate.)
- Range bells duplicate the global tonal formulas locally instead of
  importing them from `adjustments.ts` (which would cycle back through
  this module): a test pins the equality across all luminances, so
  drift fails loudly.
- Thumbnail CSS filter untouched: `getPhotoFilter` cannot express
  neighborhood detail work, so grid/filmstrip thumbs approximate
  without it until a render-based thumbnail pipeline exists. Canvas,
  compare, histogram, and export all use the real pipeline.
- Section defaults to open, sibling to Selective Color: it is a
  primary per-range tool, not an advanced disclosure like
  Curves/Details/Effects. This required scoping the two global
  `>Clarity</label>` absence assertions to the Details slice.
- The wide blur plane is shared between the global and selective
  clarity loops (same radius, same input plane): one double blur
  serves both, so adding the feature costs one medium blur pass plus
  the per-pixel scale math only.

## Verification

- `yarn workspace @f8/core test`: 65 files / 1116 tests pass.
- `yarn workspace @f8/ui test`: 84 files / 641 tests pass.
- `yarn workspace @f8/server test`: 19 files / 181 tests pass.
- `yarn typecheck` and `yarn build` pass.
- Playwright not run (per task rules).
