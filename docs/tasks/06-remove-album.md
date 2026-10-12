# Task 06 — Delete a whole album via menu

## What changed

No server change was needed: `DELETE /api/albums/:id`
(`apps/server/src/app.ts`) already deletes only the album row — photos keep
their `album_id` and stay listed in All Photos — with `store.deleteAlbum`
and the `deleteAlbum` client in `packages/core/src/library.ts` already in
place. This task adds the missing client state + UI:

- `packages/core/src/collections.ts`
  - New `BUILT_IN_COLLECTIONS` (`all`, `favorites`, `edited`) with
    `isBuiltInCollection` / `isDeletableCollection` guards. The built-ins
    are computed from flags/recency, never stored, and can never be
    deleted.
- `packages/core/src/types.ts`
  - `DialogType` gains `'remove-album'`.
- `packages/ui/src/hooks/useLibrary.ts`
  - New `removeAlbum(id)`: calls `client.deleteAlbum`, then drops only the
    album from state. Photos are untouched, mirroring the server.
- `packages/ui/src/components/Sidebar.tsx`
  - Album rows are now an `.album-row` wrapper: the select button plus a
    `...` (`MoreHorizontal`) trigger that appears on row hover/focus (or
    while its menu is open) and opens a `Delete album…` dropdown menu.
    Library built-ins are a separate section and get no trigger. The menu
    only renders when `onRemoveAlbum` is provided.
- `packages/ui/src/components/PhotoStrips.tsx` (`PhotoBrowser`)
  - New optional `album` + `onRemoveAlbum` props. When the grid shows a
    real user album, a `...` menu sits at the top of the album view next
    to the grid-size control with `Delete album…`. Built-in ids, search
    views (no album), and a missing handler render no menu.
- `packages/ui/src/components/EditorDialogs.tsx`
  - New `RemoveAlbumDialog` (`remove-album`), reusing the remove-confirm
    pattern: names the album, states its N photos stay in the library
    under All Photos, `Keep album` / danger `Delete album`. Renders
    nothing without a target.
- `apps/web/src/App.tsx`
  - `requestRemoveAlbum` (guards built-ins + unknown ids) and
    `confirmRemoveAlbum` wired to both menus and the dialog. After a
    delete the open collection falls back to `all` immediately, and the
    toast names the album and the kept photo count.
- `apps/web/src/index.css`
  - `.album-row` / `.album-menu-trigger` (hidden until hover/focus/open;
    the count yields via `:has()` so trigger-less rows are unaffected),
    right-aligned `.album-menu`, `.browser-heading-actions` /
    `.browser-album-menu` anchors.
- Tests:
  - `apps/server/src/routes.test.ts` — the existing album test now pins
    the no-photo-loss contract: after delete the photo survives with its
    `albumId` intact, and repeat/unknown deletes 404.
  - `packages/core/src/collections.test.ts` — built-in vs deletable
    classification, incl. case-sensitivity (`All` is an album, not the
    built-in).
  - `packages/ui/src/components/removeAlbum.test.tsx` (new, 7 tests, same
    SSR-markup pattern as task 05): per-album sidebar triggers with no
    built-in triggers, none without the handler, CSS hidden-until-hover
    pin, grid menu iff album + handler + non-built-in, dialog copy and
    danger button, no dialog without a target.

## Decisions

- **Reuse the existing server route as-is.** `DELETE /api/albums/:id` and
  the client were already shipped and tested; duplicating a delete path
  would only add drift. The writeup-worthy check was verifying its
  semantics (photos intact) and pinning them in the test.
- **Two entry points, one confirm dialog.** Both the sidebar `...` menu
  and the album-view header menu funnel through `requestRemoveAlbum` →
  `remove-album` dialog → `confirmRemoveAlbum`, so wording and guards
  cannot diverge.
- **Defense in depth for built-ins.** The triggers never render for
  built-ins (UI), `PhotoBrowser` re-checks `isBuiltInCollection`, and
  `requestRemoveAlbum` no-ops on built-in/unknown ids — a stray call can
  never open the dialog for All Photos.
- **Photos keep a dangling `album_id`.** Deleting an album does not rewrite
  its photos (server behavior, unchanged): they stay in All Photos and in
  any edited/favorite filters. Reusing the name later creates a fresh id,
  so orphans never reappear in the wrong album.
- **SSR markup tests, as in task 05.** No jsdom in the repo; the open
  dropdown is client-only state, so tests pin trigger wiring + dialog
  copy. Click behavior stays on the manual/playwright surface, not run
  here per instructions.

## How verified

- `vitest run src/components/removeAlbum.test.tsx` (ui) — 7 pass.
- `yarn test` (turbo, all workspaces) — 5 tasks successful, incl. core
  516 pass and the strengthened server album test.
- `yarn typecheck` (turbo, all workspaces) — passes.
- Grep over `apps/web/tests` confirms no e2e spec references the new
  `album-menu` / `onRemoveAlbum` / `remove-album` surface, so no spec
  update. No API doc lists the album endpoints, so no doc update beyond
  this writeup.
- Playwright was not run (per task instructions).
