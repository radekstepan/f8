# Task 6: Album preview opens at the final image size (no resizing)

Task: When we are loading a photo coming from an album it's nice to
see a preview, but the preview is not sized the same way as the
actual final image, so you see a resizing. I don't want to see
resizing. Make the preview size the same as final.

## What changed

- `packages/core/src/image.ts`
  - Added `frameAspectForPhoto(photo, edit, fallback)`: predicts the
    width/height aspect the editor canvas will paint, from the stored
    upright dimensions plus rotation/crop — the same recipe
    `geometryCanvas` applies to the decoded pixels (quarter-turn
    swaps dimensions, the crop ratio fits inside, straighten/flips
    keep the output size; the uniform `maxSize` downscale preserves
    aspect). Returns the fallback for unusable metadata (0,
    negative, non-finite dims).
- `packages/ui/src/components/PhotoCanvas.tsx`
  - The frame now renders at `displayAspect` instead of the raw
    `aspect` state: while `loading` is true the aspect is predicted
    via `frameAspectForPhoto(photo, edit, aspect)`; after first
    paint the decoded pixels stay ground truth. Frame width, frame
    height, and minimap footprint all use it.
  - Root cause: the frame sized itself from `useState(1200 / 627)`,
    which was never reset on photo change — so opening a portrait
    photo (or navigating landscape -> portrait) showed the
    album-thumbnail preview in the wrong box until the full-res
    decode landed and `setAspect` resized the frame. The prediction
    is exact in the normal case (stored dims match the decode), so
    the crossfade now happens with zero layout shift.
  - No CSS change: `.thumb-hold` already fills the frame
    (`width/height: 100%`, `object-fit: cover`), which is exactly
    right once the frame itself is the final size.
- `packages/core/src/image.test.ts`
  - Truth-table tests for `frameAspectForPhoto`: upright aspects,
    quarter/half turns, crop ratios, rotation+crop combined,
    unknown crop keys, unusable dims, custom fallback.
- `packages/ui/src/components/photoPreviewSize.test.tsx` (new)
  - Server-rendered loading-frame dimensions: portrait and
    landscape photos open at their stored ratio, a 90-degree
    rotation swaps the frame, a 1:1 crop opens square, unknown
    dims keep the legacy box, and the hold CSS pins edge-to-edge
    cover fill.

## Decisions

- **Predict from metadata, don't wait for decode.** The photo's
  stored width/height plus the live rotation/crop fully determine
  the pipeline's output size, so the frame can be right on the
  first paint — initializing state from props alone would still
  go stale when edits stream in after open, while the
  `loading ? predicted : measured` form tracks them.
- **Keep the measured aspect as post-paint truth.** If stored
  metadata ever disagrees with the decode, the frame settles to
  the real pixels after one paint instead of trusting metadata
  forever.
- **Fallback is the last measured aspect, not a constant.** With
  corrupt metadata the frame keeps its previous size (old
  behavior) rather than jumping to a hardcoded box.

## LEARNINGS

- Frame-size bugs live in the aspect *state lifecycle*, not the
  CSS: the preview fill was already correct (`cover` + 100%) —
  the box it filled was wrong. Check what sizes the container
  before touching the thing inside it.
- `@f8/ui` tests resolve `@f8/core` through `packages/core/dist`
  (gitignored), so a core `src` change needs a local
  `yarn workspace @f8/core build` before UI tests see it. The
  rebuilt `dist/` stays untracked — do not commit it.
- New UI sizing tests fail cleanly against the old component
  (verified via `git stash`: 4 fail, 2 pass) — server-rendering
  the loading frame is a cheap, jsdom-free way to pin layout.
