# Task 5: Remove redundant album label/cull actions

## Investigation finding: yes, both are automatic on import

Both passes run server-side for every fresh import, on both import
routes (`POST /api/imports/upload` and `POST /api/imports/by-path`,
which also covers folder import):

- `apps/server/src/app.ts` ("Fresh bytes queue a background CLIP
  embedding ... plus a classical cull assessment") enqueues each
  freshly imported photo id into both the semantic-embedding queue
  and the cull-assist queue; duplicates and relinks enqueue nothing.
- The album menu actions ("Label unlabeled photos", "Find blurry
  photos") only backfilled photos that arrived before the weights
  did — redundant now that import-time indexing is the norm.

So both explicit actions were removed from the album "..." dropdowns
(sidebar rows and grid header). Delete album stays: it is manual and
not automatic.

## What changed

- `packages/ui/src/components/Sidebar.tsx`: album row menu is now
  Delete-only; `onLabelAlbum`/`onCullAlbum` props removed.
- `packages/ui/src/components/PhotoStrips.tsx`: grid-header album
  menu is now Delete-only; same props removed.
- `apps/web/src/App.tsx`: removed the `labelAlbumPhotos` /
  `cullAlbumPhotos` handlers, their prop passing, and the two
  labeling/cull progress toasts.
- `apps/web/src/vision/useSemanticSearch.ts`: labeling half removed
  (`labelAlbum`, `labeling`, `labelProgress`); search only.
- Deleted `apps/web/src/vision/useCullAssist.ts` and
  `apps/web/src/vision/remoteCullAssist.ts` (fully dead).
- `apps/web/src/vision/remoteSemanticSearch.ts`: removed
  `runRemoteLabelAlbum`, `warmupRemoteSemanticSearch`,
  `SemanticWeightsMissingError` (label-retry only); search only.
- `packages/core/src/vision/semantic-search.ts`: removed the dead
  `SEMANTIC_SEARCH_LABEL_ACTION_HINT`; the empty-labels note no
  longer points at a menu action that does not exist.
- `README.md`: the two feature bullets no longer reference the
  removed menu actions.

## Decisions

- **Kept the server backfill endpoints** (`POST
  /api/semantic-search/label`, `POST /api/cull-assist/cull`) and the
  `@f8/core` client wrappers plus their tests. They are the only path
  for photos that arrived before the weights did; deleting the UI
  trigger does not require deleting the tested API capability.
- **Kept Delete album in both dropdowns.** The brief says to keep any
  manual action that is not automatic; deletion is one.
- **No replacement backfill UI.** Per the task, the explicit actions
  go away; re-adding a backfill affordance (e.g. in the info dialog)
  is a follow-up if missed-label photos become a real problem.

## Tests

- `apps/server/src/routes.test.ts` (new test): folder by-path import
  enqueues fresh photos into both the semantic and cull queues, and
  reimports enqueue nothing — pins the automatic-on-import behavior
  that justifies the removal. (Upload-route enqueue was already
  pinned per-queue in `semantic-search.test.ts` / `cull-assist.test.ts`.)
- `packages/ui/src/components/semanticSearch.test.tsx`,
  `cullAssist.test.tsx`: removed the four tests pinning menu
  triggers for the deleted actions; delete-only menu wiring stays
  pinned in `removeAlbum.test.tsx`.
- `packages/core/src/vision/semantic-search.test.ts`: no-training
  copy test updated for the removed hint constant.

## Verification

- `yarn typecheck` — clean (all packages).
- `yarn test` — all suites pass (server 173, core 792, ui green).
- Playwright not run (per task rules).
