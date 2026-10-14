# Task 5: Export button only on photo view

## Problem

The toolbar's Export button rendered unconditionally, so it showed in the
library/album grid where no photo is in focus. Clicking it there would open
the export dialog for a stale or placeholder photo.

## Change

- `packages/ui/src/components/Topbar.tsx`: gated the toolbar Export button
  on the existing `showPhotoTools` prop (the same gate already used by the
  tool switcher, history buttons, presets, reset, compare, and info
  controls). Album/library view now omits it entirely (absent, not
  disabled); photo view is unchanged. No `App.tsx` change was needed — it
  already passes `showPhotoTools={shouldShowPhotoTools(view)}`.

## Decisions

- Scoped the change to the visible toolbar button only. The File menu's
  "Export Photo..." item and the Ctrl/Cmd+Shift+E shortcut still work from
  anywhere, matching how other photo actions (e.g. Auto Enhance in the
  Image menu) remain reachable via menu/shortcut. The task complained about
  the visible button, and removing menu/shortcut paths would be a larger
  behavior change.
- No README update: no architecture or user-facing workflow changed beyond
  hiding one button in one view.

## Tests

- Updated `packages/ui/src/components/photoToolsGating.test.tsx`:
  - `export-button` moved from the "library kept" assertions to the
    "omits every photo-only control" test.
  - Renamed "keeps the library controls (sidebar, export, focus)" to
    "(sidebar, focus)" and updated the file comment.
- Full `@f8/ui` suite: 60 files / 474 tests pass. `yarn typecheck` clean.
  Playwright not run (per task rules).
