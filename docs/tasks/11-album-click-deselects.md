# Task 11: Album click deselects

Clicking the already-selected album in the sidebar re-selected it (a
no-op that also reset any chip filters), stranding the user on that
album's grid. It now deselects back to All Photos: selection state,
URL, and grid all follow the existing `selectCollection('all')` path,
so they stay consistent by construction.

## What changed

1. **Pure resolver** (`packages/core/src/collections.ts`). New exported
   `resolveCollectionClick(current, clicked, view)` helper: in the grid
   (`library` view) a click on the already-selected collection resolves
   to `'all'`; anything else resolves to the clicked id unchanged.
2. **Wiring** (`apps/web/src/App.tsx`). `selectCollection` resolves the
   click through the helper and keys the Favorites/Recently Edited
   entry-preset filters off the *resolved* collection, so a toggle to
   All clears them exactly like any other move to All. The existing URL
   effect then writes `?album=all` (same-view `replaceState`, no
   history spam), the multi-selection clears via the existing
   collection-change effect, and the grid re-titles to All Photos.
3. **Tests:** 6 new cases in `collections.test.ts` (re-clicked user
   album deselects; re-clicked Favorites/Recently Edited deselect;
   re-clicking All Photos is a no-op; a different collection selects
   as clicked; editor view never toggles; toggled state round-trips
   through `buildLibraryUrl`/`parseLibraryUrl` and lists every photo
   via `photoInCollection`).

## Decisions

- **Toggle lives in App, not Sidebar.** The sidebar does not know the
  view, and the correct behavior depends on it: inside a photo the
  highlighted collection is inferred from the open photo (never picked
  by the user), so clicking it must open that album's grid rather than
  toggle away to All. Gating on `view === 'library'` keeps that
  navigation intact.
- **Built-ins toggle too, not just user albums.** Favorites and
  Recently Edited re-clicks were pure no-ops (their entry presets are
  already applied while selected), so giving them the same deselect
  semantics removes re-select weirdness uniformly. All Photos is the
  deselected state itself, so re-clicking it stays a no-op.
- **Helper in `@f8/core`, tested there.** The repo's UI tests are
  SSR-only (markup + prop wiring, no click simulation) and `App.tsx`
  has no unit harness, so the behavior ships as a tested pure
  function — the same seam as `menuAnchor`, `escapeNavigation`, and
  `photoSelection`.
- **No README change.** Small interaction fix with no architecture or
  API-surface change.

## Verification

- `yarn workspace @f8/core test`: 48 files, 842 tests, all pass (836
  pre-existing + 6 new).
- `yarn workspace @f8/ui test`: 43 files, 335 tests, all pass
  (unchanged).
- `yarn workspace @f8/core typecheck`, `@f8/ui typecheck`,
  `@f8/web typecheck`: clean (after rebuilding `@f8/core` dist, which
  the web workspace resolves and which is gitignored).
- Playwright not run (per brief).
