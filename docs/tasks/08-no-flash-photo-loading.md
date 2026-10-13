# Task 8: No-flash photo loading

Opening a photo from an album mounted `PhotoCanvas` with `loading=true`,
and the `.photo-loading` overlay covered the whole frame with a solid
`#1a1a1d` background plus spinner while the full-res image decoded — a
dark empty box flashing between the album grid and the photo. On
photo-to-photo switches (filmstrip, arrows) the same overlay hid the old
photo, and the old pixels lingered at 15% opacity underneath it.

## What changed

1. **Thumbnail hold** (`packages/ui/src/components/PhotoCanvas.tsx`).
   The frame now renders the album thumbnail (`photo.thumbnail` — the exact
   URL the grid just showed, so it is browser-cached and paints on the
   first frame) beneath the canvas. While `loading` it sits at full
   opacity; once the pipeline paints, it gains `is-settled` and fades out
   over 350ms while the canvas fades in over the same duration — a true
   crossfade from preview to full image. The hold is decorative (`alt=""`,
   `aria-hidden`, `draggable={false}`); the canvas keeps the accessible
   label.
2. **Loading indicator becomes a pill** (`apps/web/src/index.css`).
   `.photo-loading` no longer covers the frame: it is a small floating
   pill (translucent dark, blurred backdrop) centered over the thumbnail,
   keeping the same spinner + "Developing your photo..." copy. `.photo-error`
   keeps its solid full-cover treatment — on error there is no image to show.
3. **No stale ghost** (`apps/web/src/index.css`).
   `.photo-frame.is-loading .edited-canvas` drops from `opacity: .15` to
   `0`. `loading` is only true until the new photo's first paint, so any
   canvas pixels under it belong to the previous photo; hiding them shows
   the new thumbnail cleanly instead of blending old over new.
4. **Reduced motion** (`apps/web/src/index.css`). A
   `prefers-reduced-motion: reduce` block disables the frame mount animation
   and both sides of the crossfade, so the swap is instant.
5. **Tests:** added `photoLoadHold.test.tsx` (7 tests: hold renders with the
   thumbnail src beneath the canvas; hold is decorative while the canvas
   keeps its label; initial markup starts in the loading state with the
   spinner copy; hold/canvas share the 350ms crossfade with a settled
   state; stale pixels hide at opacity 0; the loading pill floats while
   the error state still covers; reduced-motion disables the transition).

## Decisions

- **Raw thumbnail, no edit filter or geometry.** The grid shows the
  unadjusted thumbnail; holding that exact image preserves continuity with
  what the user just saw. Applying the CSS edit approximation or
  crop/rotation would diverge from the album preview for a ~200ms
  placeholder.
- **`object-fit: cover` + slight blur.** The hold bleeds full-frame like
  the final paint (they match exactly for uncropped photos); `blur(6px)`
  hides the low-res stretch as an intentional blur-up. No `scale()` —
  that would need `overflow: hidden` on the frame, which risks clipping
  the comparison grab area and brush cursor.
- **Keep the hold mounted after load.** Unmounting it the moment `loading`
  flips would cut the crossfade short (canvas still fading up over a dark
  frame); fading it under the opaque canvas costs one cheap layer.
- **No `onError` hide on the hold.** If thumbnails fail, the full image
  fails too and the solid error overlay covers the frame; the transient
  broken-icon fallback equals the old empty state.
- **No README change.** The README documents no loading visuals; this is a
  loading-UX fix with no architecture or behavior change.

## Verification

- `yarn workspace @f8/ui test`: 41 files, 324 tests, all pass (317
  pre-existing + 7 new).
- `yarn workspace @f8/ui typecheck`: clean.
- `yarn workspace @f8/web typecheck`: clean.
- Playwright not run (per brief).
