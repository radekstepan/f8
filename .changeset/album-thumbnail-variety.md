---
'@f8/core': patch
'@f8/web': patch
---

Generate thumbnail no longer returns the same photo every time: it now picks randomly from the most interesting tier (favorites first, else the highest rating) and skips the album's current cover while an alternative exists, so repeated clicks walk through the best candidates instead of repeating one.

## Task writeup (docs/tasks/49-album-thumbnail-random.md)

## Request

The generate thumbnail action keeps picking the same photo. Not sure how
we decide which photo to pick but randomize it. If we pick the most
"interesting", we still should have an order and pick from these.

## Change

- `packages/core/src/albumCover.ts`
  - New exported `rankAlbumCoverCandidates(photos)`: the "most
    interesting" order made explicit — usable photos (missing originals
    and imageless records skipped) sorted favorites first, then rating
    descending, then filename ascending.
  - `pickAlbumCover(photos, options?)` now randomizes within the top
    tier instead of always returning rank #1: after ranking, it takes
    the tier sharing the head's favorite flag and rating, and picks
    uniformly at random from it (`random: () => number` option,
    defaulting to `Math.random`, keeps tests deterministic; the pick
    index is clamped so an out-of-range source still lands in the
    tier). Lower tiers are never picked while the top tier is
    non-empty.
  - New `exclude` option (a cover URL): when other usable photos
    exist, candidates resolving to that URL are dropped before the
    tier is computed, so a repeated Generate moves to a different
    photo — falling through to the next tier when the current cover
    is the whole top tier. Ignored when falsy and when every usable
    photo resolves to the same URL (single-photo albums still
    return their only photo).
- `apps/web/src/App.tsx`
  - `generateAlbumThumbnail` passes the album's current cover as
    `exclude`, so each click lands on a different candidate while one
    exists. Comment above the callback updated to the new behavior.
- Tests: `albumCover.test.ts` grows from 8 to 15 cases — random
  indexing across a tier in filename order, top-tier confinement at
  both random extremes, exclude-moves-on, fall-through to the next
  tier, single-photo and shared-URL fallbacks, out-of-range random
  clamping, plus a `rankAlbumCoverCandidates` ordering case. The old
  "ties break by filename deterministically" case is superseded by
  the random-within-tier cases (filename now orders the tier so an
  injected random maps stably; `random: () => 0` without exclude
  reproduces the legacy winner).
- No UI or server change: the sidebar/grid menus, PATCH endpoint, and
  cover rendering are untouched. No README change: behavior tweak,
  no architecture change.

## Decisions

- **Random within the top tier, not across the whole album.** Pure
  random would surface unrated non-favorites over favorited photos;
  tiering keeps the "most interesting" promise while guaranteeing
  variety. The task's "still should have an order" is the exported
  ranking the tier is drawn from.
- **Exclude the current cover rather than cycling by index.** Cycling
  needs stored position state; exclusion is stateless — the caller
  already knows the cover — and degrades gracefully (single photo,
  shared URLs). Repeated clicks therefore walk the best candidates
  in random order instead of repeating rank #1.
- **`random: () => 0` reproduces the legacy pick.** Because the tier
  keeps filename order, the old deterministic winner is still
  reachable, which keeps the change reviewable as "same ranking,
  randomized selection".

## Tests

- `yarn workspace @f8/core test src/albumCover.test.ts` — 15/15 pass.
- `yarn workspace @f8/core test` — 1047 tests pass (1040 before + 7 new).
- `yarn workspace @f8/core typecheck` passes; `yarn workspace @f8/core
  build` then `yarn workspace @f8/web typecheck` pass.
- No Playwright, per the task rules.
