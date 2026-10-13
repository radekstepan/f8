# Task 9: Denoise actions become golden links, not grey buttons

## Symptom

The Denoise section's "Restore denoise" control rendered as a grey
`slim-button`, while every sibling action around it (Update preview,
Clear, Cancel, Retry, Dismiss) was already the golden `text-button`
link. The same grey treatment also covered the other two Denoise
actions, "Preview denoise" and "Apply to photo".

## Root cause

`DenoiseControl` (`packages/ui/src/components/Inspector.tsx`) gave its
three primary actions `class="slim-button…"` — the grey raised-button
style — while the rest of the control (and the Task 6 convention that
gold is reserved for links/actions) uses `text-button` (`#b8a279`,
hover `#f0d496`). Two CSS gaps went with the swap:

- The idle preview button's top rhythm lived in
  `.denoise > .slim-button.full-width`, so a bare class swap would have
  dropped its 10px margin.
- No `text-button` had ever been `disabled` before, so the sheet had no
  `.text-button:disabled` rule and the `:hover` brightening applied
  unconditionally — the strength-0 disabled preview link would have
  looked active and lit up on hover.

## Fix

- `packages/ui/src/components/Inspector.tsx` — `denoise-preview`,
  `denoise-apply`, and `denoise-restore` are now `text-button`
  (preview keeps `full-width`, so it stays a centered full-row link).
  Titles, testids, disabled logic, and handlers are untouched; the
  header ML pill + reset icon are header controls, not in-content
  actions, and keep their styles.
- `apps/web/src/index.css`
  - `.denoise > .slim-button.full-width` renamed to
    `.denoise > .text-button.full-width` (same 10px margin, same
    specificity).
  - `.text-button:hover` narrowed to
    `.text-button:hover:not(:disabled)`, matching every other button
    rule in the sheet (`primary`, `secondary`, `danger`, `slim`).
  - New `.text-button:disabled { opacity: .45; cursor: default; }`,
    mirroring `.slim-button:disabled`.
  - `.slim-button` rules stay: Task 13's controls still use them.

## Scope boundary vs Task 13

Task 9 covers the Denoise section only (the three buttons above —
"all the actions" within the named control). Left for Task 13's wider
"review and fix all the buttons" audit:

- `object-removal-detect` ("Remove people"), `dust-spots-detect`
  ("Find dust spots"), `object-removal-apply` ("Remove N selected"),
  `dust-spots-apply` ("Repair N selected") — explicitly Task 13's.
- `object-removal-retry` (grey `slim-button`) vs `dust-spots-retry`
  (already a `text-button`) — same repair-scope inconsistency for
  Task 13 to unify.
- `face-enhance-apply` ("Apply face enhance", grey `slim-button`) —
  Enhance Faces scope, neither task names it, but it falls under
  Task 13's "fix all the buttons" review, not this Denoise change.

## Tests

- `packages/ui/src/components/denoise.test.tsx`
  - Replaced `uses a slim preview button like the other ML actions`
    with `renders every denoise action as a golden link, never a grey
    button`: pins preview/apply/restore `text-button` classes across
    the idle, preview-ready, and stale states, and asserts no
    `slim-button`/`secondary-button` survives inside the Denoise
    section (bounded to the `<h3>Denoise</h3>`…`<h3>White Balance</h3>`
    slice so later sections can't false-fail it).
  - New CSS test: `.text-button` idle gold, the renamed
    `.denoise > .text-button.full-width` margin rule (plus absence of
    the old selector), `.text-button:disabled` dim, and the
    `:hover:not(:disabled)` guard.
  - Adopted the standard module-level `css`/`cssRule` helpers and
    converted the four older inline CSS reads to them (no assertion
    changes).
- `packages/ui/src/components/mlSections.test.tsx` — header-ML test
  now expects the `text-button full-width` preview link.

## Verification notes

- The disabled preview link (strength 0) is only reachable by dragging
  the slider to 0, which server rendering cannot simulate (initial
  draft is the ISO suggestion or 45), so the disabled state is pinned
  at the CSS-rule level only.
- `.text-button:disabled` (class + pseudo-class) outranks the base
  `.text-button` color rule, and the `:not(:disabled)` hover guard
  means a disabled link can never match the hover brightening —
  specificity verified by rule inspection, matching the sheet's other
  button rules.
