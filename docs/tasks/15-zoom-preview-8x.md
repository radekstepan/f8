# Task 3: Zoom-in-view 8x corner preview with shortcut

## Request

Zoom in view is something with a toggle (checkbox) in the dropdown,
has a shortcut and show (like on Photoshop) a square in the bottom
right corner and be 8x zoom.

## Starting point

A prior change (commit `b09ca22`, docs/tasks/11-zoom-in-view.md)
already added a "Zoom in View" checkbox under the View menu, but as a
circular cursor-following loupe at 16x with no shortcut. This task
reshapes that into what the task text asks for: a fixed square in the
bottom-right corner, 8x, with a keyboard shortcut.

## Change

- `packages/core/src/zoomLens.ts`: `ZOOM_LENS_MAGNIFICATION` 16 → 8.
  Removed `clampZoomLensCenter` (and `LensPoint`) — the pane is fixed,
  so cursor-clamping geometry is dead code. `shouldShowZoomLens` and
  `zoomLensSourceRect` are unchanged in shape; the source rect still
  follows the cursor, now at 8x.
- `packages/ui/src/components/PhotoCanvas.tsx`: the markup gate drops
  the cursor-center requirement (`{showLens && <div ...`), so the pane
  shows immediately on toggle; before the cursor enters the photo it
  previews the frame center (`cursor ?? center`). The pane got
  `role="img"` with an "8x magnification" label (it is a stable panel
  now, not a cursor-following decoration).
- `packages/ui/src/components/Topbar.tsx`: the View-menu item keeps its
  place after Zoom to Fit and gains the `Z` shortcut.
- `apps/web/src/App.tsx`: plain `Z` added to the keyboard-action map
  (`z: 'zoom-lens'`); only Ctrl/Cmd+Z was taken (undo), so plain Z was
  free. Toggle behavior and the editor-view gate are unchanged.
- `packages/ui/src/components/EditorDialogs.tsx`: `Zoom in view / Z`
  added to the Preview section of the shortcuts dialog.
- `apps/web/src/index.css`: `.zoom-lens` is now a fixed square —
  `right/bottom: 12px`, no 50% radius, no centering translate.
- `README.md`: the bullet now reads "Use zoom-in view (Z) to preview
  the cursor region at 8x in the corner."

## Decisions

- **Fixed pane, cursor-tracked content.** The task says "a square in
  the bottom right corner", Photoshop-style: the pane never moves, but
  its 8x content follows the cursor (centered before first entry).
  This keeps the existing cursor-tracking and edited-canvas mirror
  with no new plumbing.
- **Z for the shortcut.** Mnemonic for Zoom; every nearby plain letter
  in the Preview domain was taken except Z, and it does not collide
  with Ctrl/Cmd+Z (the command branch returns before the plain-key
  map). Listed in the menu and the shortcuts dialog.
- **Same 180px size, same module names.** Only the factor, shape, and
  placement changed; renaming `zoomLens`/`ZOOM_LENS_*` would churn
  every call site for no behavioral gain.
- **No `dist/` in the commit.** `dist/` is gitignored but is what
  `@f8/*` imports resolve to locally, so core/ui were rebuilt after
  the change for tests/typecheck/build; the rebuilds stay untracked.

## Tests

- `packages/core/src/zoomLens.test.ts` (updated, 8 tests): 8x factor,
  editor-only gating, toggle-off restores normal view, centered and
  corner source rects at the new 45px backing extent, edge clamping,
  tiny-frame source clamp, degenerate-input empty rect. Core suite:
  920 tests pass.
- `packages/ui/src/components/zoomLens.test.tsx` (updated, 12 tests):
  View-menu placement/checked state/`Z` shortcut with no new top-level
  menu, shortcuts-dialog entry, App action/shortcut/props wiring,
  pane absent by default, toggle-only markup gate with no cursor
  center, frame-center fallback, edited-canvas paint call with the 8x
  badge, cursor-tracking gate, and the fixed-square stylesheet rules.
  UI suite: 64 files / 509 tests pass.
- `typecheck` clean for all packages; `web build` succeeds.
  No Playwright, per the task rules.
