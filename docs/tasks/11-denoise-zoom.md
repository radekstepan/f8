# Task 11: Denoise Before/After closeup goes from 2× to 4×

## What changed

The Denoise Before/After closeup in the inspector's ML Enhance
section magnified only 2× — at sidebar scale each closeup box is
~125px wide, so a 2× crop of the 512px preview still rendered the
grain too small to judge. The closeup now magnifies 4×:

- `apps/web/src/index.css`: `.denoise-zoom` goes from
  `background-size: 200%` to `background-size: 400%`
  (`background-repeat: no-repeat` unchanged — still no tiling).
- `packages/ui/src/components/Inspector.tsx`: the `DenoiseCloseup`
  captions read "Before · 4×" / "After · 4×", the aria-labels say
  "4x magnification", the compare-strip tooltip says "Click to
  move the 4× closeup", and the component comment matches.
- `README.md`: the one-line feature blurb now says "4× closeup".

No layout change: the closeup keeps its side-by-side square
boxes, the loupe still defaults to the image center, and clicking
the small preview pair still moves it.

## Decisions

- **4×, not higher.** The preview is a ≤512px downsample
  (`DENOISE_PREVIEW_WIDTH`) and each closeup box is ~125px wide,
  so 4× lands at roughly 1:1 pixels — true pixel-peeping, the
  standard way to judge noise. 6×/8× would upscale past the
  preview's native resolution and smear the very grain being
  judged.
- **Zoom only, not bigger boxes.** Stacking the boxes full-width
  would double their size but force the same interpolation
  problem at 4×; crisp 1:1 pixels in the existing boxes show more
  real detail than larger interpolated ones.
- **Denoise-scoped.** `.denoise-zoom` / `.denoise-closeup` are
  used only by `DenoiseCloseup` (verified by grep) — no other
  preview shares the component or the rule, so nothing else
  changes.
- **No README architecture update.** One-line blurb fix only; no
  architecture or feature change.

## Tests

- `denoise.test.tsx` (updated, following the existing
  `readFileSync` CSS-assertion precedent): the closeup test now
  pins the 4× captions, aria-labels, and tooltip; the CSS test
  pins `background-size: 400%` plus `no-repeat`.

## Verification

- `yarn workspace @f8/ui test` — 174 passed (25 files).
- `tsc --noEmit` (ui) — clean.
- Playwright not run (per task rules).
