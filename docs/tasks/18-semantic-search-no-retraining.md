# Task 18 — Semantic search: no training, no retraining

## Problem

The user asked how to retrain semantic search, and whether new imports
need a retrain. Nothing in the UI answered that — the album menus only
said "Label unlabeled photos" with an ML badge, and the README never
stated the model needs no training.

## Reality (verified in code)

- The model is a frozen pretrained CLIP ViT-B/32 vision encoder
  (`packages/core/src/vision/semantic-search.ts`); there is no training
  step anywhere.
- Every import enqueues its photo on the background embed queue
  (`apps/server/src/app.ts` → `createSemanticQueue`), so new photos
  index themselves when the weights are present.
- "Label unlabeled photos" only backfills photos that arrived before
  the weights did (or while offline); it never re-embeds labeled
  photos. So the fix is explanatory copy, not new behavior.

## Change

- Four shared copy constants in `semantic-search.ts` (exported through
  `@f8/core`): `SEMANTIC_SEARCH_LABEL_ACTION_HINT`,
  `SEMANTIC_SEARCH_ML_BADGE_HINT`,
  `SEMANTIC_SEARCH_EMPTY_LABELS_NOTE`, `SEMANTIC_SEARCH_NOTE_HINT`.
  One wording, used by every surface, so they cannot drift apart.
- Sidebar and grid album menus (`Sidebar.tsx`, `PhotoStrips.tsx`):
  the label item now tooltips "Backfills photos imported before the
  model arrived — new imports are indexed automatically, no training
  needed", and the ML badge states the model is pretrained.
- Search note (`PhotoStrips.tsx`): the "Semantic matches" line carries
  a tooltip explaining pretrained on-device ranking with automatic
  indexing of new imports.
- Photo info dialog (`EditorDialogs.tsx`): ML badge tooltip updated;
  the empty-labels note now reads "No labels yet — new imports are
  labeled automatically (no training needed); label this album from
  its menu to backfill, or add your own below."
- `App.tsx`: the "everything already labeled" toast appends "— new
  imports label automatically."
- `README.md`: the semantic-search bullet states there is nothing to
  train or retrain and what the label action actually backfills.

## Decisions

- Copy-only fix, no behavior change: the auto-embed pipeline already
  works (and is already covered by the server's import-enqueue test),
  so adding a redundant "reindex" action would have implied training
  exists — the opposite of the answer.
- Shared constants over per-component strings: the sidebar and grid
  menus already duplicated this item's copy verbatim, which is exactly
  how the two would drift again.
- Tooltips plus one visible note (empty labels) rather than new UI
  chrome: the question arises at these four spots, so the answer lives
  where the cursor already is.

## Verification

- New core test in `semantic-search.test.ts` pins the shared copy
  (every string states no-training + automatic indexing).
- Two new UI tests in `semanticSearch.test.tsx` pin the wiring
  (search-note tooltip, empty-labels note + badge tooltip).
- `semantic-search.test.ts`: 21/21 pass; full `@f8/core`: 755 pass;
  full `@f8/ui`: 137 pass; `yarn typecheck`: 6/6 ok.
- Playwright not run (per task-loop rules).
