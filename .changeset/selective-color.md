---
'@f8/core': minor
'@f8/ui': minor
---

Color Adjustments gained Selective Color: pick one of eleven ranges (Reds, Oranges, Yellows, Greens, Aquas, Blues, Purples, Magentas, plus Whites, Neutrals, and Blacks) from the swatch row and tune that range's hue, saturation, and luminance. Adjusted ranges keep a dot on their swatch, the header toggle resets every range, and the effect renders in the canvas, Compare, and exports.

## Task writeup (docs/tasks/57-selective-color.md)

## Request

Implement "Selective Color" adjustment just like Photomator shows it:
pick a color range (Reds, Oranges, Yellows, Greens, Aquas, Blues,
Purples, Magentas, plus White/Neutral/Black) and adjust Hue,
Saturation, Luminance for that range.

## Investigation

No per-hue adjustment existed: the only hue control was the global Hue
slider (a YIQ rotation over the whole photo), and the only thing named
"selective" was the ML subject/background mask — an unrelated feature.
The work therefore spanned the full adjustment stack:

- Recipe: `EditState` in `packages/core/src/types.ts`, defaults in
  `packages/core/src/data.ts`.
- Render: `renderAdjustedPixels` / `applyPointAdjustments` in
  `packages/core/src/adjustments.ts`, shared by the canvas preview
  (`renderAdjustedCanvas`) and export (`renderExportCanvas`), so one
  pipeline change covers both.
- UI: `AdjustmentSection` entries in
  `packages/ui/src/components/Inspector.tsx` with styles in
  `apps/web/src/index.css`.

Good news on integration: everything downstream of the recipe is
spread-based, so the new field flows through untouched — the server
store merges recipes over `DEFAULT_EDIT` (old recipes gain the default;
new recipes persist verbatim), the preview-cache key stringifies the
whole edit, copy/paste spreads the full edit, enhance snapshots iterate
`Object.keys(edit)`, and `patchBreaksEnhancePure` drops the enhance
highlight on any non-geometry patch. Only the three length-vs-reference
comparisons needed the new array key: `isDefaultEdit`,
`isOriginalLook`, and `isNeutralEdit`.

## Change

