# Task 2: Fix Denoise Cancel + align tool actions

## Problem

Two reports in one: (1) clicking "Cancel" under Denoise (preview-ready
state) did nothing; (2) action alignment was inconsistent — some actions
left-aligned, some right-aligned, "Preview denoise" center-aligned on its
own metrics.

Root cause of (1): `useDenoise.dismiss` handled `error`/`previewing` (→
`idle`) and `applying` (→ `applied`/`idle`), but `preview-ready` fell
through `return current` — a literal no-op, so the preview-ready Cancel
button called `onDismiss` and nothing happened. A second, latent dead end
hid in the same function: cancelling a re-preview of an already-applied
photo landed on `idle` with a stored recipe and a live base, a combination
the control renders with no actions at all.

Audit for (2): nearly every in-content tool action already lived in the
shared `.suggestion-actions` row (full-width flex, equal-stretch golden
links, centered labels, 10px rhythm — pinned by
`cancelDismissAlign.test.tsx`), with two bare-button outliers: the idle
"Preview denoise" (`.text-button.full-width`, 10px/auto-height vs the row's
9.5px/27px) and the offline "Retry" (inline left after the alert text).
Right-pushed variants (header `.section-actions` chrome, face/subject
inline applied rows) were intentional and test-pinned.

## Change

- `packages/core/src/vision/denoise.ts`: new pure helper
  `dismissDenoiseStatus(state, hasBase)` (+ shared `DenoisePhase` union).
  Every transient phase (`previewing`, `preview-ready`, `applying`,
  `error`) drops to the surrounding state — `applied` while denoised
  pixels are on screen (kept), else `idle`; settled phases return null.
- `apps/web/src/vision/useDenoise.ts`: `dismiss` delegates to the helper
  (clearing the preview on any real transition). Preview-ready Cancel now
  returns to idle/applied; the re-preview dead end now returns to applied.
- `packages/ui/src/components/Inspector.tsx`: idle "Preview denoise"
  wrapped in `.suggestion-actions` (dropped `full-width` + inner span);
  preview-ready Cancel gains `data-testid="denoise-cancel-preview"` +
  tooltip; offline "Retry" wrapped in `.suggestion-actions`.
- `apps/web/src/index.css`: deleted the one-off
  `.denoise > .text-button.full-width` rule (the row supplies the rhythm);
  added the compact inline override for `.ml-offline
  .suggestion-actions` (right-pushed, buttons `flex: none`), mirroring the
  face/subject applied rows.
- Tests: new `denoiseCancelAlign.test.tsx` (6 tests) + 3
  `dismissDenoiseStatus` cases in core `denoise.test.ts`; updated the two
  pins of the old bare-button markup (`denoise.test.tsx`,
  `mlSections.test.tsx`).

## Decisions

- Convention: every in-content tool action is a golden `.text-button`
  inside a shared `.suggestion-actions` row. Block rows stretch
  full-width with centered labels; inline rows (actions sharing a status
  line) stay compact and right-pushed. Chose the row because it was
  already the ~universal pattern with pinned spacing/weight semantics —
  the fix deletes outliers instead of inventing a third style.
- Dismiss keeps applied pixels and returns to `applied` (not a full
  reset like the other vision hooks): denoise's applied base drives the
  canvas/export, so resetting it while the recipe stays stored would show
  the noisy original as if denoised. The helper encodes "transient → the
  state the pixels are in".
- Out of scope, deliberately unchanged: header `.section-actions`
  (right-aligned panel chrome, already consistent), the straighten Auto
  status row (pairs the toggle with live status text, not an action row),
  the Black & White grey toggle (centered full-width, color is a separate
  concern), modal footers (dialog chrome per the Task 13 boundary).
- The two updated markup pins are the intended contract change the task
  asked for (bare centered button → shared row), recorded here rather
  than silently rewritten.
- No README update: bug fix + alignment, no architecture change.
- Doc number `14-` continues the existing `docs/tasks/NN-` running log.

## Tests

- Core `denoise.test.ts` (+3): every transient phase → `idle` without a
  base (preview-ready is the reported case); every transient phase →
  `applied` with a base (the dead-end case); settled phases → null.
- New `denoiseCancelAlign.test.tsx` (6, server-rendered + stylesheet
  pins, no jsdom): preview-ready Cancel has its testid in the row
  alongside Apply/Update; working Cancel in the row; idle Preview in the
  row with no `full-width` and no one-off CSS rule; all six denoise
  phases render an action row with no bare/grey buttons; block-row CSS
  (flex, 10px rhythm, stretch, centered labels); offline Retry in a
  compact right-pushed row with the same override as the face/subject
  applied rows.
- Updated pins: `denoise.test.tsx` (golden-link + style tests),
  `mlSections.test.tsx` (denoise content action).

## Verification

- `packages/core`: full suite — 54 files, 923 tests, all pass.
- `packages/ui`: full suite — 64 files, 507 tests, all pass.
- `typecheck` clean in `packages/core` (via build), `packages/ui`,
  `apps/web`, and `apps/server`.
- Playwright not run (out of scope per task rules).
