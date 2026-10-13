# Task 9: Unify collapse panels, fix the ~1px text shift

## What changed

Collapsing or expanding "Dust Spots" / "One-Click Removal" (and every
other inspector panel) nudged the surrounding text by ~1px. Two
independent causes, both fixed:

1. **Collapsed headings were 1px shorter (the reported shift).**
   `.adjustment-heading` has `min-height: 41px`, but the collapsed
   override set `min-height: 40px`. Heading content (~35px) sits below
   both minima, so the minima bind and every toggle resized the
   heading by exactly 1px — moving the panel's own centered title by
   half a pixel and every panel below it by a full pixel. The
   override is removed; collapsed headings are now 41px like open
   ones. (`apps/web/src/index.css`)
2. **Scrollbar appearing/disappearing reflowed text sideways.**
   `.inspector-scroll` uses `overflow-y: auto` with layout-affecting
   thin scrollbars, so a toggle that crossed the overflow threshold
   handed the scrollbar width back to the content and every line
   jumped horizontally. The container now uses
   `scrollbar-gutter: stable`, reserving the gutter whether or not
   the scrollbar is shown. (`apps/web/src/index.css`)

Unification:

- `packages/ui/src/components/AdjustmentSection.tsx` (new): the
  collapse/expand panel — previously an export buried inside the
  894-line `Inspector.tsx` — now lives in its own shared module
  (component plus `AdjustmentMl` / `AdjustmentSectionProps` types,
  exported from the package index).
- `packages/ui/src/components/Inspector.tsx`: imports the shared
  component; all 13 panels (adjust: ML Enhance, White Balance,
  Lightness, Hue & Saturation, Curves, Details, Effects,
  Black & White; repair: Brush, Reconstruction, One-Click Removal,
  Dust Spots, Repairs) render through it unchanged.
- `packages/ui/src/components/adjustmentMl.test.tsx`: import
  updated to the new module; no behavior change.
- `packages/ui/src/components/collapsePanels.test.tsx` (new): 6
  tests (see below).

## Decisions

- **Audit found a single implementation already.** Every
  collapse/expand panel in the app already used `AdjustmentSection`;
  menus, popovers, and the presets hide/show are different patterns
  (dropdowns / whole-panel visibility), not section disclosures, so
  there was nothing else to convert. The unification work was
  therefore extraction into a genuinely shared, reusable module
  rather than a rename or a rewrite, and the established
  `AdjustmentSection` name was kept to avoid churn.
- **Chevron swap ruled out as a cause.** Open and collapsed states
  render `ChevronDown` / `ChevronRight` at identical 12x12 boxes
  (plus `svg { flex-shrink: 0 }`), so the swap cannot move layout;
  it was left as-is and is now pinned by the header-equality test.
- **No README update.** Small refactor plus CSS fix; no
  architecture or feature change.

## Tests

- `collapsePanels.test.tsx` (6 tests): every Repair panel and
  every adjust panel renders through the shared disclosure (one
  section + one disclosure header per panel; each title inside its
  disclosure button); the single implementation lives in the shared
  module (Inspector owns no disclosure markup); open vs collapsed
  headers are byte-identical modulo `aria-expanded` + chevron, with
  both chevrons at 12x12; CSS pins the 41px heading with no
  collapsed override and `scrollbar-gutter: stable` on
  `.inspector-scroll`.

## Verification

- `yarn workspace @f8/ui test` — 172 passed (25 files).
- `tsc --noEmit` (ui, web) — clean.
- Playwright not run (per task rules).
