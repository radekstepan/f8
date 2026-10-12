# Task 02 — Folder imports file into auto-created albums

## Problem

Folder imports landed on the `imports` pseudo-collection, which matches no
album row, so imported photos appeared in All Photos but in no album.
There was also no filing by source folder at all.

## Change

- New pure `humanizeAlbumName(folderName)` in
  `packages/core/src/albumNames.ts` (exported from `@f8/core`):
  dash/underscore/space runs become single spaces, each word gains a
  capital ("2026-europe-trip" → "2026 Europe Trip"), inner casing is
  preserved, unreadable names fall back to "Imported Photos", capped at
  the 60-char album-name limit.
- `scanPaths` (`apps/server/src/importer.ts`) now tracks each file's
  source folder and files it into a human-named album. An explicitly
  chosen album (importing while viewing an album) still wins for the
  whole batch. Auto targets match existing albums case-insensitively by
  name, so reimports never spawn lookalikes, and materialize lazily on
  the first fresh import, so duplicate-only scans leave no empty album.
  `ScanReport` gains the created `albums`.
- `POST /api/imports/by-path` returns the created `albums`
  (`ImportReport.albums` in `@f8/core`); `useLibrary.importPaths`
  merges them into sidebar state, and `App.tsx` navigates to the
  photo's album (instead of `imports`) and names the new album in the
  import toast.
- No dedupe code change was needed: SHA-256 identity already reports
  same-bytes reimports as duplicates and path-changed ones as relinks,
  both keeping their existing rows (album included). The new tests pin
  that: reimporting a folder yields only duplicates, no new album, no
  new photos — each file stays unique app-wide.
- One-line README addition under Library Server ("Folder albums").
  Uploads (file picker) are unchanged: browsers hide folder paths, so
  there is no folder name to file by.

## Decisions

- Loose individually-picked files file by their parent dir, and nested
  files by the selected folder (not the nested dir).
- Unknown/deleted album ids (including `imports`) fall back to auto
  mode rather than limbo.

## Verification

- `albumNames.test.ts` (core): 5/5 pass; full `@f8/core`: 41 files /
  722 tests pass.
- Server `importer.test.ts` + `routes.test.ts`: 34/34 pass (5 new
  scanPaths tests + 1 new route test); full `@f8/server`: 17 files /
  167 tests pass.
- `typecheck` passes for core, server, ui, and web (core + ui
  rebuilt so dependents pick up the new export/field).
- Playwright not run (per task-loop rules).
