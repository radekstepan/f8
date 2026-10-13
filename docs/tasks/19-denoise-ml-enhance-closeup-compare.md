# Task 19: Denoise joins ML Enhance, with a 2× closeup and a Compare that shows it

## What changed

Three complaints, one task:

1. **Denoise moved into the ML Enhance section.** The standalone `Denoise`
   `AdjustmentSection` (which sat between Details and Effects) is gone; the
   `DenoiseControl` now renders last inside `.ml-enhance`, after Scene/Faces/
   Subject. Its Preview/Apply/Restore buttons switched from chunky
   `secondary-button` to the 27px `slim-button` the other ML actions use, and
   the ML badge moved from the Auto row into a small `Denoise` heading so the
   control is labeled inside the shared section.

2. **The preview gained a 2× closeup.** The ≤512px before/after pair stays
   (small, for framing), but under it two square boxes now show the same pair
   magnified 2× via `background-size: 200%` (no extra decode, no canvas).
   Clicking the small pair moves the closeup center (default 50%/50%, reset
   per preview). After apply, the same closeup stays on screen as proof, with
   a note pointing at Compare (B).

3. **Compare actually shows the denoise now.** Root cause: `PhotoCanvas`
   painted *both* the edited canvas and the "Original" layer from `photo.src`,
   which is the denoised base URL while applied — so Original and Edited were
   pixel-identical and Compare showed nothing. `PhotoCanvas` takes a new
   `originalSrc` prop; when it differs from the display src, the run decodes
   it alongside (best-effort: a decode failure falls back to the old
   behavior) and `paintOriginal` renders from it. `App` passes
   `originalSrc={photo.src}` (always the untouched original) next to
   `photo={viewPhoto ?? photo}`. Both layers stretch to the same frame, so
   the resolution difference (2048px base vs full-res original) doesn't
   misalign the split. This also fixes hold-to-show-original, which shares
   the layer.

## Decisions

- Denoise kept its detect-then-apply flow (preview → apply); only placement
  and buttons changed. The section header's reset action for denoise alone is
  gone with the old section — Clear/Restore buttons in the control cover it.
- Closeup is a static 2× center crop with click-to-move, not a noisiest-region
  finder: predictable, testable, no analysis pass.
- The "which src does Original decode" rule lives in core as
  `separateOriginalSrc` (null when the display src already is the original)
  so the fallback contract has unit tests; the effect paint itself isn't
  reachable from server rendering, so the App↔canvas wiring is pinned by a
  source test instead.
- README's denoise line updated (ML Enhance location, closeup, Compare).

## Tests

- `packages/ui/.../denoise.test.tsx` (+5): inside ML Enhance / no `<h3>Denoise</h3>`,
  slim preview button, centered 2× closeup markup, applied-state proof +
  Compare hint, `.denoise-zoom` CSS pin (200%, no-repeat).
- `packages/ui/.../mlEnhanceSection.test.tsx`: ALL_ML gains denoise; grouping
  order, no standalone section, slim-only buttons incl. denoise preview.
- `packages/ui/.../compareOriginal.test.tsx` (new, 2 tests): App feeds
  `viewPhoto` for display and `photo.src` as `originalSrc`.
- `packages/core/.../denoise.test.ts` (+2): `separateOriginalSrc` returns the
  original when they differ, null when equal/absent/empty.
- `yarn workspace @f8/ui test`: 144/144 pass. `yarn workspace @f8/core test`:
  757/757 pass. `yarn typecheck`: 6/6 ok.
