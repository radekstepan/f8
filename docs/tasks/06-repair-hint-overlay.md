# Task 06 — Repair hint no longer shifts the photo

## Problem
Switching to the repair tool mounts a help message (`ToolHint`) at the bottom
of the canvas; when it fades out 5s later the message unmounts. Both transitions
visibly shifted the photo.

## Root cause
The hint was rendered in normal flow *inside* the `.canvas-stage` scroll
container (after `.canvas-stage-inner`), styled `position: sticky` with a
negative-margin overlap hack. Mounting/unmounting it changed the scroll
container's content height, so the flex-centered photo jumped.

## Fix
- `packages/ui/src/components/PhotoCanvas.tsx`: moved the `<ToolHint>` out of
  `.canvas-stage` into `.canvas-stage-wrap` (the `position: relative` parent,
  same anchor the minimap already uses), so it is a sibling of the scroll
  container rather than scroll content.
- `apps/web/src/index.css`: `.tool-hint` is now a true overlay —
  `position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%)`
  with `pointer-events: none` (it previously only ignored pointer events while
  fading; it must never block brush strokes near the bottom edge). Removed the
  `sticky` positioning and negative-margin hack.

## Decisions
- Overlay on the wrap instead of reserving space: a reserved slot would shrink
  the canvas area permanently for a 5s message; an overlay keeps the photo
  pixel-stable with zero layout cost.
- `pointer-events: none` unconditionally: the hint is `role="status"` text, not
  interactive, and it floats over the paint surface.

## Verification
- New `packages/ui/src/components/toolHintOverlay.test.tsx` (5 tests): pins the
  overlay CSS (absolute, no margin, pointer-events none, bottom-centered) and
  asserts via static markup that the hint renders inside `.canvas-stage-wrap`
  but outside `.canvas-stage`, that the photo frame stays inside
  `.canvas-stage-inner`, and that non-repair tools render no hint.
- `yarn workspace @f8/ui test`: 94/94 pass. `yarn typecheck`: 6/6 ok.
