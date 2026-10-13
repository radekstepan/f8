# Task 7: Fix Add Adjustment double icon

## What changed

The "Add Adjustment" footer button in the adjust inspector carried two
icons — a `+` before the label and a chevron after it. The `+` is gone;
a single chevron now sits right of the label with modest spacing.

- `packages/ui/src/components/Inspector.tsx`: the `add-adjustment`
  button renders `Add Adjustment<ChevronDown size={12} />` only; the
  `Plus` import is removed (it had no other use). The
  `onClick={() => setAddMenu(!addMenu)}` toggle and `aria-expanded`
  wiring are untouched, so the button still opens the menu.
- `apps/web/src/index.css`: the two per-icon rules
  (`.add-adjustment > svg:first-child` / `:last-child`) collapsed into
  one `.add-adjustment > svg` rule carrying the icon color and 12px
  width. The button keeps `justify-content: center` + `gap: 7px`, so
  the label and chevron stay centered as one group — the chevron is
  near the label, not at the extreme right edge.
- `packages/ui/src/components/addAdjustmentLayout.test.tsx`: rewritten
  for the single-chevron layout (was pinning the old two-icon rules).

## Decisions

- **Kept the chevron, dropped the plus.** The chevron signals "opens a
  menu", which is what the button does (extra sections + Save as
  Preset); the `+` added nothing.
- **No layout/CSS values changed beyond the icon merge.** Center + 7px
  gap already placed the icons snugly next to the label, which is
  exactly the requested "to the right but not extreme right".
- **No README update.** No architecture or user-facing feature change
  beyond the icon cleanup.

## Tests

- `addAdjustmentLayout.test.tsx` (4 tests): rendered button holds
  exactly one `<svg>` after the label with `Add Adjustment<ChevronDown`
  pinned from source and no `Plus` left; menu toggle wiring pinned
  (`setAddMenu(!addMenu)`, `aria-expanded`, `{addMenu && ...menu}`);
  CSS pins center + 7px gap and a single auto-margin-free icon rule.

## Verification

- `yarn workspace @f8/ui test` — 165 passed.
- `tsc --noEmit` — clean for ui and web.
- Playwright not run (per task rules).
