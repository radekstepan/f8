# Task: Curves/Effects/Details toggled buttons, no more reset button

## Request

Changing Curves should show a toggled button just like the other
controls. Same with Effects and Details possibly. No more "reset"
button in the adjustments side-panel.

## Change

Every Color Adjustments section header now carries exactly one
switch, and the per-section reset button is gone structurally:

- `packages/ui/src/components/Inspector.tsx`
  - Curves, Details, and Effects moved from `onReset`/`dirty` to the
    shared `toggle` prop: `curves-toggle`, `details-toggle`, and
    `effects-toggle` light on the first tweak (Midtones bend, curve
    anchors, clarity/sharpness/grain, vignette/fade) and reset their
    section to defaults on click. The dirtiness expressions moved into
    `curvesDirty`/`detailsDirty`/`effectsDirty` consts, mirroring the
    White Balance/Lightness/Color pattern.
  - Black & White moved to a `black-and-white-toggle` that flips the
    recipe flag both ways (off-to-on converts, on-to-off restores
    color); the explicit content button stays as the labeled action.
  - One-Click Removal / Dust Spots `ml` literals dropped the dead
    `canRevert`/`onRevert` fields.
- `packages/ui/src/components/AdjustmentSection.tsx`
  - Removed the `onReset`/`dirty` props and the reset-icon rendering,
    and removed the `canRevert`/`onRevert` snapshot fields from
    `AdjustmentMl` (no production caller ever passed `canRevert:
    true`). The shared header can no longer render a reset by
    construction; a source-level test pins that.

What deliberately stays: the panel header's "Reset auto enhance"
icon (it restores the pre-enhance snapshot, not defaults — removing
it would strand the Auto Enhance undo), the crop tool's straighten
revert row, the "Reset All Adjustments" menu item, and the
double-click slider resets. The `.section-reset` CSS now serves only
the panel-header icon.

## Decisions

- **Disabled-while-off for the suggestion-less switches, not a
  no-op toggle.** Curves/Details/Effects have no auto suggestion to
  apply, so off-to-on has nothing to do — the Denoise no-suggestion
  precedent (disabled switch + state-describing tooltip) applies:
  "Curves at defaults" while off, "Curves on — click to reset to
  defaults" while lit.
- **Converted Details and Black & White too, not just
  Curves/Effects.** Leaving either on a reset would keep a reset
  button in the side panel and break the one-switch-per-header
  contract. Black & White is the one switch that acts in both
  directions (it has a real off-to-on action: convert).
- **Removed the latent snapshot-revert path from the shared header
  rather than keeping it for future ML sections.** It had zero
  production callers, and the task wants the reset gone — a latent
  `section-reset` render path would invite regressions. Future
  snapshot UX can re-add an explicit control if needed.
- **Toggle-off resets call `onChange` directly** (as the old resets
  did) instead of going through editor-owned category resets: there
  is no in-flight auto to cancel for these sections, so no run-token
  bookkeeping is needed. Still a single undo step, as before.

## Tests

- Updated 12 suites to the switch contract: `resetPerAdjustment`,
  `noResetWhenClean` (+ new structural pin that the shared header
  owns no reset), `singleResetIcon` (zero header icons; the panel
  header's enhance icon is the single `section-reset` occurrence),
  `detailsReset`, `detailsToggle`, `curvesPoints`,
  `adjustmentConsistency` (8 header switches now), `autoMlToggle`
  (10/10 switches, no resets), `adjustmentMl`, `collapsePanels`,
  `mlButtonStyle`, `Tooltip`, `sceneEnhance`.
- UI suite: 71 files / 554 tests pass. `typecheck` clean for `@f8/ui`
  and `@f8/web`. No Playwright, per the task rules.
