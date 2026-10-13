# 04 — Denoise Auto moves into the shared header ML button

## Request
"Denoise move 'Auto' into 'ML' in the header like elsewhere. And make
sure ML shows to the right."

## Previous state
Denoise was the odd section out: its header carried a static gold
`MlBadge` next to the title (left side) and no header action, while the
auto suggestion lived in the content as an `Auto` pill
(`denoise-auto-row` / `denoise-auto`, `auto-small` style) next to the
"Suggested for ISO …" text. Every other ML section runs from the
shared right-aligned header ML button (`AdjustmentSection` `ml`
prop, `*-ml` test ids, `.section-actions` row). Denoise also had no
header reset — Task 3 deliberately left it untouched for this rework.

## Change
- `packages/ui/src/components/Inspector.tsx`
  - New `DenoiseSection` wrapper: it owns the draft `slider`/`auto`
    state (moved up from `DenoiseControl`, same initial values and
    per-photo reset) and renders `AdjustmentSection` with the shared
    header action `ml={{ id: 'denoise', applied: auto, … }}` — label
    "ML", `ml-button` class, `denoise-ml` test id, right side in
    `.section-actions` like elsewhere. The title badge is gone.
  - The header ML drives the same auto suggestion the pill did:
    engaging it sets the ISO suggestion and marks auto; the highlight
    follows the auto mark; the button is disabled while working or
    with no suggestion (clean captures). Slider moves still clear the
    mark with the value kept. Clicking while engaged now goes manual
    (clears the mark, keeps the strength) per the shared toggle
    contract, instead of the pill's idempotent re-apply.
  - Header reset follows the Enhance Faces pattern exactly:
    `onReset={applied ? assist.onClear : undefined}`,
    `dirty={applied !== null}` — persistent exactly while a denoise
    is stored (fresh or stale-after-reload), left of the ML button.
    `canRevert` stays false (no pre-apply snapshot exists), so the
    reset always runs `onClear`. Content Preview/Apply/Clear/Restore
    flows are untouched (Restore's link restyle is Task 9).
  - `DenoiseControl` is now draft-controlled (`slider`, `auto`,
    `onDraft` props); the suggest row keeps its text
    (`denoise-suggest-row`) minus the pill. The "Auto N" hint copy
    stays — it names the automatic suggestion, while "ML" is the
    action, matching the section's ML identity (the denoiser is the
    learned model; the suggestion is the ISO ladder).
- `packages/ui/src/components/AdjustmentSection.tsx`
  - `AdjustmentMl` gains two optional fields: `disabled` (passed to
    the header button; omitted when unset, so existing markup is
    byte-identical) and `title` (tooltip override — the generic
    "Automatically adjust denoise with ML" would lie on a disabled
    clean-capture button, and "ML denoise applied" would overclaim a
    draft-only mark). Tooltips preserved verbatim otherwise; the
    engaged one adds the toggle-off ("click to go manual, or drag
    the slider to fine-tune").
  - Touched up the stale "(the straighten/denoise style)" comment:
    denoise no longer uses the content Auto pill (straighten's
    crop-tool pill is out of scope).

## Tests
- `denoise.test.tsx`: high-ISO and clean-capture tests re-pinned to
  `denoise-ml` (`ml-button is-active` + pressed / idle + disabled +
  "needs no denoise" tooltip); section test pins
  `<h3>Denoise</h3></button>` (badge gone). Two new tests: header ML
  closes the shared row (`>ML</button></div>`), `ml-badge`/
  `denoise-auto`/`auto-small` swept from the Denoise tail,
  `.section-actions` pinned `margin-left: auto`, engaged tooltip
  pinned; and the reset contract (persistent left-of-ML while
  stored — fresh and stale — absent when idle). The suggest-row CSS
  test is untouched (row + rule kept).
- `mlSections.test.tsx`: Denoise joins the header-button loop
  (`denoise-ml`, no badge); the badge assertion is gone.
- `resetPerAdjustment.test.tsx`: the Task 3 "no reset yet" pin
  splits — Details still none (Task 12); Denoise none when idle,
  persistent `Reset denoise` while applied (new `denoise` assist
  override).
- `adjustmentMl.test.tsx`: two `AdjustmentSection` unit tests pin
  the new `disabled` passthrough + `title` override and their
  omission/defaults.
- Full `@f8/ui` suite (30 files / 242 tests) passes; `@f8/ui` and
  `@f8/web` typechecks pass; lint is an unconfigured no-op echo. No
  Playwright (per task rules); no e2e spec references denoise
  selectors.

## Decisions
- Toggle, not momentary: the shared header contract is "revert when
  highlighted, otherwise apply", and a pressed header button that
  ignores clicks would feel broken — so engaging/disengaging the
  auto mark replaces the pill's idempotent click. The `auto` recipe
  bit is only stored metadata + App change-detection (no production
  caller recomputes from it), so clearing it is safe.
- `disabled` + `title` as generic optional header-action props
  rather than Denoise-specific branches: they preserve the pill's
  guards and honest tooltips with zero markup change for existing
  consumers (attribute placed after `title`, omitted when unset).
- Reset mirrors Enhance Faces (`applied ? onClear : undefined`)
  rather than restoring slider defaults: the draft is ephemeral
  (per-photo, preview-gated) while the stored denoise is the
  section's non-default state — so `dirty` is exactly
  `applied !== null`, the key its reset restores.
- No README update: header-control convergence, no architecture or
  feature-surface change.
