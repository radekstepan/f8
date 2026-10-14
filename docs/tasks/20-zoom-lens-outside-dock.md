# Task: Zoom in View docks beside the photo when there is room

## Request

Show the zoom in view square to the right of the image canvas (if
there is space). Right now it shows in the right bottom corner of the
image even though (on a portrait photo) there is space to the right
of it.

## Change

- `packages/core/src/zoomLens.ts`: new pure helper
  `shouldDockZoomLensOutside(stage, frame, lensSize?, gap?)` plus a
  `ZOOM_LENS_OUTSIDE_GAP_PX` (12px) constant. It models the centered
  frame inside the stage inner box (which grows past the stage when
  the frame overflows at high zoom, using the same 64px/48px stage
  padding as `.canvas-stage-inner` and the PhotoCanvas fit math) and
  returns true only when the pane fits between the frame's right edge
  and the inner box's right edge with a gap on each side, and the
  bottom-aligned pane does not poke above the stage. Degenerate
  inputs yield false. Module doc updated from "sits in the photo's
  bottom-right corner" to the dock-or-overlay behavior.
- `packages/ui/src/components/PhotoCanvas.tsx`: computes
  `lensDockedOutside` from the render-derived `stageSize` +
  `frameWidth`/`frameHeight` and appends an `is-outside` class to the
  `zoom-lens` pane when true. Paint logic untouched — the same canvas
  paints from the same refs either way. Prop and `showLens` comments
  updated.
- `apps/web/src/index.css`: `.zoom-lens.is-outside` offsets the pane
  past the frame's right edge (`left: calc(100% + 12px)`, `right:
  auto`) flush with the frame bottom (`bottom: 0`). The pane stays
  absolutely positioned inside the frame element, so it still scrolls
  with the photo and needs no layout changes.
- `README.md`: the zoom-in-view bullet now says the preview docks
  beside the photo when there is room, else in the corner.
- Tests: 7 new core cases in `zoomLens.test.ts` (portrait docks,
  landscape/zoomed/short-stage keep the corner, exact-boundary
  dock, custom size/gap, degenerate inputs); `zoomLens.test.tsx`
  gains a docking wiring test (helper call from render-derived
  sizes) and an `is-outside` stylesheet test, and the markup-gate
  test now expects the conditional class.

## Decisions

- **Geometry in core, one class in the component.** The repo keeps
  lens math unit-testable in `packages/core/src/zoomLens.ts` and
  pins wiring with source assertions in ui — this follows that
  split instead of measuring the DOM.
- **Synchronous from render state, not the viewport effect.** The
  `viewport` state (DOM-measured, effect-updated) lags zoom changes
  by a frame; deriving docking from `stageSize` + frame dims in the
  same render means zooming in/out can never flash the wrong
  placement. The helper's inner-box model already returns false
  whenever the frame overflows, so no viewport gate is needed.
- **Pane stays inside the frame element.** Moving it to the
  stage wrap would complicate scroll/bottom-alignment; an
  absolutely positioned child past the frame's edge scrolls with
  the photo for free and (given the fit check) never creates new
  scrollbars.
- **Flush bottom alignment.** `bottom: 0` lines the pane's bottom
  edge up with the photo's bottom edge, which reads as deliberate
  alignment rather than a floating offset.
- **Known corner:** a tall frame zoomed so only its height
  overflows, in a very wide stage, docks the pane while the minimap
  also shows — the two can overlap at some scroll positions (the
  minimap floats above, both stay usable). Gating on the viewport
  state would trade this rare overlap for a placement flicker on
  every zoom-out, so the helper decides alone.
- **No `dist/` in the commit.** `dist/` is gitignored but is what
  `@f8/*` imports resolve to locally, so core and ui were rebuilt
  after the change for typecheck/build; the rebuild stays untracked.

## Tests

- New core tests failed before the helper existed (7 failed / 22
  passed) and pass after; new/updated UI assertions failed before
  the wiring + CSS (3 failed / 18 passed) and pass after.
- Full suites: core 54 files / 952 tests pass, UI 66 files / 526
  tests pass. `typecheck` clean for core and ui; `web build`
  succeeds. No Playwright, per the task rules.
