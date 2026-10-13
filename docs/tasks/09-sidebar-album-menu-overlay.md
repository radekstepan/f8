# Task 09 — Sidebar album menu floats above the UI

## Problem
Clicking the "..." on a sidebar album row opened a menu that was cut off:
the menu was absolutely positioned inside `.sidebar-scroll`
(`overflow-y: auto`, plus `overflow: hidden` on `.library-sidebar`), so the
scroll container clipped it instead of letting it overlay the UI.

## Fix
- `apps/web/src/index.css`: new `.sidebar-album-menu` modifier —
  `position: fixed` (escapes the scroll container's overflow clipping) with
  `z-index: 120`, matching the photo context menu (above modal backdrops).
  It also clears the shared `.album-menu` horizontal pins (`left/right:
  auto`) so the measured inline coordinates place the box without
  stretching it; `top: auto` is the pre-measure fallback.
- `packages/ui/src/components/Sidebar.tsx` (`AlbumRow` only): the open
  menu is measured before paint (isomorphic layout effect) and pinned into
  the viewport via the new `anchorMenuBelowTrigger` helper — below the
  trigger and right-aligned (the historical look), flipping above near the
  bottom edge. The menu stays in the row's React subtree, so outside-click
  and Escape dismissal are unchanged; scroll/resize now also dismiss it so
  the floating menu can't strand away from its row.
- `packages/core/src/menuAnchor.ts` (new, exported from index): pure
  `anchorMenuBelowTrigger` math (below/right-aligned default, flip above
  on bottom clip, both axes clamped into the viewport, oversized menus
  pinned inside).
- `packages/ui/src/components/EditorUI.tsx`: `IconButton` accepts an
  optional `ref`, forwarded to the button so the sidebar can measure its
  menu trigger.

## Decisions
- Fixed positioning (same pattern as the existing photo context menu),
  not a portal: no ancestor has a transform/filter that would break
  `fixed`, and staying in the row subtree keeps dismissal logic untouched.
- A sidebar-only modifier class instead of changing shared `.album-menu`:
  the library-grid sort/album header menus reuse that class inside
  `position: relative` containers and depend on its absolute anchoring.
- No new test seam: per repo convention (see photoContextMenu tests),
  open/close interaction is client-only and left to manual verification;
  the CSS contract and the anchoring math are pinned by tests.

## Verification
- `packages/core/src/menuAnchor.test.ts`: 5 tests (default anchor, flip
  above, left/right clamps, oversized menu).
- `packages/ui/src/components/albumMenuOverlay.test.tsx`: 3 tests (fixed
  + z-index, cleared pins, shared grid rule untouched).
- Full suites: core 741 pass, UI 116 pass; `yarn typecheck` 6/6.
- Manual check (no Playwright): open a bottom-row album "..." — the menu
  should flip above the trigger and overlay the content, never clip.
