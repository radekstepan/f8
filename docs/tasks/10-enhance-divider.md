# Task 10: Remove the divider line above "Enhance Faces" / "Enhance Subject…"

## What changed

The "ML Enhance" inspector section stacks its Scene / Faces /
Subject / Denoise actions vertically, and every action after the
first got a full-width `border-top` line from a single ML-scoped
sibling rule:

```css
.ml-enhance > * + * { border-top: 1px solid #343438; margin-top: 12px; padding-top: 12px; }
```

That rule — not any shared section style — drew the ugly
horizontal lines above "Enhance Faces" and "Enhance Subject &
Background". The rule now spaces the stacked actions with a
margin only (`margin-top: 12px`); the border is gone.
(`apps/web/src/index.css`)

No markup or component changes: the section still renders
through the shared `AdjustmentSection` collapse panel from
Task 9, untouched.

## Decisions

- **The line was ML-scoped, not shared.** The shared
  `AdjustmentSection` divider is `border-bottom` on
  `.adjustment-section` (a different color, `#3b3b40`), and the
  standalone `.face-enhance` / `.selective-mask` bottom borders
  are already neutralized inside `.ml-enhance`. So the fix
  touches only the one sibling rule — every legitimate
  separator elsewhere (section dividers, histogram, menus) is
  unaffected.
- **`padding-top` went with the border.** It only existed to
  clear content below the line; without the line it would leave
  a doubled 24px gap. The remaining 12px margin matches the
  rhythm of other stacked inspector blocks.
- **No README update.** One-line CSS fix; no architecture or
  feature change.

## Tests

- `mlEnhanceSection.test.tsx` (+2 tests, following the
  `readFileSync` CSS-assertion precedent from
  `collapsePanels.test.tsx`): the `.ml-enhance > * + *` rule
  contains no border and keeps its spacing margin; the shared
  `.adjustment-section` divider keeps its `border-bottom`.

## Verification

- `yarn workspace @f8/ui test` — 174 passed (25 files).
- `tsc --noEmit` (ui, web) — clean.
- Playwright not run (per task rules).
