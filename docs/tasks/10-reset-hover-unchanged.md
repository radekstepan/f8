# 10 — No hover-tease reset on clean sections

## Request
"Why is the reset button showing onhover in Curves when the curve hasn't
been changed??? Same with Effects."

## Previous state
`AdjustmentSection` rendered its header reset whenever `onReset` was set,
and only used `dirty`/`canRevert` to pick the `is-dirty` class:
a clean section still rendered the icon, hidden by
`.section-reset { opacity: 0 }` and revealed by the
`.adjustment-heading:hover .section-reset` rule. Curves and Effects pass
an unconditional `onReset` (their `dirty` comes from `curve` /
`vignette`/`fade` values), so hovering a pristine Curves or Effects
header teased a reset that had nothing to restore. Task 3 explicitly
kept this hover-only base for the slider sections pending this task.

## Audit
The same unconditional-`onReset` shape existed in all five slider
sections — White Balance, Lightness, and Hue & Saturation teased on
hover exactly like Curves/Effects. The snapshot sections (Auto/Scene
Enhance, Enhance Faces, Subject & Background, Denoise) already omit
`onReset` while clean, so they never had the defect; repair sections
pass no `onReset` and crop has no adjustment headers. One shared gate
fixes every current and future consumer.

## Change
- `packages/ui/src/components/AdjustmentSection.tsx`
  - The header reset now renders only when `onReset` is set AND the
    section is non-default (`dirty || ml.canRevert`). A clean section
    renders no reset markup at all — nothing to hover, focus, or
    screen-read. The rendered control is therefore always dirty, so the
    class is the constant `section-reset is-dirty`.
  - `dirty` prop doc and header comment updated to the render-gate contract.
- `apps/web/src/index.css`
  - Base `.section-reset` is now `opacity: 1` (the transition went with
    the hidden state); the `:hover` / `:focus-visible` reveal rule is
    deleted. `.section-reset.is-dirty` stays as the standalone
    `cssRule(selector)`-pinnable contract matching the markup.
  - The responsive `display: none` / `display: flex` rules are untouched.

## Tests
- New `packages/ui/src/components/noResetWhenClean.test.tsx` (repo
  convention: server-rendered, no jsdom):
  - Curves clean → no reset in the Curves slice (bounded by the Curves
    and Details headings); `curve: 25` → persistent reset;
  - Effects clean → no reset in the Effects slice (bounded by the
    Effects heading); each of `vignette`/`fade` dirty → reset;
  - defaults adjust render → zero `section-reset` anywhere (the shared
    gate, not a per-section fix);
  - `AdjustmentSection` matrix: `onReset` alone renders nothing, `dirty`
    renders, snapshot-only (`canRevert`, default values) renders.
- Updated to the no-render contract: `resetPerAdjustment` (defaults
  absence, dirty-matrix others-absence via `aria-label`, legacy-disabled
  absence, CSS contract now pins base `opacity: 1` plus the absence of
  both reveal rules), `adjustmentMl` (idle sections pin absence; the
  rightmost-ML test uses an all-dirty edit for the reset-left-of-ML
  check plus a defaults ML-stands-alone check), `singleResetIcon`
  (defaults sweep now pins 0 icons in every header).
- Full `@f8/ui` suite (32 files / 261 tests) passes; `@f8/ui` and
  `@f8/web` typechecks pass (`ui` dist rebuilt first — web resolves
  `@f8/ui` from dist); lint is an unconfigured no-op echo. No
  Playwright (per task rules).

## Decisions
- Gate in the shared component rather than per-section `onReset`
  conditioning: the five slider sections legitimately always HAVE a
  reset target (defaults), unlike the snapshot sections which omit
  `onReset` when there is nothing to clear — so `onReset` presence
  cannot mean "show" for both shapes. `resetActive` is the single
  source of truth.
- Kept the `is-dirty` class on the rendered control instead of dropping
  it as redundant: it keeps the wide `section-reset is-dirty` test
  contract stable and still truthfully describes the rendered state.
- No README update: header-visibility correction, no architecture or
  feature-surface change.
