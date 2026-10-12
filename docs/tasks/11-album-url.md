# Task 11 — Album view keeps a stale photo URL

## Finding

`apps/web/src/App.tsx` deep-linked only the open photo: its URL effect always
wrote `?photo=<id>&tool=<tool>` regardless of view, and `popstate` always
restored the editor. So opening an album grid (sidebar click, grid toggle,
search) left the previous photo's URL on screen, and Back never returned to
an album URL because view switches never pushed history entries.

## What I did

URL scheme (new): inside a photo the URL names the photo
(`?photo=&tool=`, album inferred from it as before); in an album grid the
URL names the collection (`?album=<collectionId>`, built-ins included) and
carries no photo param.

- `packages/core/src/libraryUrl.ts` (new) — pure helpers:
  `parseLibraryUrl` (`?photo=` wins over `?album=`; legacy `?collection=`
  accepted as an alias; invalid `?tool=` reads null; empty values absent)
  and `buildLibraryUrl` (each view writes only its own params).
- `packages/core/src/index.ts` — export the new module.
- `packages/core/src/collections.ts` — header comment updated (it claimed
  no collection ever appears in the URL).
- `apps/web/src/App.tsx` —
  - initial view/photo/collection/tool parsed once from the URL:
    `?photo=` opens the editor, `?album=` (or legacy `?collection=`) opens
    that album's grid, bare URLs keep the old editor-on-photo-1 default;
  - URL effect writes `?album=` in library view, `?photo=&tool=` in editor;
    same-view updates `replaceState` (no filmstrip-click spam), view
    switches `pushState` so Back returns to the previous view with its URL;
    writes are skipped when the URL already matches (popstate landed there);
  - `popstate` restores the view the URL points at instead of forcing editor
    (photo wins stale pairs; bare URL keeps the open photo in editor);
  - photo→collection inference is now editor-only, so it can't clobber a
    deep-linked `?album=` on load (photo id still recorded, so opening a
    grid photo infers normally);
  - unknown deep-linked albums fall back to All Photos once loaded;
  - removed the now-unused `TOOLS` const (validation lives in the parser).
- `apps/web/tests/e2e/collection-filters.spec.ts` — the test locking the old
  behavior ("switches the grid without touching the URL") now expects
  `?album=coast` with no `photo=`; added deep-link + reload and
  Back-button coverage. Other tests in the file still hold (editor URLs
  never carry a collection; `?photo=&collection=` still resolves to the
  photo's album with the stale param stripped).

## Tests

- Added `packages/core/src/libraryUrl.test.ts`: 13 tests (parse/build both
  views, legacy alias + precedence, photo-wins, invalid/empty/foreign
  params, round-trips, encoding).
- Ran `yarn workspace @photomator/core test` — **28 files / 499 tests pass,
  including the 13 new ones**; `yarn workspace @photomator/core build`, and
  `typecheck` for core, ui, web — **all pass**. Touched scope + typechecks
  only; full turbo suite not run.
- E2E not executed (no Playwright browsers installed here); validated the
  spec parses via `playwright test --list` — 9 tests listed, including the
  renamed and 2 new ones.

## How to verify

1. Open a photo, click an album in the sidebar: grid shows, URL becomes
   `?album=<id>` with no `photo=`.
2. Reload on `?album=coast`: the Coastal Escape grid (not the editor) loads.
3. Open a photo from the grid, press Back: the album grid and its URL return.
4. Reload on `?photo=photo-9`: editor opens, sidebar/filmstrip show Coastal
   Escape (inference unchanged).

## Unresolved

- E2E specs were updated but not executed locally (no browsers); CI should
  run `collection-filters.spec.ts`.
- Search text and chip filters are transient UI state, not deep-linked: the
  grid URL names the album scope only.
- Pre-existing, unchanged: toggling grid→editor (`g`) keeps the grid's
  collection rather than re-inferring from the photo.
