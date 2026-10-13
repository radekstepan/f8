# Task 5 — Gate photo-only toolbar buttons to the photo view

## Problem

The toolbar rendered its full photo-editing control set in every view,
so the library grid showed the hide-presets toggle, compare-with-original,
photo-info button, and the Adjust/Repair/Crop tool switcher — controls
with no open photo to act on. (The presets toggle even jumped to the
editor as a side effect, and the compare action did the same.)

## What changed

- `packages/core/src/photoTools.ts` (new): `shouldShowPhotoTools(view)`
  pure predicate — true only for the editor view — following the
  `shouldShowPhotoBacklink` precedent; exported from
  `packages/core/src/index.ts`.
- `packages/core/src/photoTools.test.ts` (new, 2 tests): editor shows,
  library hides.
- `packages/ui/src/components/Topbar.tsx`: new optional
  `showPhotoTools` prop (defaults to true, so the full toolbar stays the
  default shape). When false, the `editing-tools` group
  (Adjust/Repair/Crop) and the presets-toggle, compare, and info buttons
  are omitted from the markup entirely — not rendered disabled.
  Undo/redo, reset, export, focus mode, and the sidebar toggle are
  untouched.
- `apps/web/src/App.tsx`: derives
  `const showPhotoTools = shouldShowPhotoTools(view);` next to the
  existing `showBacklink` derivation and passes it to `Toolbar`.
- `packages/ui/src/components/photoToolsGating.test.tsx` (new, 5 tests):
  server-rendered (no jsdom) like the neighboring topbar tests — full
  toolbar on a photo, default-true shape, every photo-only label absent
  in library mode (plus no `editing-tools`/`tool-button` markup), the
  library-kept controls still present, and App wiring pinned from
  source.
- No `README.md` update: a view-gating fix, not architecture.

## Decisions

- **Omit, don't disable.** A disabled Adjust button in the grid invites
  "how do I enable it?"; an absent one reads as "not applicable here".
  This also matches how the backlink swaps for static text rather than
  disabling.
- **Gated exactly the controls the task names.** Undo/redo, reset,
  export, and focus mode stay visible in the library: reset/undo/redo
  still operate (on the selected photo's recipe) and export/focus are
  view-agnostic. Widening the gate would have been scope creep.
- **Menus and shortcuts untouched.** Image > Compare and the B/I keys
  still work from the library (compare opens the editor); the task is
  about visible buttons, not reachable actions.
- **Default-true optional prop.** Keeps every existing `Toolbar`
  call-site test photo-shaped without edits; App is the single place
  that derives the value from the view.

## Tests (unit/integration only, no Playwright)

- New `photoTools.test.ts`: 2/2 pass; new `photoToolsGating.test.tsx`:
  5/5 pass.
- Full `@f8/core` suite: 864/864 pass, `typecheck` clean.
- Full `@f8/ui` suite: 414/414 pass, `typecheck` clean.
- `apps/web` `tsc --noEmit` clean (after rebuilding `@f8/core` and
  `@f8/ui` dist, which the web app resolves).
