# Task 3: Import a whole folder as an album

## What changed

A whole local folder can now be imported from the browser, and it lands in
its own album named from the folder. Two entry points:

- `File → Import Folder as Album…` opens a native folder picker
  (`webkitdirectory`). The picked folder's photos upload into a new album
  named from the folder ("2026-europe-trip" becomes "2026 Europe Trip").
- Dropping a folder (or a mix of folders and files) onto the app does the
  same. Previously a folder drop silently did nothing, because
  `dataTransfer.files` is empty for folders.

This complements the existing server-side flow (`Import from Folder…`,
which references server-disk files in place): the new flow uploads bytes
like any picker/drop import, so it works regardless of where the server
runs. No server changes were needed.

Behavior details:

- Each top-level folder becomes its own album; nested subfolders merge
  under their top-level folder. Loose files in the same pick/drop keep the
  old behavior (viewed album, or the `imports` collection).
- Album naming reuses `humanizeAlbumName`, and filing matches the
  server-side convention: an existing album of the same name
  (case-insensitive) is reused, so reimports never spawn lookalikes, and
  same-named folders in one drop share one album.
- All existing import conventions carry over per folder group: the
  `resolveImportSelection` filter (importable types, RAW+JPEG sidecar
  suppression), the 200-file per-batch cap with truncation notes, per-file
  failure counting, hash dedup, and the aggregated summary toast (plus
  `New album "…".` notes). The progress toast runs 0..total across groups
  instead of restarting per album.
- A run-created album that gains no photos (everything already imported,
  or everything failed) is deleted again, mirroring the server's lazy
  album creation — a no-op reimport leaves no empty album behind.
  Pre-existing albums are never deleted.
- After import the app navigates to the first group that yielded a photo
  and selects it, as before.

## Decisions

- **Folder groups always file into their folder album**, even when an
  album is being viewed. The server-side by-path flow lets the viewed
  album win, but here the folder→album filing is the explicit point of
  the action; loose files keep the old viewed-album behavior.
- **Album reuse over always-new.** `POST /api/albums` 409s on
  case-insensitive name matches, so the client seeds a name→id map from
  current albums (plus mid-run creations) and reuses. A failed creation
  (e.g. a 409 race) files that group into the default album with a
  summary note rather than dropping the photos.
- **Traversal lives in `@f8/core`** (`collectDroppedFiles`), because
  `apps/web` has no unit-test runner (Playwright only, which is out of
  scope). Entry/item types stay structural (the DOM base entry type
  lacks `file()`/`createReader`), narrowed at runtime, so Node tests
  drive the traversal with fakes.
- **Unreadable dropped entries are skipped**, not fatal: one locked file
  must not kill a whole folder drop. The summary covers what arrived.
- **No traversal cap.** Upload batching already caps each group at
  `MAX_IMPORTS_PER_REQUEST` with honest truncation counts; capping the
  traversal as well would only under-report them.
- **No empty-gate button.** The gate already offers "Import from folder"
  (server browse); a second folder button would confuse. Menu + drop
  cover the new flow, and the drop overlay now reads "Drop your photos
  or a folder…".
- **No new shortcut.** `Ctrl/⌘ O` (photos) and `Ctrl/⌘ Shift O` (server
  browse) are taken; the menu item has none.

## Files

- `packages/core/src/folderImport.ts` (new): `topFolderOf`,
  `groupFilesByFolder`, `collectDroppedFiles` (+ structural drop types).
- `packages/core/src/index.ts`: export the new module.
- `packages/core/src/folderImport.test.ts` (new, 18 tests): grouping,
  naming, traversal (nested/multi-batch readers, fallbacks, no
  double-count, unreadable entries skipped).
- `apps/web/src/App.tsx`: `importFiles` groups by folder and files each
  group into its folder album; new `importDrop` traversal path;
  `webkitdirectory` picker inputs (gate + shell); `import-local-folder`
  action; drop overlay copy.
- `packages/ui/src/components/Topbar.tsx`: `import-local-folder`
  `MenuAction` + `Import Folder as Album…` File menu item.
- `README.md`: folder picker/drop noted in the import bullets.

## Verification

- `yarn workspace @f8/core test` — 47 files / 792 tests pass (+1 file /
  +18 vs HEAD).
- `yarn workspace @f8/ui test` — 23 files / 164 tests pass.
- `yarn workspace @f8/server test` — 18 files / 172 tests pass.
- `typecheck` clean for `@f8/core`, `@f8/ui`, `@f8/web` (rebuilt
  core/ui `dist`, which typechecks resolve against).
- `yarn workspace @f8/web build` succeeds.
- SSR probe (temporary, since removed) confirmed the spread
  `webkitdirectory` attribute reaches the rendered `<input>`.
- Playwright not run (per task rules).
