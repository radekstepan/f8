# Task 4: Zoom-in-view magnifier toggle

## Request

Under View, be able to toggle a "zoom in view" when in photo view,
so wherever the cursor goes we see a 16x magnification.

## Change

A "Zoom in View" checkbox item under the View menu (after Zoom to
Fit, no shortcut — the View toggles have none). While on, a circular
loupe follows the cursor over the photo in photo (editor) view and
shows the region under it at 16x, with a "16×" badge. Toggling off —
or leaving the photo — restores the normal view.

- `packages/core/src/zoomLens.ts` (new): pure loupe geometry.
  `ZOOM_LENS_MAGNIFICATION = 16`, `ZOOM_LENS_SIZE_PX = 180`,
  `shouldShowZoomLens(view, enabled)` (editor-only gate),
  `zoomLensSourceRect(cursorFraction, canvasSize, frameSize)` (16x
  source rect in backing-store pixels, clamped inside the canvas),
  `clampZoomLensCenter(cursorPx, frameSize)` (keeps the whole loupe
  over the photo near the edges). Exported from
  `packages/core/src/index.ts`.
- `packages/ui/src/components/PhotoCanvas.tsx`: new optional
  `zoomLens` prop. Pointer tracking already existed for the repair
  brush; the `isBrush` cursor gate became `isBrush || showLens`
  (stroke hover-highlight stays brush-only). The loupe is a
  `div.zoom-lens` at the clamped cursor center holding a canvas
  painted from the edited canvas via `zoomLensSourceRect` in a
  every-render effect — the same mirror pattern as the minimap, so
  the loupe stays in sync with repaints and shows adjustments,
  crop, and rotation exactly as framed. Backing store is 2x the CSS
  size for retina crispness.
- `packages/ui/src/components/Topbar.tsx`: `'zoom-lens'` added to
  `MenuAction`, optional `zoomLens` prop on `MenuBar` (optional
  like the other later-added props, so existing renders keep
  working), checked item in the View menu.
- `apps/web/src/App.tsx`: `zoomLens` state, `'zoom-lens'` case in
  `handleAction`, `zoomLens={zoomLens}` to `MenuBar`,
  `zoomLens={shouldShowZoomLens(view, zoomLens)}` to PhotoCanvas.
- `apps/web/src/index.css`: `.zoom-lens` (180px circle,
  pointer-transparent, centered on the cursor), `.zoom-lens canvas`
  (fills the loupe), `.zoom-lens-label` (factor badge).
- `README.md`: one bullet under Included Interactions.

## Decisions

- **Loupe over preview pane.** A cursor-following loupe matches the
  request ("wherever the cursor goes") and reuses the existing
  cursor-tracking and canvas-mirror patterns (brush cursor,
  minimap) instead of adding a new panel.
- **Paint from the edited canvas, not the source file.** The loupe
  magnifies what the user sees — adjustments, crop, rotation
  included — at zero extra render cost (one `drawImage` per frame).
- **Magnification relative to the displayed photo**, like the zoom
  percentages in the canvas status bar (the README already notes
  those are relative to the fitted preview, not source pixels).
- **Persistent mode, not per-photo state.** Like Compare, the
  toggle survives photo switches; `selectPhoto` does not reset it.
  The editor-view gate means it simply has no effect in the grid.
- **No keyboard shortcut.** The Show-toggles in the View menu have
  none; the task allows judgment and minimal scope won.
- **No `dist/` in the commit.** `dist/` is gitignored but is what
  `@f8/*` imports resolve to locally, so core/ui were rebuilt
  after the change for tests/typecheck/build; the rebuilds stay
  untracked.

## Tests

- `packages/core/src/zoomLens.test.ts` (new, 11 tests): 16x factor,
  editor-only gating, toggle-off restores normal view, centered and
  corner source rects, edge clamping, tiny-frame source clamp,
  degenerate-input empty rect, lens-center clamp incl. sub-loupe
  frames. Core suite: 53 files / 911 tests pass.
- `packages/ui/src/components/zoomLens.test.tsx` (new, 9 tests):
  View-menu item placement/checked state with no new top-level
  menu or shortcut, App action/state/props wiring, loupe absent by
  default and before cursor entry (the paint runs in an effect,
  unreachable from server rendering — same seam as the minimap
  tests), cursor-tracking gate, edited-canvas paint call, and the
  stylesheet rules. UI suite: 63 files / 498 tests pass.
- `typecheck` clean for core, ui, and web; `web build` succeeds.
  No Playwright, per the task rules.
