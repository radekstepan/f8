# Task 05 — Cull assist reports no positive state (no more "Keeper · ML")

## Problem

Every sharp photo got a green "Keeper · ML" badge, a "Keepers" filter
chip, and a keepers count in the cull toast. The user only wants to know
about problems (blurry photos), never a pat on the back.

## Change

- `packages/core/src/vision/cull-assist.ts`: `assignCullLabels` no longer
  emits a keeper label. Removed `CULL_LABEL_KEEPER` (so `CULL_LABELS` is
  now blurry + duplicate only) and `CULL_KEEPER_THRESHOLD`. The logistic
  aesthetic scorer stays, reframed as an internal quality rank: it still
  picks each near-duplicate group's best (spared the duplicate flag), it
  just never becomes a label.
- `packages/core/src/library.ts` + `apps/server/src/cull-assist.ts`:
  `CullAlbumReport` lost the `keepers` array; `CullGroup.keeper` renamed
  to `best` (matches the existing `pickGroupBest` vocabulary).
- `apps/server/src/db.ts`: schema v4 migration deletes retired
  `keeper` rows with source `ml`. Hand-added `keeper` labels
  (source `user`) are the user's own words and stay untouched.
- UI: `PhotoStrips.tsx` dropped the Keepers filter chip and the Keeper
  badge (a stale keeper label now renders bare); `App.tsx` dropped the
  keepers filter branch and the toast count; `Sidebar.tsx` + grid menu
  tooltips say "Blurry photos and near-duplicates"; `index.css` lost
  `.thumb-cull.is-keeper`. The info-dialog label datalist follows
  `CULL_LABELS` automatically, so `keeper` is no longer suggested.
- `README.md`: cull-assist feature + boundary paragraphs updated (no
  keeper scorer, blurry-only filter).

## Decisions

- Duplicate flags stay: they are a negative (problem) state, not a
  positive one, and the task's clarifier is "do not report on positive
  state".
- The aesthetic column and scorer stay in the cache: group-best picking
  needs a quality rank, and dropping the column would force a
  re-assessment of every file for no user-visible gain. No
  `CULL_ASSIST_VERSION` bump for the same reason (cached metrics are
  unchanged; only label planning changed).
- Stale ML keeper flags are deleted by migration rather than hidden at
  read time, so the info dialog and label search stop reporting them too.

## Verification

- Core cull-assist + client tests: 29/29 pass (incl. new "never emits a
  keeper label" batch test). Full `@f8/core`: 723 pass.
- Server cull-assist + semantic-search: 30/30 pass (incl. new v4
  migration test: ML keeper dropped, user keeper kept). Full
  `@f8/server`: 167 pass.
- UI cull-assist: 7/7 pass (incl. new stale-keeper-renders-bare test).
  Full `@f8/ui`: 89 pass.
- `yarn typecheck`: 6/6 successful.
