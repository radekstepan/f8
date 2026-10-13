# Task 6: Remove film strip ML actions, fix popover cutoff

## What changed

**1. Scene Enhance / Enhance Faces removed from the film strip.**

- `packages/ui/src/components/PhotoStrips.tsx`: the `Filmstrip`
  component no longer takes `onSceneEnhance` / `onFaceEnhance`; its
  right-click menu is now Export 2x + Favorite + Remove only, and the
  menu enables off `onExport2x` alone.
- `apps/web/src/App.tsx`: the `<Filmstrip>` call site no longer passes
  the two handlers. The `<PhotoBrowser>` (library grid) call site is
  untouched, so both actions stay available there plus the Image menu,
  inspector, and Shift+A / Shift+E shortcuts.

**2. Context-menu popover no longer clips at the viewport edge.**

- Root cause: `usePhotoContextMenu` positioned the menu at the cursor
  with a fixed-size clamp (`viewport - 240 x 160`). The real menu is
  taller than 160px, and the film strip sits at the viewport bottom,
  so the menu always opened below the cursor and ran off-screen.
- `packages/core/src/menuAnchor.ts`: new pure `anchorMenuAtCursor`
  helper next to the existing `anchorMenuBelowTrigger` — opens
  below/right of the cursor, flips above/left when that side would
  clip, then clamps both axes with the shared 8px edge clearance.
- `packages/ui/src/components/PhotoStrips.tsx`: `usePhotoContextMenu`
  now records the cursor anchor on open and, in an isomorphic layout
  effect (same pattern as the sidebar album menu), measures the
  mounted menu and re-anchors it before paint. The seeded
  `initialContextMenu` test seam keeps its pinned coordinates.

## Decisions

- **Kept Export 2x in the film strip menu.** The task names only the
  two enhance actions; Export 2x still opens the export dialog
  pre-checked and stays.
- **Fixed positioning in the shared hook, not just the film strip.**
  The library grid menu had the same fixed-estimate clamp and could
  clip near the bottom/right edges too; both now measure and flip.
- **No README update.** The README describes both actions as available
  from "a photo's right-click menu", which is still true via the
  library grid; nothing architectural changed.

## Tests

- `packages/core/src/menuAnchor.test.ts`: new `anchorMenuAtCursor`
  suite — opens at cursor, flips above near the bottom, flips left
  near the right edge, flips both in the corner, clamps at edges,
  pins oversized menus inside.
- `packages/ui/src/components/photoContextMenu.test.tsx`: the
  film strip menu test now pins the removal (no Scene Enhance /
  Enhance Faces, still Export 2x + Favorite); the other two film
  strip tests drop the removed props. Library-grid ML menu coverage
  is unchanged and still passes.

## Verification

- `tsc --noEmit` — clean for core, ui, and web (rebuilt the
  git-ignored core `dist` first, since ui typechecks against it).
- `vitest run` — core 798 passed, ui 163 passed.
- Playwright not run (per task rules).
