# Task 02 — Dragging a zoomed photo pans it

## What was wrong

`PhotoCanvas` captured the wheel for cursor-anchored zoom and only painted
repair strokes on drag. With any other tool, dragging a zoomed-in photo did
nothing — panning was possible only via scrollbars or the minimap.

## What I did

Dragging the photo now pans the viewport 1:1 whenever the frame overflows
the stage (i.e. zoomed in), on every tool:

- **Primary drag** pans in Adjust/Crop, and in Repair whenever the brush
  would not paint (comparing, showing original, ML tier not ready).
- **Space + drag** is a grab-tool override: it pans even inside the repair
  brush (Space was previously unbound; it is ignored inside form fields and
  never hijacks focused buttons outside the canvas).
- **Middle-drag** pans on any tool; the press is swallowed so the browser
  autoscroll overlay never appears.
- **Touch** is unchanged: it keeps painting in the brush and scrolls the
  stage natively otherwise (no pointer capture, so no fight with scrolling).
- **Fit zoom** is unchanged: with nowhere to scroll, a drag is a no-op.
- Grab/grabbing cursors (`is-pannable` / `is-panning`) show when a drag
  would pan; compare-divider, wheel-zoom, minimap, and all painting paths
  are untouched (the paint-gating condition moved verbatim into `canPaint`).

## Changes

- `packages/core/src/canvasPan.ts` (new): pure `resolveCanvasDrag(intent)`
  routing (`paint` | `pan` | `none`) and `panScrollFromDrag(start, current)`
  1:1 scroll math. No DOM, unit-testable.
- `packages/core/src/index.ts`: export the new module.
- `packages/ui/src/components/PhotoCanvas.tsx`: Space tracking effect,
  `pointerDown` routes via `resolveCanvasDrag` (press-time scrollability
  check backs up the `viewport` state), `onPointerMove` shifts stage scroll
  during a pan, `endStroke` tears the gesture down, middle-click guard.
- `apps/web/src/index.css`: `.is-pannable` grab / `.is-panning` grabbing
  (+ `user-select: none` while pannable).
- `packages/core/src/canvasPan.test.ts` (new): 12 Vitest tests.
- `apps/web/tests/e2e/canvas-zoom.spec.ts`: new "dragging a zoomed photo
  pans the viewport" test (fit-zoom no-op, grab class, diagonal drag moves
  scroll, drag-back returns).

## Verification

- `yarn workspace @photomator/core build` — pass.
- `yarn workspace @photomator/core test` — **438/438 pass** (21 files,
  incl. 12 new `canvasPan` tests).
- `yarn workspace @photomator/ui typecheck` — pass, no output.
- `yarn workspace @photomator/web typecheck` — pass, no output.
- `yarn workspace @photomator/web build` — pass (`✓ built in 2.90s`).
- E2E **not run**: this sandbox denies loopback TCP (`connect EPERM
  127.0.0.1`) so the Playwright webServers are unreachable, and the
  default browser cache is read-only (Chromium is staged at
  `/tmp/ms-playwright`). Outside the sandbox run:
  `PLAYWRIGHT_BROWSERS_PATH=/tmp/ms-playwright yarn workspace
  @photomator/web exec playwright test tests/e2e/canvas-zoom.spec.ts`
- Manual check: `yarn dev`, open a photo, zoom to 200% (or `+` twice),
  drag the photo — the view follows; hold Space and drag in Repair to
  pan instead of painting. UI package has no component-test runner, so
  gesture routing is covered via the core module + the e2e spec.

## Unresolved / follow-ups

- E2E pan spec is written but unexecuted here (see above).
- No kinetic/inertial panning — the view tracks the pointer and stops on
  release, matching scrollbar behavior.
- Tree is shared with the Task 01 agent (its `branding.*`, `Topbar`,
  `EditorDialogs`, `index.html` changes are present); my files are those
  listed above. Changes left uncommitted per instructions.
