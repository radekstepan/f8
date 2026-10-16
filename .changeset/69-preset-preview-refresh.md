---
'@f8/core': patch
'@f8/ui': patch
'@f8/web': patch
---

Album and filmstrip thumbnails now refresh when a preset is applied in another tab: the live-edits override covers only photos edited in this session, and returning to a tab re-reads photo recipes in the background, so the grid can no longer pin the stale load-time look forever.

## Change

- `packages/core/src/image.ts`: new `liveEditsForSession(histories)` — builds the thumbnail override map from session histories, including only entries with an undo past or a redo future (pristine seeded entries are omitted so `thumbnailFilterForPhoto` falls through to the persisted `photo.edit`).
- `apps/web/src/App.tsx`: `liveEdits` now derives via `liveEditsForSession(editor.histories)` instead of mapping every history to its present (the grid and filmstrip both consume it, so both are fixed).
- `packages/ui/src/hooks/useLibrary.ts`: new background `refreshPhotos` (GET `/api/library` merged through the pending-meta-safe `upsertPhotos`, failures silent) fired on `visibilitychange` (tab switch back) and window `focus` (side-by-side window click), with listener cleanup.
- Tests: `liveEditsForSession` block in `packages/core/src/image.test.ts` (6 tests); new `packages/ui/src/components/presetPreviewRefresh.test.tsx` (6 tests: App-wiring source pins, refresh-wiring source pins, and two behavioral grid renders — refreshed persisted look shows for untouched photos, session override still wins while dirty).

## Root cause

Two halves, either alone harmless. (1) The client loads the library snapshot once per page (re-fetching only on offline/online transitions), so edits persisted from another tab or window never reached a viewing tab — no invalidation existed. (2) The live-edits override mapped *every* seeded history to its present, and the live edit always wins `thumbnailFilterForPhoto`'s `??` — so even a refreshed `photo.edit` could never show through; the stale seed shadowed it forever. Same-tab apply-then-view already worked (verified behaviorally with a throwaway React-shim probe driving the real `useEditor.applyPreset`, plus SSR grid renders — both reached the right filter), which is why the report only reproduced cross-session: the DB save landed, but the observing tab had no path to it.

## Decisions

- **Override by session dirtiness (past/future lengths), not by comparing recipes.** Every `useEditor` change pushes an undo step (or keeps one), so past/future emptiness exactly marks pristine entries — no deep compare, no new memo deps, no per-keystroke stringify cost. Undo-all (future only) stays overriding so the grid matches the canvas rather than the server.
- **Refresh photos only, upsert-only, silent failures.** Albums/presets have no reported cross-tab staleness, and leaving them alone keeps the refresh append-safe against in-flight creates; upsert-only never drops local state (uploads mid-refresh survive) and never yanks a photo out from under an open editor; failures stay silent because the offline machinery owns takeovers.
- **Both `visibilitychange` and `focus`.** Tab switches fire visibility (the window keeps focus); side-by-side window clicks fire focus (both tabs stay visible). Either alone misses a real layout.
- **Changeset number 69.** `.changeset` holds unnumbered slugs and `docs/tasks` was pruned to 01–18, but the learnings index records the running log through 68 — reusing 19 would violate never-reuse, so this continues the log at 69.

## Tests

- Core suite: 67 files / 1193 pass (1187 before + 6 new; `image.test.ts` 22 pass). `typecheck` clean.
- UI suite: 89 files / 711 pass (incl. 6 new in `presetPreviewRefresh.test.tsx`). `typecheck` clean.
- Mutation check: temporarily restoring the old all-histories derivation fails the App-wiring pin (proves the test locks the fix); restored afterwards.
- Web `typecheck` clean, `web build` succeeds; server suite 181 pass (untouched). No Playwright, per the task rules.
