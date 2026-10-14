# No more "All Photos" flash + animated histogram loading

Task: `"All Photos" flashes on hard reload of photo view before the correct
category shows in a backlink. Show nothing rather than wrong category. And
nicely animate the histogram when loading too.`

## What changed

**Backlink (show nothing rather than wrong category)**

- `packages/core/src/photoBacklink.ts`: new pure helper
  `resolveBacklinkCollection(view, photo, collection, collectionSettled)` that
  returns the collection id the backlink should name, or `null` while it is
  not yet known (editor view with no photo, or before the initial
  photo-driven inference has run). Once settled, a photo outside the current
  collection already names its target album — exactly what the inference
  effect is about to set — so a filmstrip switch across albums never flashes
  the stale name for a frame either. The library grid always names the
  collection (its title is never pending).
- `apps/web/src/App.tsx`: new `collectionSettled` state (starts `true` for
  grid loads where the URL names the collection, `false` for photo loads
  where `'all'` is just a placeholder), set in the existing collection
  inference effect. The toolbar now receives `backlinkName` (null while
  unknown) instead of the raw `collectionName`. Grid title, filmstrip label,
  and sidebar are untouched.
- `packages/ui/src/components/Topbar.tsx`: `ToolbarProps.collectionName` is
  now `string | null`. A null/empty name with `showBacklink` renders an empty
  `backlink-pending` shimmer pill (`aria-hidden`), never a button with a
  wrong name. The real backlink and the grid static title are unchanged.
- `apps/web/src/index.css`: `.backlink-pending` shimmer pill +
  `@keyframes backlink-shimmer`.

**Histogram loading animation**

- `packages/ui/src/components/Inspector.tsx`: a null histogram now renders a
  `HistogramSkeleton` (28 bars in a deterministic bell of heights with
  staggered delays, `role="status"`, "Loading histogram") instead of flat
  zero-lines that popped into shape. The section carries `is-loading` while
  pending; heading, axis, and camera settings stay visible. Real data renders
  the same SVG as before, now with class `histogram-curves` for the entrance.
- `apps/web/src/index.css`: `.histogram-skeleton` wave bars
  (`@keyframes histogram-wave`: opacity + scaleY pulse) and the
  `@keyframes histogram-bloom` entrance (fade + grow from the baseline).
  The skeleton occupies the curves' exact 68px slot, so the swap causes no
  layout jump. Both animations plus the backlink shimmer are disabled under
  `prefers-reduced-motion`, extending the existing block.

## Important decisions

- **Placeholder, not hidden**: "show nothing" is an empty shimmer pill rather
  than removing the breadcrumb, so the toolbar doesn't collapse and the state
  reads as loading rather than broken. It names no category, satisfying the
  "rather than wrong category" requirement.
- **Render-time target naming**: the helper names the photo's album while a
  cross-album switch is in flight (matching the inference effect's outcome),
  eliminating the one-frame stale flash without waiting for the effect.
- **No histogram reset on photo switch**: the loading animation covers the
  null → data transition (initial load). Resetting App histogram state on
  every photo change would risk stranding it null (effects ordering between
  PhotoCanvas and App) and flicker on every filmstrip click; stale-then-update
  on switches is unchanged behavior, out of scope.
- **No README update**: bug fix + loading polish, no architecture change.

## Tests (unit/integration only, no Playwright)

- `packages/core/src/photoBacklink.test.ts`: +5 cases for
  `resolveBacklinkCollection` (pending before settle, null photo, settled
  naming incl. favorites, mid-switch album naming, grid passthrough).
- `packages/ui/src/components/backlinkPending.test.tsx` (new, 6 tests):
  pending markup (no button/name, aria-hidden), empty-name treated as
  pending, real backlink + grid title unchanged, App wiring pinned from
  source, shimmer styling + reduced motion pinned from CSS.
- `packages/ui/src/components/histogramLoading.test.tsx` (new, 4 tests):
  skeleton wave markup (28 staggered bars, status role, no SVG), heading/
  axis/camera preserved while loading, curves swap on data, wave/bloom
  keyframes + slot height + reduced motion pinned from CSS.
- Results: `@f8/core` 884/884 pass (52 files), `@f8/ui` 440/440 pass
  (56 files). Typecheck clean for `@f8/core`, `@f8/ui`, `@f8/web`
  (after rebuilding lib `dist`, which web resolves).
