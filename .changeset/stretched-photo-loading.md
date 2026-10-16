---
'@f8/ui': patch
'@f8/web': patch
---

Fixed photos briefly loading stretched across the canvas and then snapping to their correct dimensions. The cached instant preview no longer clears the loading state when it appears — the frame keeps its predicted aspect and the stale canvas stays hidden until the real paint lands — and the preview image covers the frame instead of stretching into it.

## Task writeup (docs/tasks/53-stretched-photo-loading.md)

## Request

Side-effect of trying to improve the performance of image loading — some
photos load stretched across the canvas only to "snap" to their correct
dimensions a second later.

## Investigation

The fast-arrowing change (`bb49961`) started showing the IndexedDB cached
last render for every photo and called `setLoading(false)` the moment the
preview appeared. Tracing what `loading` gates in `PhotoCanvas`:

- Frame sizing: `displayAspect = loading ? frameAspectForPhoto(photo, edit,
  aspect) : aspect`. Clearing loading flips the frame from this photo's
  predicted aspect to `aspect` state — which still holds the *previous*
  photo's measured aspect until the new paint lands.
- Canvas visibility: `.photo-frame.is-loading .edited-canvas { opacity: 0 }`
  hides the stale canvas. Clearing loading reveals it while it still holds
  the previous photo's pixels, CSS-stretched (`width/height: 100%`) into the
  new frame. The cached-preview `<img>` overlays it but decodes its blob URL
  asynchronously, leaving a visible gap.
- Additionally, `.cached-preview` had no `object-fit` (unlike `.thumb-hold`
  with `cover`), so any frame/bitmap aspect mismatch stretched the preview
  itself. The predictor ignores straighten, so straightened photos always
  mismatch slightly.

So on every preview-cache hit: wrong-aspect frame + stretched stale pixels,
then a snap when the full decode painted ~a second later. Photos without a
cached preview never showed it, which is why only "some" photos stretched.

## Change

- `packages/ui/src/components/PhotoCanvas.tsx`
  - The instant-preview branch no longer calls `setLoading(false)`: loading
    stays true (predicted frame, stale canvas hidden) until `finishPaint`.
    The preview still appears instantly and still logs `preview-cache`.
  - The spinner pill now renders as `{loading && !previewUrl && ...}`: it
    hides behind the instant preview instead of loading being cleared, so
    instant pixels stay clean and the pill still shows when there is no
    preview. Initial SSR state (`previewUrl = null`) is unchanged.
- `apps/web/src/index.css`
  - `.cached-preview` gains `object-fit: cover`, matching `.thumb-hold`:
    residual mismatches crop a sliver instead of distorting the photo.
- `packages/ui/src/components/photoPreviewStretch.test.tsx` (new)
  - Preview branch shows the preview + logs `preview-cache` but never clears
    loading; exactly two `setLoading(false)` calls remain (decode-error path
    and `finishPaint`); spinner gates on `!previewUrl`; `.cached-preview`
    covers the frame.

## Decisions

- Kept `loading` as the single gate (frame aspect + canvas visibility +
  spinner source) rather than adding a second "settled" state: the only
  behavior that needed to differ under preview was the spinner pill, so a
  one-condition change there is the minimal correct fix.
- Did not clear the canvas on photo switch: with loading held until paint,
  the stale canvas is never visible, so clearing would be dead work.
- `cover` (not `contain`) for the preview, matching the thumbnail hold: the
  frame is already at the final aspect, so cover shows the same framing with
  no letterboxing.

## Verification

- New `photoPreviewStretch.test.tsx`: 4 passed.
- Related suites (`photoLoadHold`, `photoPreviewSize`, `arrowNavigationPerf`):
  all pass — the fast-arrowing behavior (preview for every photo, flush on
  switch, on-demand Compare layer) is intact.
- Full `@f8/ui` suite: 80 files / 604 tests passed. `tsc --noEmit` clean.
- Playwright not run (per task rules).
