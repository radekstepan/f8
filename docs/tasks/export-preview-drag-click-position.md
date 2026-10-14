# Draggable Export Quality preview square + click-position fix

Task: `Export Photo Quality preview I should be able to drag the square and when I click the square shows elsewhere from where I actually clicked.`

## What changed

- `packages/ui/src/components/EditorDialogs.tsx`
  (`ExportQualityPreview`): the focus square is now draggable and clicks
  land where the user clicked.
  - **Click-position fix**: the pointer handlers moved from the
    `<figure>` to the inner `.export-quality-full-wrap` image box, and
    the pointer position is measured against that box's rect. The figure
    rect folded the "Full export" caption into its height, so every
    `y%` read low and the square appeared above the click (a click on
    the image's bottom edge read 91% instead of 100%). The wrap is also
    the focus rect's own positioning context, so click % and square %
    now share one reference. Caption clicks no longer move the focus.
  - **Drag**: `onPointerDown` captures the pointer and moves the focus,
    `onPointerMove` follows while captured, `onPointerUp`/`onPointerCancel`
    release it — the same `setPointerCapture`/`hasPointerCapture` pattern
    the tone-curve slider in `Inspector.tsx` uses. Click still works
    (press = move), so the old `onClick` is gone.
  - New exported pure helper `exportFocusFromClientPoint(clientX,
    clientY, rect)` holds the mapping (round to whole %, clamp 0–100,
    null when the box has no size) so it is unit-testable in the
    node-only test env.
  - The full-view `<img>` gains `draggable={false}` so a loupe drag
    never starts a native image drag; the tooltip and the note now say
    "click or drag".
- `apps/web/src/index.css`: `.export-quality-full-wrap` gains
  `touch-action: none` so touch drags move the loupe instead of
  scrolling. Cursor stays `crosshair` on the figure (inherited by the
  wrap), matching the denoise closeup.
- `packages/ui/src/components/exportQualityPreview.test.tsx` (+7 tests):
  mapping unit tests (corners/center, rounding, edge clamping,
  zero-size null, and a figure-vs-image-box regression pinning the 91%
  → 100% fix); markup pins (tooltip/testid on the wrap, none on the
  figure, `draggable="false"`, updated note text); a source-level pin
  of the pointer-capture wiring (handlers are invisible to static
  markup, per the quality-reset-hint convention); and the
  `touch-action` CSS pin. One existing assertion updated for the new
  "Click or drag" tooltip.

## Important decisions

- **Fixed at the reference, not with an offset hack**: the alternative
  was subtracting a caption height from the figure rect, but that bakes
  in caption metrics that change with font/layout. Measuring the wrap —
  the element the square is positioned against — removes the mismatch
  by construction.
- **Pointer capture over mouse events**: capture keeps the drag alive
  when the pointer briefly leaves the box, and matches the existing
  tone-curve drag in the same codebase.
- **Denoise closeup left alone**: it shares the click-on-figure pattern
  and likely the same y-offset, but this task is the export preview
  only — noted here so a follow-up can apply the same fix.
- **No README update**: interaction bug fix, no architecture or feature
  change.

## Tests (unit/integration only, no Playwright)

- `exportQualityPreview.test.tsx`: 20/20 pass (13 existing + 7 new),
  via `renderToStaticMarkup` + pure-helper units + source/CSS pins.
- Full suite: `@f8/ui` 452/452 pass (57 files). `@f8/ui` typecheck clean.
