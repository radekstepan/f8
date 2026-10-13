# Task 5: Subject & Background wide gold "slider"

## Symptom

With a subject mask stored, the "Subject & Background" section showed a weird
gold bar stretched across the applied row — like a slider track, much wider
than any other switch in the panel.

## Root cause

The "slider" was the section's enable toggle (`Toggle`, a slide switch that is
gold while on, like every other switch). It rendered wide because of a dead
CSS rule in `apps/web/src/index.css`:

```css
.auto-enhance-row > button:first-child { ...; flex: 1; ... }
```

That selector was written for the long-gone Auto Enhance label button. The only
two `auto-enhance-row` consumers left are Enhance Faces (summary `<span>` first,
toggle second — immune) and Subject & Background, whose toggle IS the row's
first child. So the rule matched exactly one element in the entire app: this
toggle, stretching the 25px switch across the row.

The intended guard (`.selective-mask-row > .toggle { flex: none; }`, added in
task 12) never worked: it loses the specificity battle (0,2,0 vs 0,2,1 for the
`button:first-child` rule), so `flex: 1` always won. That is why the section
"still" had the bug.

## Fix

Deleted the two dead `.auto-enhance-row > button:first-child` rules (base + `>
svg`); no markup anywhere renders that pattern anymore (verified by exhaustive
grep — only the two Inspector rows use the class). The toggle now falls back to
the standard `.toggle` (25px, gold while on) plus the `flex: none` guard —
identical treatment to the Enhance Faces toggle. Left an explanatory comment at
the deletion site so nobody re-adds a first-child button rule there.

Scope note: the gold *on-state* itself is the standard switch style shared by
Enhance Faces, Details, and every other toggle — only the stretched width was
the anomaly, so only the stretch was fixed.

## Tests

Extended `packages/ui/src/components/selectiveMask.test.tsx`:

- Markup contract: the toggle is the row's first child with standard
  `toggle is-on` classes (pins why row CSS must avoid first-child buttons).
- CSS regression: no `.auto-enhance-row > button:first-child` rule exists.
- CSS parity: the selective row's toggle guard equals the faces row's guard
  (`flex: none`) and `.toggle` stays `width: 25px`.

## Verification

- `yarn workspace @f8/ui test` (full suite) — all pass.
- `yarn workspace @f8/ui typecheck` — clean.
- `yarn workspace @f8/ui lint` — no-op (`(no lint configured)`), same as before.
- Playwright not run (per task rules).
