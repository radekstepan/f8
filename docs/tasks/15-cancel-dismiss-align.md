# Task 15: Cancel / Cancel repair / Dismiss share one row treatment

## Symptom

"Cancel repair" sat left-aligned and cramped ~2px under the progress
note, while every "Cancel"/"Dismiss" sat centered in a full-width row
with 10px of breathing room — and the boxed people-error "Dismiss" row
used 8px where all its siblings used 10px.

## Root cause

Two one-offs, not a missing system:

1. `MlProgressView` (`packages/ui/src/components/Inspector.tsx`) rendered
   `ml-cancel` ("Cancel repair") as a bare `.text-button` straight inside
   `.ml-progress` — the only in-content dismissive control without a
   `.suggestion-actions` wrapper. So it missed the row's `margin-top`,
   the `flex: 1` centering, the 27px height, and the 9.5px size: left
   inline text at 10px instead of a centered row link.
2. One stray override, `.assist-message .suggestion-actions
   { margin-top: 8px }`, tightened the boxed people-error Dismiss row
   2px against every other row's 10px, with no visual reason (the
   outside rows also follow margin-bottom-0 notes).

## Fix

- `Inspector.tsx` — `ml-cancel` is wrapped in
  `<div className="suggestion-actions">`. One shared fix point: both
  live call sites (repair ML-heal cancel, straighten warmup cancel)
  render through `MlProgressView`. Testid, title, label, and handlers
  untouched.
- `apps/web/src/index.css` — deleted the dead-after-unification
  `.assist-message .suggestion-actions` override, so the boxed error
  row inherits the standard 10px. No new selectors (the `cssRule`
  helper anchors on `selector\s*{`, so single-selector rules stay).

No row-margin compensation was needed inside `.ml-progress`: the
progress note's 2px bottom margin collapses with the row's 10px top
margin to the same 10px gap as everywhere else.

## Chosen standard

Every in-content Cancel / Cancel repair / Dismiss renders as a golden
`text-button` inside a `.suggestion-actions` row:

- row: `display: flex; gap: 8px; margin-top: 10px`
- link: `flex: 1; height: 27px; font-size: 9.5px`, centered gold text

Lone dismissive controls stretch full-width centered, exactly like
their paired Apply/Retry siblings — one treatment, no per-instance
padding.

## Audit table

| Control | Before | After | Notes |
|---|---|---|---|
| Cancel repair (`ml-cancel`, repair + straighten) | bare, left, ~2px gap, auto height, 10px | row: centered, 10px, 27px, 9.5px | fixed (wrapper) |
| Working Cancel ×5 (people/dust/faces/subject/denoise) | row | row | already standard, pinned |
| Empty-found Dismiss ×4 (no people/dust/faces/subject) | row | row | already standard, pinned |
| Review Cancel ×4 (people/dust lists, face ready, denoise preview) | row (paired) | row | already standard, pinned |
| Error Dismiss ×4 (dust/face/selective/denoise) | row (paired w/ Retry) | row | already standard, pinned |
| Error Dismiss, boxed people error | row, 8px | row, 10px | fixed (override deleted) |
| Retry ×5 (people/dust/face/selective/denoise errors) | row | row | consistent, untouched |
| Retry (`ml-retry`, server-offline alert) | inline alert line | unchanged | deliberate alert pattern, out of scope |
| Clear ×2 (denoise stored/drifted) | row | row | consistent, untouched |
| Clear ×2 (face/selective applied rows) | inline, right, compact | unchanged | inline status-row context (toggle + links on one line); a 27px full-width row would break the layout |
| Rescan ×2 (face/selective applied rows) | inline, right, compact | unchanged | same applied-row context |
| Modal Cancel ×3 (export/album/preset) + Cancel upscale | secondary-button, right footer | unchanged | dialog chrome (Task 13 boundary) |

## Scope boundary

- Noted, not fixed: the straighten warmup cancel reuses the
  "Cancel repair" label/title ("Stop this repair and restart the
  worker") via the shared `MlProgressView`. Misnomer, but a label
  issue — this task owns padding + alignment only.
- Object-removal errors render boxed (`.assist-message`) while the
  other four error states render plain note + row. Structural
  difference, out of scope; the Dismiss row inside now matches the
  standard either way.

## Tests

- New `packages/ui/src/components/cancelDismissAlign.test.tsx` (6 tests):
  - Repair battery (8 states) + adjust battery (10 states): every
    Cancel/Dismiss/Cancel repair occurrence sits inside a
    `.suggestion-actions` row (nearest-row-open-beats-div-close check;
    rows hold buttons only, so the check is exact), with exact
    per-render counts so no case passes vacuously.
  - `ml-cancel` adjacency pin
    (`<div class="suggestion-actions"><button class="text-button"
    data-testid="ml-cancel"`) in both the ml-heal and straighten
    renders.
  - CSS pins: row flex/gap/10px, links flex-1/27px/9.5px, and absence
    of the `.assist-message .suggestion-actions` override.
  - Boundary pins: album-dialog Cancel stays `secondary-button` in
    `.modal-footer`; the applied-row compact overrides stay.
- Pre-fix proof: with the two fix files stashed, exactly the 3
  fix-covering tests fail (2 row pins + CSS override pin) while the 3
  already-consistent batteries pass; with the fix, all 6 pass.

## Verification notes

- Specificity: `.suggestion-actions > button` (0,1,1) outranks
  `.text-button` (0,1,0) for height/font-size, and
  `.text-button:disabled` (0,2,0) still wins for the dim — the wrapped
  `ml-cancel` inherits the same cascade as every other row link.
- Full `@f8/ui` suite: 35 files / 282 tests pass; `tsc --noEmit`
  clean. Lint is an unconfigured no-op echo. No Playwright (per brief).
