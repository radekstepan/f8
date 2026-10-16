---
'@f8/ui': patch
'@f8/web': patch
---

Fixed photos still briefly loading stretched across the canvas before snapping to their correct dimensions. The old photo's pixels no longer fade out stretched into the new frame while loading (the canvas now hides instantly and the fresh paint still crossfades in), the Compare original layer stays hidden until the new photo is ready, and its backing store is cleared on photo switch so no stale frame can flash through.

## Task writeup (docs/tasks/55-stale-canvas-stretch.md)

## Request

Side-effect of trying to improve the performance of image loading — some
photos load stretched across the canvas only to "snap" to their correct
dimensions a second later. Still reproducible after the recent
`53-stretched-photo-loading` fix.

## Investigation

The previous fix kept `loading` true until the real paint and gave the
cached preview `object-fit: cover`. That closed the preview-branch path, but
two stale-pixel paths remained, both showing the *previous* photo's pixels
CSS-stretched (`width/height: 100%`) into the new frame:

1. **Edited-canvas fade-out.** `.edited-canvas` carries a 350 ms opacity
   crossfade, and `.photo-frame.is-loading .edited-canvas` only set
   `opacity: 0` — without touching the transition. On every photo switch the
   frame snaps instantly to the new photo's predicted aspect (inline style,
   no transition) while the old canvas *fades* out over 350 ms. During that
   fade the previous photo is visibly stretched into the new frame, until
   the fade finishes or the cached-preview `<img>` decodes over it. It is
   only noticeable when consecutive photos differ in aspect — which is why
   only "some" photos stretched — and even preview-cache hits have a gap
   while the blob URL decodes.
2. **Compare "Original" layer.** The original layer's `clipPath` is not
   gated on loading, and nothing hid the layer while loading. With Compare
   (or hold-for-original) on, arrowing to a new photo shows the previous
   photo's original pixels stretched in the new frame for the whole pipeline
   run (~a second), then snaps when the on-demand repaint lands (it runs
   after `paintCount` bumps in `finishPaint`).

## Change

- `apps/web/src/index.css`
  - `.photo-frame.is-loading .edited-canvas` gains `transition: none`: the
    stale canvas hides instantly on switch instead of fading out stretched.
    The settle fade-in is preserved — removing `is-loading` restores the
    base transition, so the 0→1 change still animates.
  - New `.photo-frame.is-loading .original-layer { opacity: 0 }`: the
    Compare layer hides instantly while loading (it has no transition, so
    this is already instant). When loading clears and Compare is on, the
    freshly repainted original appears.
- `packages/ui/src/components/PhotoCanvas.tsx`
  - The photo-switch reset effect now wipes the original canvas backing
    store (`width = 0; height = 0`). The layer repaints in a passive effect
    *after* the loading-clears commit, so without the wipe one frame could
    flash stale stretched pixels between commit and repaint. A zero-size
    backing store renders nothing until the repaint.
- `packages/ui/src/components/photoStaleCanvasStretch.test.tsx` (new)
  - `is-loading` hides the edited canvas with `transition: none`; the base
    `.edited-canvas` crossfade is intact (fade-in preserved); `is-loading`
    hides the original layer; the reset effect wipes the original backing
    store.

## Decisions

- Fixed with hiding, not repaint timing: the stale pixels are never the
  right content during loading, so instant-hiding both layers is simpler
  and more robust than trying to paint the new pixels earlier.
- Did not wipe the *edited* canvas backing store: it is always repainted
  synchronously in `renderBase` before `loading` clears in the same batch,
  and the decode-error path shows a fully opaque error overlay — so the
  instant-hide CSS fully covers it. The original canvas needed the wipe
  because it repaints in a *later* passive effect, leaving a one-frame gap.
- Did not gate the original layer's `clipPath` on loading in JSX: the
  one-line CSS rule covers both Compare and hold-for-original without
  touching render logic.

## Verification

- New `photoStaleCanvasStretch.test.tsx`: 4 passed.
- Related suites (`photoPreviewStretch`, `photoLoadHold`, `photoPreviewSize`,
  `arrowNavigationPerf`, `compareOriginal`): all pass — fast-arrowing,
  preview-cache, and Compare behavior intact.
- Full `@f8/ui` suite: 81 files / 609 tests passed. `tsc --noEmit` clean.
- Playwright not run (per task rules).
