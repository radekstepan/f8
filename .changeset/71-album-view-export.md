---
'@f8/core': minor
'@f8/ui': minor
'@f8/web': minor
---

Exporting a whole set of photos is now one click: the album page header carries an Export button that zips exactly what's in the grid — the current album plus any active filters, search, and sort, smart albums included — after a quick confirm of file format and quality, with import-style progress while each photo renders.

## Change

- `packages/core/src/albumExport.ts` (new): batch-export helpers — `ALBUM_EXPORT_FORMATS` (JPEG/PNG/WebP, the canvas pipeline's supported set), `ALBUM_EXPORT_MAX_SIZE` (full source resolution), `albumExportFilename` (sanitized, case-insensitively deduped member names), `albumExportZipName`, `formatAlbumExportProgress` / `formatAlbumExportSummary` (mirroring the import-toast copy), and `zipStoreFiles`, a dependency-free stored (uncompressed) ZIP writer with CRC-32, UTF-8 names, and zip32 limit guards. Exported from the core index.
- `packages/core/src/types.ts`: `DialogType` gains `'export-album'`.
- `packages/ui/src/components/PhotoStrips.tsx`: `PhotoBrowser` gains an optional `onExportAlbum` prop rendering a Share-glyph "Export album view" button in the heading actions (matching the Export button glyph), disabled when the view is empty, hidden when the handler is omitted.
- `packages/ui/src/components/EditorDialogs.tsx`: new exported `AlbumExportDialog` — format select + quality slider (lossy formats only), no size picker, no super-resolution, no preview — dispatched on `dialog === 'export-album'` via a new `exportAlbum` prop (`{ title, count, onConfirm }`), rendering nothing when unset.
- `apps/web/src/App.tsx`: the heading button opens the dialog; confirm runs `exportAlbumView`, which snapshots `filteredPhotos` (the grid's own pipeline — no re-derivation), renders each photo through `exportPhoto` with the grid's look (`liveEdits[id] ?? photo.edit`) and the single-photo repair resolution, tracks progress through the import progress toast (renamed `ImportProgressToast` → `ProgressToast` with a `format` prop, defaulting to the import copy), shows a "Zipping N photos…" label while packing, then downloads one zip via `downloadBlob` and toasts the summary. Per-photo failures are counted and skipped, never aborting the batch.
- `README.md`: one bullet for the album-view zip export.
- Tests: `packages/core/src/albumExport.test.ts` (13 tests: CRC-32 vectors, filename/extension/dedupe mapping, progress/summary copy, zip round-trip through a minimal reader incl. empty archive, non-ASCII names, and the entry-limit guard); `packages/ui/src/components/albumExport.test.tsx` (13 tests: heading-button markup/hidden/disabled states, dialog format+quality/lossless/preview-free markup, empty-view disabled confirm, dispatch with/without target, and four App-wiring source pins).

## Decisions

- **Hand-rolled stored ZIP, no new dependency.** No zipping existed in the codebase; exported photos are already-compressed bytes, so DEFLATE would buy almost nothing while bloating the single-file web bundle — stored entries keep the download byte-exact with zero deps. Verified independently: Python's `zipfile` and Info-ZIP both open and check the output.
- **Export set = `filteredPhotos`, snapshotted once.** The grid's own memo (album predicate, search rank, chip filters, sort) is the contract for "current view", so the batch reads it directly instead of re-deriving anything; snapshotting at confirm time keeps mid-run grid changes from skewing the batch.
- **Full resolution, shared quality, TIFF out.** The task asks only for filetype + quality confirmation, so batches render at the pipeline's original-size sentinel with one shared quality; TIFF has no browser canvas encoder, so the format list stays JPEG/PNG/WebP like the single-photo dialog.
- **Progress reuses the import toast, not a new modal.** The brief asks for progress "modeled on the import progress UI" — that UI is the persistent determinate toast, so the export drives the same component with an export formatter (component renamed to `ProgressToast` to stop lying about its job).
- **Source pins for the App.tsx half.** Same constraint as the last two tasks: the UI suite runs in node without jsdom and apps/web has no unit harness (Playwright forbidden), so the batch flow is pinned at the source level per precedent.
- **Changeset number 71.** Highest numeric prefix across `.changeset` (70) and `docs/tasks` (18) is 70, so this continues the running log at 71.

## Tests

- Core suite: 68 files / 1206 pass (1193 before + 13 new in `albumExport.test.ts`). `typecheck` clean.
- UI suite: 91 files / 731 pass (718 before + 13 new in `albumExport.test.tsx`). `typecheck` clean.
- Web `typecheck` clean, `web build` succeeds; server suite 181 pass (untouched, rerun for safety). No Playwright, per the task rules.
- Mutation check: exporting `photos` instead of `filteredPhotos` fails the batch-source pin (proves the test locks the view contract); restored afterwards.
- Independent zip check: a sample archive from the built core output opens clean in Python `zipfile.testzip()` and `unzip -t`.
