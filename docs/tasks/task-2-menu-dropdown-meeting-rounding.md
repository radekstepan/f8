# Task 2 — Square the top-menu trigger/dropdown meeting edges

## Problem

The top menu bar (`MenuBar`) dropdowns open flush with their trigger pills
(`top: calc(100% - 3px)` cancels the trigger's bottom margin), but both
halves kept their full rounding where they meet: the trigger pill's
`border-radius: 3px` bottom corners and the panel's `border-radius: 7px`
top corners, leaving rounded notches along the joined seam.

## What changed

- `apps/web/src/index.css`:
  - New `.menu-trigger.is-open` rule zeroing
    `border-bottom-left/right-radius`, so the open trigger's bottom edge
    flows into its panel. Top corners keep the 3px pill rounding.
  - Extended the existing scoped `.menu-bar .dropdown-menu` rule with
    `border-top-left/right-radius: 0`, so the open panel's top edge flows
    into its trigger. Bottom corners keep the 7px rounding, and the flush
    `top: calc(100% - 3px)` anchoring is untouched.
- `packages/ui/src/components/topbarDropdownRounding.test.tsx` (new,
  6 tests): stylesheet-pinned like the neighboring topbar tests (no
  jsdom) — open-trigger bottom corners squared only via `.is-open`,
  hover-alone/top corners still rounded, `.is-open` + `aria-expanded`
  wiring pinned from `Topbar.tsx` source with a closed-render probe,
  panel top squared while flush, panel bottom still rounded, and every
  other `.dropdown-menu` user (inspector/sidebar/browser) still fully
  rounded.
- No `Topbar.tsx` changes were needed: it already toggles `is-open` /
  `aria-expanded` per open menu, so the fix is pure CSS on that hook.

## Decisions

- **Square on open (`.is-open`), not on hover.** The raw task text says
  "bottom of the button on hover", but squaring a hovered-yet-closed
  trigger would leave square corners with no panel to join — visibly
  broken. The trigger only meets a panel while its menu is open
  (including hover-switching between open menus, which sets `is-open`
  immediately), so `.is-open` is the correct hook.
- **Panel scoped to `.menu-bar`, matching the flush override.** The base
  `.dropdown-menu` rule is shared by inspector/sidebar/browser menus
  with different anchoring; like the existing `top` override, the
  radius override lives on `.menu-bar .dropdown-menu` so it cannot leak.
- **Rounding only, no border surgery.** Only the corner radii change;
  the 1px panel border and trigger background are untouched, keeping the
  diff minimal and the existing flush/edge-alignment contracts green.

## Tests (unit/integration only, no Playwright)

- New `topbarDropdownRounding.test.tsx`: 6/6 pass.
- Neighbors still green: `topbarDropdownFlush.test.tsx`,
  `topbarMenus.test.tsx`.
- Full gates for the touched area: `packages/ui` vitest 373/373,
  `yarn typecheck` clean.
