# Task: Star smart albums in the sidebar Library group

## Request

If we star some photos, create "smart albums" in the sidebar library
group for the star "counts" we have saved.

## Change

- `packages/core/src/collections.ts`: star-rating smart albums as
  computed collections. New `ratingCollectionId` (`rating-<n>`),
  `ratingForCollection` (strict: only integers 1..5 parse, everything
  else falls through to album matching), `ratingCollectionLabel`
  ("5 Stars", singular "1 Star"), and `savedRatings` (distinct
  ratings present, highest first; 0 and out-of-range values never
  earn an album). `photoInCollection` matches smart albums by exact
  rating, and `isBuiltInCollection` now covers them, so they are
  never deletable — like Favorites and Recently Edited.
- `packages/ui/src/components/Sidebar.tsx`: the Library section
  appends one row per saved rating (star icon, per-rating count)
  after the three static entries. Starring the first photo adds its
  row; unstarring the last one removes it — no row ever shows zero.
- `apps/web/src/App.tsx`: the grid filter delegates to
  `photoInCollection` (identical for the old ids, rating-aware for
  the new ones) instead of its inline duplicate; grid/backlink
  titles resolve through a shared `titleForCollection` helper that
  names smart albums from their rating; the unknown-collection
  guard uses `isBuiltInCollection` so `/album/rating-5` deep-links
  survive; the four chip handlers share a `dropEntryPreset` helper
  so touching a chip inside a smart album drops back to All Photos
  with that filter, like Favorites/Recently Edited.

## Decisions

- **"Star counts we have saved" = distinct ratings present.** If
  photos carry 3-star and 5-star ratings, the Library shows "3
  Stars" and "5 Stars" — nothing for ratings no photo has.
- **Smart albums, not user albums.** They live in the Library
  group (computed, like Favorites), not the Albums group: no
  create/delete menu, no cover, no photo drops, no server storage.
- **Exact rating, not "at least".** `rating-3` lists 3-star photos
  only — one photo, one smart album — matching how the counts read
  in the sidebar.
- **Highest rating first.** The rows order 5→1, mirroring the
  "best first" reading of the grid.
- **No `dist/` in the commit.** `dist/` is gitignored but is what
  `@f8/*` imports resolve to locally, so core was rebuilt after
  the change for tests/typecheck; the rebuild stays untracked.
- **No README update.** A computed sidebar filter introduces no
  architecture change or complex feature.

## Tests

- `packages/core/src/collections.test.ts` (extended, +9 tests):
  id building, strict parsing (1..5 only), singular/plural
  labels, distinct-desc ratings, unrated/out-of-range ignored,
  exact-rating matching, built-in/never-deletable status,
  invalid-id fallthrough to album matching, and grid-URL
  round-trip. Core suite: 54 files / 942 tests pass.
- `packages/ui/src/components/starSmartAlbums.test.tsx` (new, 5
  tests): one Library row per saved rating highest-first,
  nothing extra when unstarred, per-rating counts, selected-row
  highlight, singular "1 Star". UI suite: 65 files / 519 tests
  pass.
- `typecheck` clean for core, ui, and web. No Playwright, per
  the task rules.
