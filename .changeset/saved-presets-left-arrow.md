---
'@f8/ui': patch
---

The Color Adjustments "..." menu's Saved Presets row now leads with a left-pointing arrow instead of trailing a right chevron, matching its left-opening flyout and sitting left-aligned like the other rows; while a saved preset is the active look the slot shows a check as before.

## Task writeup (docs/tasks/67-saved-presets-left-arrow.md)

## Request

Saved Presets should be left aligned like the other presets and show the
arrow to the left.

## Change

- `packages/ui/src/components/Inspector.tsx`: the ... menu's Saved Presets
  parent no longer trails a right chevron flushed to the row's right edge
  (`margin-left: auto`). The leading check slot now carries the submenu
  arrow itself — a `ChevronLeft` pointing at the left-opening flyout —
  swapping to a `Check` only while a user-saved preset is the active look.
  Nothing trails the label anymore, so the row reads left-aligned like its
  siblings (`<span>Saved Presets</span></button>`). The `ChevronRight`
  import is gone (it had no other use in the file); `has-submenu`,
  `aria-haspopup`/`aria-expanded`, and `data-submenu` are untouched.
- No CSS change: the arrow reuses the existing `.menu-check` slot (same
  13px-in-12px geometry the check always had) and keeps the `menu-chevron`
  class, so the generic grey/gold chevron colors still apply and the label
  sits exactly where it did — aligned with the flyout's own preset rows.
- `packages/ui/src/components/savedPresetsSubmenu.test.tsx` (updated, still
  11 tests): the parent test pins a leading `lucide-chevron-left` with no
  right chevron in the row and nothing after the label; the check test now
  pins the one-icon slot contract (check while a saved preset is active,
  left arrow for Original/built-ins).

## Decisions

- **Arrow in the check slot, not a new leading element.** A separate
  left chevron flex item would push the label ~33px right of where it
  sits today (and of the flyout preset labels); reusing the slot keeps the
  label byte-identical in place while moving the arrow left.
- **Check wins the slot while active.** Showing both icons would overlap
  the label; the active parent now looks exactly like any other checked
  menu item (e.g. View's Show toggles), and hover/click still open the
  flyout, so no affordance is lost.
- **No README update.** One-row menu restyle, no architecture change or
  complex feature.

## Tests

- Updated `savedPresetsSubmenu.test.tsx`: 11 tests pass.
- Full suites: UI 88 files / 704 tests, core 67 / 1180, server 19 / 181 —
  all pass. `yarn workspace @f8/ui typecheck` clean. No Playwright, per
  the task rules.
