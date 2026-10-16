# Task: Faster arrowing through photos in an album

## Request

Can we make quickly arrowing through photos in an album quicker? There is a bit
of a lag. With and without cache.

## Investigation

Every arrow step runs the full `PhotoCanvas` pipeline for the new photo:

- Cold cache: `loadImage(photo.src)` fetches over the network only after the
  photo becomes current — each step waits on its own fetch.
- Warm cache: the decode is cached, but the pipeline still pays a full
  geometry pass plus `renderAdjustedCanvas` per step, and it also painted the
  Compare "Original" layer every time even though that layer is clipped to
  zero width unless Compare/Show Original is on.
- Revisit: the IndexedDB preview-render cache only loaded for photos with
  repair strokes, and its 2 s idle save never fired for quickly-visited
  photos — so arrowing back always visibly re-rendered.

Server HTTP caching was already correct (content-addressed previews serve
`immutable`), and the per-photo ML hooks only reset state on photo change
(no network waterfall), so the fix is client-side.

## Change

- `packages/core/src/photoPreload.ts` (new)
  - `preloadNeighborSrcs(photos, index, radius = PHOTO_PRELOAD_RADIUS)`: srcs
    around the selection, forward-first alternating outward (`n+1, n-1, n+2,
    n-2`), wrapping around the album ends exactly like the arrow-key handler.
    Skips the current photo, empty srcs, and duplicates; `[]` for degenerate
    inputs. `PHOTO_PRELOAD_RADIUS = 2`, `PHOTO_PRELOAD_DELAY_MS = 80`.
  - Exported from `packages/core/src/index.ts`.
- `packages/core/src/image.ts`
  - New `preloadImages(srcs)`: fire-and-forget `loadImage` per src, warming
    the browser HTTP cache and the in-memory decode cache. Never throws —
    a failed preload just loads on demand as before.
- `apps/web/src/App.tsx`
  - New effect on `[filteredPhotos, selectedId]`: after the navigation
    settles (debounced), preload the neighbors. The timer resets on every
    step, so rapid arrowing never steals bandwidth from the photo being
    opened — the current photo always wins the race.
- `packages/ui/src/components/PhotoCanvas.tsx`
  - The cached last render now loads for every photo, not just repaired
    ones (the exact version-key match remains the guard).
  - New `flushPreviewCache()`: the photo-change reset effect stashes the
    previous photo's final canvas pixels into the preview cache while the
    canvas still holds them (stale runs can't overwrite the stashed key —
    all their paints are generation-guarded). The 2 s idle save stays for
    the settled photo.
  - The Compare "Original" layer no longer paints inside the pipeline. The
    pipeline stashes its decoded inputs (`originalSource`) and a demand
    effect paints the layer only while `compare || showOriginal`, skipping
    non-geometry ticks via `originalPaintedKey`. The zoom lens reads that
    canvas only in the same two states, so it is never starved.
- Tests
  - `packages/core/src/photoPreload.test.ts`: ordering, default radius,
    end wrap-around, current-photo exclusion under large radii, dedupe/
    empty-src handling, degenerate inputs (6 cases).
  - `packages/ui/src/components/arrowNavigationPerf.test.tsx`: source-pinned
    wiring (the `focusMode.test.tsx` precedent — the behavior lives in
    effects): App preload effect + cleanup, unconditioned preview load,
    switch flush, on-demand original paint (4 cases).
- No README change: behavior and architecture are unchanged (pure
  performance work, no new UI or concepts).

## Decisions

- Preload radius 2 with an 80 ms settle delay: covers a fast double-tap
  without fetching the album, and the debounce keeps the current photo
  first in line during rapid arrowing.
- Flush-on-switch instead of shortening the 2 s idle save: shortening it
  would write half-settled states during slider drags; the flush captures
  only confirmed on-screen pixels at the one moment they are known final.
- No idle pre-paint of the Compare layer: the first Compare toggle per
  photo now pays one geometry pass (GPU-backed canvas draws, millisecond
  scale) instead of every navigation paying it. Accepted deliberately.
- Out of scope, noted for later: memoizing filmstrip items (every step
  reconciles all album buttons) and an in-memory LRU of final renders for
  edited photos (whose per-pixel JS loop dominates warm cost). Both add
  memory/complexity risk beyond this task's "bit of a lag".

## Verification

- `yarn workspace @f8/core test`: 61 files / 1053 tests pass (incl. 6 new).
- `yarn workspace @f8/ui test`: 78 files / 595 tests pass (incl. 4 new).
- `typecheck` passes for `@f8/core`, `@f8/ui`, `@f8/web` (after rebuilding
  core so web resolves the new exports).
- Playwright not run (per task rules).