- `packages/core/src/types.ts`
  - New `SelectiveColorRange` (eleven ranges in Photomator's order),
    `SelectiveColorParams` (hue/saturation/luminance, each -100..100),
    and `SelectiveColorEntry` (range + params).
  - New `EditState.selectiveColor: SelectiveColorEntry[]` — sparse like
    `curvePoints`: one entry per touched range, empty is the identity.
- `packages/core/src/selective-color.ts` (new)
  - Range table with hue centers, cosine-falloff half-widths (overlapping,
    so no hue falls in a dead gap), labels, and swatch colors.
  - HSL conversion plus `selectiveColorWeight`: chromatic ranges score by
    circular hue distance gated on saturation (grays stay put); the
    whites/neutrals/blacks bands score by lightness bells gated on
    grayness (vivid colors stay put); the gates crossfade the middle.
  - Recipe helpers: `normalizeSelectiveColor` (sanitize/clamp/dedupe/
    prune/sort, never throws), `isSelectiveColorActive`,
    `selectiveColorParams`, `setSelectiveColorRange` (immutable upsert,
    prunes ranges dragged back to neutral).
  - Render helpers: `resolveSelectiveColor` packs eleven
    [hueDegrees, satDelta, lumDelta] triples (null while neutral, so the
    pixel loop skips the HSL round-trip); `applySelectiveColor` runs one
    pixel through the accumulated tweak.
  - Responses: hue ±100 → ±60°, saturation ±100 → ×0..2 (same units as
    the global slider), luminance ±100 → ±0.5 lightness.
- `packages/core/src/adjustments.ts`
  - `PointParameters` carries the packed triples; the point pass applies
    them after the global hue rotation (selective sees the
    color-corrected pixel) and before Black & White (which still wins
    outright). `isNeutralEdit` includes the new field so canvas and
    export agree.
- `packages/core/src/data.ts`
  - `DEFAULT_EDIT.selectiveColor = []`; `isDefaultEdit` and
    `isOriginalLook` compare it by length (fresh deserialized arrays
    still read as default). `RESET_PATCH` inherits it via the
    `DEFAULT_EDIT` spread.
- `packages/ui/src/components/Inspector.tsx`
  - New `SelectiveColorSection` between Hue & Saturation and Curves: an
    eleven-swatch range picker (Photomator's strip), the selected range's
    name, and Hue/Saturation/Luminance sliders. Adjusted ranges keep a
    dot on their swatch; the header toggle follows the manual
    Curves/Details/Effects contract (lights on first tweak, resets all
    ranges, disabled while off); each slider drag coalesces to one undo
    step via a `selective-color:<range>:<param>` merge key.
- `apps/web/src/index.css`
  - Swatch row, dot, active ring, dirty dot, and range caption rules.
- Tests
  - `packages/core/src/selective-color.test.ts` (new, 24 tests): hue
    coverage of all 360 degrees, band peaks and gating, HSL round-trip,
    normalize/active/params/set/resolve helpers, per-pixel targeting
    (blue-only tweak leaves red byte-identical), and pipeline
    integration (neutrality, neutral-list passthrough, B&W precedence).
  - `packages/ui/src/components/selectiveColor.test.tsx` (new, 7 tests):
    placement, eleven swatches with reds active, slider values from the
    selected range, dirty dots, toggle off/disabled at defaults and lit
    when touched, one switch and no reset in the section, CSS pins.
  - Extended three section-enumerating suites for the new panel:
    `collapsePanels` titles, `adjustmentConsistency` toggle ids and
    switch count (8→9), `autoMlToggle` row/switch counts (10→11), and
    `singleResetIcon`'s fully-applied fixture now carries a blues tweak
    with its toggle asserted on.
- `README.md`, `docs/features.md`: short-form list entries plus a
  Selective Color bullet in the Adjust catalogue.

## Decisions

- Sparse list, not a fixed eleven-slot object: it mirrors `curvePoints`,
  keeps recipes small, makes "empty is default" a length check, and
  prunes neutral entries on write so undo/preset/persist payloads never
  carry dead weight. Trade-off, shared with `curvePoints`: a hand-edited
  recipe with all-neutral entries reads as non-default by length while
  rendering neutral — accepted, since every writer prunes.
- Selective runs after global hue, before B&W: the range picker names
  hues as the user sees them post-correction, and B&W keeps its
  "discard color" meaning. Global hue can push pixels across range
  boundaries; that matches stacking order in Photomator/Lightroom.
- Chromatic ranges ignore near-grays and achromatic bands ignore vivid
  colors, via crossfading saturation gates: without them a Reds tweak
  would tint gray pixels (hue is degenerate at zero saturation) and a
  Neutrals tweak would grab a mid-lightness blue sky. The Whites/
  Neutrals/Blacks ranges exist precisely to own the grays.
- No `colorEnabled` gating: Selective Color is its own section with its
  own toggle, not part of Hue & Saturation — bypassing it via the Hue &
  Saturation toggle would surprise. (Legacy disabled-category recipes
  predate the field, so there is nothing to migrate.)
- Thumbnail CSS filter untouched: `getPhotoFilter` cannot express
  per-hue work, so grid/filmstrip thumbs approximate without it until a
  render-based thumbnail pipeline exists. Canvas, compare, histogram,
  and export all use the real pipeline.
- Section defaults to open, sibling to Hue & Saturation: it is a primary
  color tool, not an advanced disclosure like Curves/Details/Effects.

## Verification

- `yarn workspace @f8/core test`: 63 files / 1084 tests pass.
- `yarn workspace @f8/ui test`: 82 files / 617 tests pass.
- `yarn workspace @f8/server test`: 19 files / 181 tests pass.
- `yarn typecheck` and `yarn build` pass.
- Playwright not run (per task rules).
