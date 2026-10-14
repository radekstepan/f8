# Task: Zoom-in-view submenu under Show, compare-aware, repair circle

## Request

The zoom in View should show under "Show", not at the bottom of the
dropdown. And it should respect if we have the compare with original on.
If we have Repair on, we should see the circle in the zoom in view IF
it's the same size or smaller than the preview. The zoom in view in the
dropdown should also be a submenu where the 8x is the default but we
also have 4x and 16x. Only the 8x, the default, has the keyboard
shortcut.

## Change

- `packages/core/src/zoomLens.ts`: new `ZOOM_LENS_MAGNIFICATIONS`
  (`[4, 8, 16]`) with a `ZoomLensMagnification` type
  (`ZOOM_LENS_MAGNIFICATION = 8` stays as the default), plus three pure
  helpers: `zoomLensDestPoint` (where a frame-fraction point lands in
  the pane, off-center where the source clamps at the edges),
  `zoomLensOriginalOverlay` (the original-side slice to overpaint while
  Compare splits the frame — null off the divider's left, full-pane
  left of it), and `zoomLensBrushRadius` (magnified brush radius in
  backing pixels, null when the brush exceeds the pane).
- `packages/ui/src/components/Topbar.tsx`: `MenuAction` replaces
  `'zoom-lens'` with `'zoom-lens-4' | 'zoom-lens-8' | 'zoom-lens-16'`.
  The View menu moves Zoom in View up with the Show toggles (above the
  separator; Photo Browser / Zoom to Fit stay at the bottom) as a
  checked parent with a 4x/8x/16x flyout — hover opens, click toggles
  for touch, ArrowRight/ArrowLeft move in and out, and only the 8x
  option carries the `Z` shortcut. `MenuBar` gains
  `zoomLensMagnification` for the per-option check.
- `apps/web/src/App.tsx`: new `zoomLensMag` state (default 8) next to
  `zoomLens`. Each submenu action enables the preview at its factor;
  re-picking the active factor turns it off. `Z` now fires
  `'zoom-lens-8'`. Both MenuBar and PhotoCanvas receive the
  magnification.
- `packages/ui/src/components/PhotoCanvas.tsx`: new optional
  `zoomLensMagnification` prop (default 8) driving the source rect,
  the pane badge, and the accessible label. The pane paint composites
  the original canvas over the divider's left part while Compare is on
  (full original while Show Original is held; edited-only fallback on
  a size mismatch from a paint in flight). With Repair on, the brush
  circle strokes over the pane at the cursor's pane position when the
  magnified brush fits — same visibility conditions as the frame
  cursor otherwise.
- `apps/web/src/index.css`: flyout styles (`.menu-submenu-anchor`,
  `.dropdown-menu.dropdown-submenu` right of the parent with full
  rounding, chevron).
- `README.md` / `docs/features.md`: bullets updated (features.md still
  described the old 16x loupe).

## Decisions

- **Placement, not renaming.** "Show under Show" was read as position
  (with the Show toggles, above the separator), keeping the "Zoom in
  View" label, the shortcuts-dialog entry, and the Z shortcut stable.
- **Options toggle; Z is just the 8x option.** Clicking (or pressing Z
  for) the active factor turns the preview off; any other option
  switches factor and stays on. So Z with 4x active moves to 8x rather
  than turning off — one rule, no special cases.
- **Circle mirrors the frame cursor's conditions.** It hides while
  Compare / Show Original is on (the frame cursor does too — nothing
  paints then) and on an unwarmed ML tier, but draws at the pane's
  center fallback before the cursor enters, like the pane content.
- **Fit means magnified diameter vs pane size.** A brush whose
  diameter times the factor exceeds 180px stays out; exactly 180px
  still draws ("same size or smaller").
- **No `dist/` in the commit.** `dist/` is gitignored but is what
  `@f8/*` imports resolve to locally, so core/ui were rebuilt after
  the change for tests/typecheck/build; the rebuilds stay untracked.

## Tests

- `packages/core/src/zoomLens.test.ts` (extended, 21 tests): submenu
  factors with 8x default, magnification-scaled source extents, pane
  mapping centered/edge-clamped/degenerate, original overlay
  edited-side/full-pane/straddling/degenerate, brush radius
  fits/exact-fit/4x/degenerate. Core suite: 54 files / 933 tests pass.
- `packages/ui/src/components/zoomLens.test.tsx` (rewritten, 18
  tests): submenu placement under Show with checked parent and no flat
  item, flyout options with per-option checks, Z only on 8x, no new
  top-level menu, shortcuts-dialog entry, App factor
  enable/re-pick-off wiring, Z on 8x, MenuBar/canvas magnification
  props, pane absent by default, toggle-only gate, center fallback,
  magnification-driven paint with matching badge, compare/show-original
  compositing, repair-circle paint with its gate, cursor tracking, and
  the pane plus flyout stylesheet rules. UI suite: 64 files / 514
  tests pass.
- `typecheck` clean for all packages; `web build` succeeds.
  No Playwright, per the task rules.
