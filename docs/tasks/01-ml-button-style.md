# 01 — Enabled ML button matches the enabled Auto style

## Request
"Why is the 'enabled' ML button so different from enabled 'Auto' button like
in 'Denoise'? I like the style of the 'Auto' button when enabled."

## Root cause
The two header actions are separate CSS classes in `apps/web/src/index.css`,
and only their enabled (`.is-active`) states diverged:

- `.auto-small.is-active` (Denoise/straighten/Auto Enhance style): muted gold
  text `#f0d397` on `#33302a`, `#8b7650` border + inset ring.
- `.ml-button.is-active`: much brighter treatment — `#ffd98a` text on
  `#4d4125`, `#c9a44f` border + inset ring — plus its own
  `.ml-button.is-active:hover` override (`#5a4c2c`) that Auto has no
  equivalent of.

Idle and plain-hover states were already identical apart from the ML label's
bold weight + letterspacing, so the enabled state was the only visual split.
All ML header buttons (`white-balance-ml`, `scene-enhance-ml`,
`face-enhance-ml`, `selective-mask-ml`, …) render through the one shared
`AdjustmentSection` (`ml-button` + `is-active` + `aria-pressed`), so the CSS
was the single root cause — no markup change needed.

## Change
- `apps/web/src/index.css`: `.ml-button.is-active` now carries exactly the
  `.auto-small.is-active` declarations; the ML-only
  `.ml-button.is-active:hover` override is deleted, so hover-on-active
  behaves identically too (for Auto, the later `.is-active` rule already wins
  over `:hover` at equal specificity).
- Deliberately kept: the idle `.ml-button` bold/letterspaced label. The
  complaint was only about the enabled state, and the label distinction keeps
  "ML" vs "Auto" honest.
- Supporting evidence this is the right palette: `.slim-button.is-active`
  and `.ml-badge` already use the same `#f0d397` / `#33302a` / `#8b7650`
  tokens, so ML-active now matches the rest of the app's active conventions.
  The old brighter tokens (`#ffd98a`, `#4d4125`, `#c9a44f`, `#5a4c2c`) had no
  other consumers in the stylesheet.

## Tests
- New `packages/ui/src/components/mlButtonStyle.test.tsx` (repo convention:
  server-rendered, no jsdom + CSS rule pinning):
  - enabled ML rule body equals enabled Auto rule body,
  - no `.ml-button.is-active:hover` / `.auto-small.is-active:hover` override,
  - idle ML keeps bold + letterspacing,
  - applied/idle markup for both kinds renders the expected
    `is-active` + `aria-pressed` contract via `AdjustmentSection`.
- No existing test asserted the old colors (they pin class names only), so no
  updates needed. Full `@f8/ui` suite + typecheck pass.

## Decisions
- Fix in CSS, not by merging classes: keeping `ml-button` and `auto-small` as
  separate selectors with identical active bodies preserves the existing file
  style (idle/hover are already duplicated this way) and keeps the
  `cssRule(selector)` test helper matching — a combined
  `.auto-small.is-active, .ml-button.is-active` selector would break that
  helper's `{`-anchored lookup for the first selector.
- No README update: pure visual unification, no architecture or feature
  change.
