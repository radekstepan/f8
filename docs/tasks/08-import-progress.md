# Task 08 — Persistent import progress + bulk-import batching

## Finding

Two gaps in the import flow (`apps/web/src/App.tsx` `importFiles` →
`packages/ui/src/hooks/useLibrary.ts` `uploadFiles` →
`apps/server/src/importer.ts`):

1. The "Importing your photos…" toast auto-dismissed after 3.6 s, so any
   import longer than that ran with no status, and there was no % or file
   count anywhere.
2. `uploadFiles` silently sliced the batch to 30 files (no truncation note),
   pushed one React state update per photo, and never yielded to the event
   loop — the recipe for a stalled tab on hundreds of photos. The server
   scan loop likewise reported nothing per file.

## What I did

- `packages/core/src/raw.ts` — added the shared import-progress contract:
  `MAX_IMPORTS_PER_REQUEST = 200` (single cap for client batching and the
  server scan loop), `ImportProgress { done, total }`, `importPercent`,
  `formatImportProgress` ("Importing 12 of 120 (10%)…", bare "Importing…"
  for unknown totals), and `formatUploadSummary` (existing toast wording
  plus a "Stopped at the per-import limit…" sentence when truncated).
- `packages/ui/src/hooks/useLibrary.ts` — `uploadFiles(files, albumId,
  onProgress?)` now caps at the shared 200 (was a silent 30), reports
  `{ done, total }` from 0 through completion, flushes imported photos
  into React state in chunks of 10 instead of one render per photo, and
  yields a frame between files. `UploadSummary` gains `truncated`/`total`.
- `apps/server/src/importer.ts` — `scanPaths` takes the cap from core,
  accepts `onProgress`, and yields (`setImmediate`) between files so
  hundreds of sequential imports never starve the event loop.
- `apps/web/src/App.tsx` — new persistent `ImportProgressToast`
  (`role="progressbar"`, spinner + label + bar) that never auto-dismisses:
  determinate counts + % for dropped/picked files, an indeterminate bar
  with "Importing from disk…" for folder scans (one request, no per-file
  ticks) and "Relinking original…" for locate flows. Rendered in both the
  empty-library gate and the main view. Overlapping imports each complete;
  only the latest drives the toast (run token). Final summary now goes
  through `formatUploadSummary`.
- `apps/web/src/index.css` — `.toast.importing` (offset above the transient
  toast slot so summaries never cover it), `.import-bar` determinate fill
  and animated indeterminate variant.

## Files changed

- `packages/core/src/raw.ts`
- `packages/core/src/raw.test.ts` (new tests)
- `packages/ui/src/hooks/useLibrary.ts`
- `apps/server/src/importer.ts`
- `apps/server/src/importer.test.ts` (new tests)
- `apps/web/src/App.tsx`
- `apps/web/src/index.css`
- `docs/tasks/08-import-progress.md` (this report)

## Tests added/run with results

- Core `raw.test.ts` (+9): cap value, percent clamp/edge cases, progress
  label incl. overrun clamp and unknown totals, summary wording incl.
  singular/plural/truncated/empty. Pass.
- Server `importer.test.ts` (+2): per-file progress ticks 0→3 on a 3-file
  folder; 205-file folder stops at 200 outcomes with `truncated: true`
  and a final `{ done: 200, total: 200 }` tick. Pass.
- Full suites (not just touched files): core 24 files / 464 tests pass;
  server 7 files / 56 tests pass. `yarn typecheck` passes for all
  4 packages. Note: the server resolves `@photomator/core` from `dist`,
  so core was rebuilt before the server run.
- Web/UI packages have no unit-test runner (Vitest only in core/server),
  so the progress toast wiring is covered by typecheck plus the
  core-tested formatters it renders — no component test added.

## How to verify

1. `yarn dev`, drop ~25 photos onto the app (or Import photos): a progress
   toast shows "Importing N of 25 (P%)…" with a filling bar until the
   summary toast lands; photos appear in the grid in chunks.
2. Drop 250+ files: the batch stops at 200 and the summary ends with
   "Stopped at the per-import limit; run it again for the rest."
3. Import from folder: the "Importing from disk…" toast with an animated
   bar stays up until the report toast replaces it (no 3.6 s vanishing).

## Unresolved items

- Folder scans stay indeterminate: per-file ticks would need a streaming
  or pollable progress protocol on `/api/imports/by-path` (the server
  `scanPaths` already emits `onProgress` if a future route wants it).
- The pre-existing `truncate at 200, run again for the rest` UX is kept;
  no automatic multi-request resume was added. Changes left uncommitted.
