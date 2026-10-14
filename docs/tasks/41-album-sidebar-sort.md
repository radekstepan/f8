# Task: Album sidebar sort

## Request

Make sure the albums in the sidebar show sorted by name with the ones
that have a thumbnail showing ahead of the ones without.

## Change

- `packages/core/src/sidebarAlbums.ts` (new, exported from `index.ts`)
  - `compareSidebarAlbums(a, b)` orders covered albums (non-empty
    `cover`) before plain ones; each group sorts by name with a
    numeric-aware `localeCompare` (so "Trip 9" precedes "Trip 10"),
    with the id as a final tiebreak so the order is deterministic.
  - `sortSidebarAlbums(albums)` is the non-mutating client sort.
- `packages/ui/src/components/Sidebar.tsx`
  - The Albums section now renders `sortSidebarAlbums(albums)` instead
    of the raw prop order, so every caller (server order, new albums
    appended by `updateAlbum`) shows the same sorted list.
- Tests (new `sidebarAlbums.test.ts` with 7 cases, new
  `albumSidebarSort.test.tsx` with 2 cases):
  - Core: name order, covered-before-plain with per-group name order,
    empty cover counts as no thumbnail, numeric names, id tiebreak,
    non-mutating input, comparator total-order consistency.
  - UI (SSR markup): sidebar row order pins covered-first + name
    groups via `<span>` positions; the selected row keeps its
    `is-selected` highlight after the reorder.
- No server or README change: presentation-layer sort, no data or
  architecture change.

## Decisions

- Sort in the Sidebar render, not in `useLibrary` state or on the
  server: the task is about how the sidebar *shows* albums, and sorting
  at render keeps one order for every state path (initial load, album
  create, thumbnail generate/remove) with no reorder bookkeeping.
- Numeric-aware name compare, matching `albumSort.ts` photo sorting, so
  "Trip 9" / "Trip 10" style album names order the way users expect.
- Empty-string cover treated as no thumbnail: the `Album.cover` field
  is a plain string ("" when unset), and the row render already keys
  the `<img>` vs folder glyph off its truthiness — the sort keys off
  the same condition, so the two can never disagree.

## Verification

- `yarn workspace @f8/core build`, then `test` — 58 files / 1018 tests
  pass.
- `yarn workspace @f8/ui test` — 75 files / 579 tests pass.
- `yarn workspace @f8/core typecheck`, `@f8/ui typecheck` pass;
  `@f8/web typecheck` passes after `yarn workspace @f8/ui build`
  (see Learnings).
- No Playwright, per the task brief.
