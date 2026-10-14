# Task: Album thumbnail option in the album (...) menu

## Request

Add an option in the context menu (...) of an album to find/generate/crop
a representative thumbnail for the album to show in the sidebar.

## Change

- `packages/core/src/albumCover.ts` (new, exported from `index.ts`)
  - `pickAlbumCover(photos)` picks the representative image: first
    favorite, else highest-rated, else first by filename (deterministic
    tie-break). Missing originals and records with no image are skipped;
    returns the thumbnail URL (falling back to the full-size `src`), or
    null when nothing qualifies.
- `packages/ui/src/hooks/useLibrary.ts`
  - New `updateAlbum(id, patch)` wrapping the existing
    `client.updateAlbum` (PATCH `/api/albums/:id`), merging the returned
    album into state. Same offline-marking + rethrow shape as
    `createAlbum`.
- `packages/ui/src/components/Sidebar.tsx`
  - New optional `onGenerateAlbumThumbnail` / `onRemoveAlbumThumbnail`
    props. The row menu now shows a thumbnail group above a separator
    from Delete: Generate (disabled while the album is empty), plus
    Remove while a cover is set. The trigger renders when any of the
    three menu handlers is present.
  - New `initialOpenMenu` test seam (album id whose menu starts open),
    matching the existing `initialDropTarget` convention.
- `packages/ui/src/components/PhotoStrips.tsx`
  - The same two items in the grid header's album menu (`browser-album-menu`),
    with the same ordering and separator. Generate is never disabled
    there: the grid list is search/filter narrowed, so an empty grid
    does not mean an empty album — the caller reports that case.
  - New `initialAlbumMenu` test seam, matching `initialContextMenu`.
  - Built-ins still never show the menu, whatever handlers are passed.
- `apps/web/src/App.tsx`
  - `generateAlbumThumbnail` runs the pick over the full library (not the
    filtered grid), stores the URL as the album cover, and toasts
    `Thumbnail set for "…"`. Empty albums toast `"…" has no photos yet.`
    without calling the server. `removeAlbumThumbnail` clears the cover
    (toast `Thumbnail removed from "…"`). Both are wired into the
    sidebar and the grid header menus.
- Tests (new `albumCover.test.ts` with 8 cases, new
  `albumThumbnail.test.tsx` with 9 cases, plus one `updateAlbum` client
  case in `library-client.test.ts`):
  - Core: empty → null, missing/imageless skipped, favorite > rating >
    filename, thumbnail preferred over src.
  - UI (SSR markup): trigger renders with thumbnail handlers alone,
    open-menu item order with separator, remove hidden without a cover,
    sidebar generate disabled only when empty, cover `<img>` rendered
    once set, grid menu present/hidden per album kind, grid generate
    never disabled.
- No server change: PATCH `/api/albums/:id` with `cover` and the
  `albums.cover` column already existed, as did the sidebar's cover
  rendering (`.album-item img` with `object-fit: cover` does the crop).
  No CSS or README change: no new styles, no architecture change.

## Decisions

- Automatic pick, not a photo chooser: the task asks to
  "find/generate/crop" a representative thumbnail, so one click
  regenerates it deterministically from signals the user already gave
  (favorites, ratings) instead of opening a picker.
- Added a Remove thumbnail item alongside Generate: without it there is
  no way back to the folder glyph, and the with/without-thumbnail album
  states (which the follow-up sidebar-sorting task needs) would be
  unreachable in the UI.
- Mirrored the items in the grid header's album menu, not just the
  sidebar row: both are "the context menu (...) of an album", and the
  grid is where the user sees the photos the pick is drawn from.
- `useLibrary.updateAlbum` merges by id rather than refetching, so the
  sidebar thumbnail updates in place with no list reorder or scroll jump.

## Verification

- `yarn workspace @f8/core test` — 57 files / 1011 tests pass.
- `yarn workspace @f8/ui test` — 74 files / 577 tests pass.
- `yarn workspace @f8/core typecheck`, `@f8/ui typecheck` pass;
  `@f8/web typecheck` passes after `yarn workspace @f8/ui build`
  (see Learnings).
- No Playwright, per the task brief.
