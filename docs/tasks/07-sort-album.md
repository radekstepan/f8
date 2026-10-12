# Task 07 — Sort album by filename / time imported / datetime captured

## What changed

- `packages/core/src/albumSort.ts` (new)
  - `AlbumSortKey` (`filename` | `imported` | `captured`), `AlbumSortDir`
    (`asc` | `desc`), labels, and defaults (`captured` / `asc`, matching
    the previous date-ascending order).
  - `compareAlbumPhotos` / `sortAlbumPhotos`: pure client-side sort.
    Filenames compare numeric-aware (`DSC9` before `DSC10`); the two
    timestamp keys compare parsed epoch millis with filename-then-id
    tiebreaks, so the order is total and deterministic. Descending is the
    exact reverse of ascending.
- `packages/core/src/types.ts`
  - `Photo` gains optional `importedAt` (ISO string, server `created_at`).
    Optional so demo/legacy records without the stamp keep compiling.
- `packages/core/src/index.ts`
  - Re-exports the new sort module.
- `apps/server/src/app.ts`
  - `toApiPhoto` now serves `importedAt: row.created_at`. No schema or
    route change — the column already existed, it just never left the
    server.
- `apps/web/src/hooks/useToolPrefs.ts`
  - `ToolPrefs` gains `albumSortKey` / `albumSortDir` with the same
    allowlist sanitize pattern as the other prefs.
- `apps/web/src/App.tsx`
  - The `reversed` boolean becomes `sortKey` / `sortDir` state, seeded
    from tool prefs and persisted by the existing prefs effect.
    `filteredPhotos` uses `sortAlbumPhotos`; the grid `scrollKey` now
    includes key+dir so each ordering keeps its own scroll position.
  - The filmstrip toggle now flips the shared sort direction (identical
    behavior for the default captured sort) and receives the active key
    for its label; the grid gets `sortKey` / `sortDir` / `onSortChange`.
- `packages/ui/src/components/PhotoStrips.tsx`
  - `PhotoBrowser` header gains a sort dropdown (same trigger + menu
    pattern as the album `...` menu): the three keys plus
    Ascending/Descending, with check marks, rendering only when
    `onSortChange` is provided. One outside-click/Escape effect now
    covers both header menus.
  - `Filmstrip` gains an optional `sortKey` prop so its direction-toggle
    label names the active key (`Sort filenames A to Z`, `Sort by
    import, oldest first`, legacy `Sort photos oldest/newest first`).
- `apps/web/src/index.css`
  - `.browser-sort-menu` shares the `position: relative` dropdown anchor
    with `.browser-album-menu`. The menu itself reuses
    `.dropdown-menu` / `.album-menu` / `.menu-separator`.
- Tests:
  - `packages/core/src/albumSort.test.ts` (new, 10 tests): numeric
    filenames, per-key ordering with the other stamp running opposite,
    missing/garbage-EXIF fallback to import time, missing-`importedAt`
    fallback to capture time, fully undated photos sinking below dated
    ones, filename/id tiebreaks, desc-is-reverse, input immutability.
  - `packages/ui/src/components/sortAlbum.test.tsx` (new, 5 tests, same
    SSR-markup pattern as tasks 05/06): grid trigger renders with the
    handler and names the active key+dir, absent without it, filmstrip
    labels per key, legacy default label, CSS anchor pin.
  - `apps/server/src/routes.test.ts`: the import test now pins that
    `importedAt` is served as a string.

## Decisions

- **Client-side sort, one new served field.** Every key except import time
  already shipped on `Photo` (`name`, `date`); the only server change is
  exposing the existing `created_at` column. No query params, no
  endpoint, no migration.
- **Global preference, not per-album.** The choice lives in the shared
  `f8.tool-prefs-v1` object next to the panel toggles, following the
  existing prefs conventions (lazy `readToolPrefs` init, allowlist
  sanitize, merge-write effect). Sort preference is sticky across
  albums; per-album maps would add state with no asked-for behavior.
- **Cross-fallback between the two timestamps.** `captured` falls back
  to `importedAt` when `date` is missing/unparseable and vice versa, so
  mixed libraries (EXIF-less files, legacy records without the stamp)
  still order sensibly; only fully undated photos sink to the end.
  (`date_taken` itself is already EXIF-first with an mtime fallback
  baked in at import, so "datetime captured" was never purely EXIF.)
- **Filmstrip toggle kept as a direction flip.** Removing it would lose
  one-click newest/oldest in the editor; rewiring it to the shared
  direction keeps it meaningful for all three keys, with the label
  updated so it never lies about filename order.
- **Branched null comparison, not subtraction.** The first version
  subtracted with an `Infinity` stand-in for missing stamps, but
  `Infinity - Infinity` is `NaN`, which `sort()` reads as equal and
  skips the tiebreak. A unit test caught it; the comparator now
  branches dated/undated explicitly.

## How verified

- `vitest run src/albumSort.test.ts` (core) — 10 pass.
- `vitest run src/components/sortAlbum.test.tsx` (ui) — 5 pass.
- `yarn test` (turbo, all workspaces) — 5 tasks successful: core 526
  pass, ui 18 pass, server 89 pass.
- `yarn typecheck` (turbo, all workspaces) — passes.
- Grep over `apps/web/tests` confirms no e2e spec references the sort
  surfaces, so no spec update. No API doc lists the photo object shape,
  so no doc update beyond this writeup.
- Playwright was not run (per task instructions).
