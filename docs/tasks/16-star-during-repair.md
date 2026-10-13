# Task 16: Star / favorite responds immediately during a running repair

## Symptom

While a repair was running, clicking a star or the favorite heart did
nothing visible until the repair finished — then the change appeared.

## Root cause

Optimistic-update gating, not a disabled UI or a client queue. Verified
by inspection:

- The star/heart buttons are never disabled and always fire:
  `PhotoCanvas.tsx` (editor header) calls `onRating`/`onFavorite`
  directly, and `PhotoStrips.tsx` (library grid) likewise. No repair
  flag gates them.
- `toggleFavorite`/`setRating` (`apps/web/src/App.tsx`) call
  `library.updatePhoto`, which awaited the PATCH round-trip and only
  then upserted the returned photo into `photos` state — the single
  source the stars render from.
- While a repair runs, the photo server is saturated by ML inference
  (LaMa single pass, Moebius diffusion ~45s/area), so the PATCH
  response — and with it the only UI feedback — lands after the
  repair. The click worked; the feedback was gated on a saturated
  server.

A second, latent defect rode the same path: every repair stroke
schedules a debounced recipe save, and `PUT /api/photos/:id/edit`
returns the full photo row, which `saveEdit` upserts. Any naive
"apply locally, then PATCH" fix would let a repair save answering
with pre-PATCH rows wipe the star back out.

## Fix

Meta updates (favorite / rating / title / album) are optimistic now:

- `packages/core/src/photoMeta.ts` (new, framework-free):
  `applyPhotoMetaPatch` (pure merge) plus `createPendingPhotoMeta`, a
  per-photo pending tracker. `serverPhoto()` re-applies the pending
  patch over every incoming server record, so concurrent repair saves
  cannot clobber the star; each `begin()` takes a sequence number and
  only the latest PATCH per photo settles authoritatively, so
  out-of-order responses can never resurrect a toggled-past state;
  a failed latest PATCH returns the pre-optimistic values for
  rollback, while a failed superseded one leaves the newer
  optimistic state standing.
- `packages/ui/src/hooks/useLibrary.ts`: `updatePhoto` records the
  patch and flips local state synchronously at click time, then
  reconciles on PATCH settle (authoritative upsert / rollback /
  drop-if-stale). `upsertPhotos` routes every incoming record —
  PATCH, PUT /edit, labels, imports, full loads — through the
  pending overlay. Rapid toggles read the optimistic state, so each
  click still inverts what the user sees.
- `packages/core/src/index.ts`: export the new module.

No server change: the responsiveness contract is that UI feedback
must not depend on a saturated server. No `App.tsx` change: both
callers flow through `library.updatePhoto` (album moves via
`movePhotosToAlbum` get the same immediacy for free).

## Edge cases

- Star during repair on the same photo: covered — the repair's PUT
  /edit responses keep the pending star via the overlay, and the
  PATCH response lands authoritatively.
- Rapid double-toggle with a slow server: prev capture keeps the
  FIRST patch's values for overlapping keys, so failure rolls back
  past both toggles, not between them; out-of-order responses are
  dropped by sequence number.
- PATCH failure (offline): rollback to pre-optimistic values; the
  existing error toast still fires from the callers, and
  `markOfflineIfDown` still flips library status.
- Photo removed mid-flight: settle maps over current state, so a
  missing id is a no-op; no entry leaks (every begin settles via
  exactly one resolve/reject path).
- `updateLabels` keeps its await-then-upsert shape (out of scope)
  but inherits the pending overlay for the shared meta fields.

## Tests

- New `packages/core/src/photoMeta.test.ts` (15 tests): pure-merge
  semantics (defined-keys-only, no input mutation); pending merge
  across overlapping/follow-up patches; stale-save survival (star
  kept, repair's `edited` flag still picked up); pass-through with
  nothing pending; per-photo independence; latest-resolve clears;
  stale resolve/reject dropped; first-prev rollback across double
  toggles; unknown-id settles; plus an end-to-end star-during-repair
  scenario (optimistic → repair save → authoritative reconcile).
- The regression contract lives in core because the `@f8/ui` suite
  runs in node with server-rendered markup (no hook/effects
  harness): the tracker owns all ordering/merge decisions and is
  fully covered there; the hook is a thin adapter over it.
- Full `@f8/core` suite: 48 files / 830 tests pass;
  `tsc -p tsconfig.json --noEmit` clean. Full `@f8/ui` suite:
  35 files / 282 tests pass; `tsc --noEmit` clean. `@f8/web`
  typecheck clean (after rebuilding `@f8/core` then `@f8/ui` dist,
  which web resolves from). Lint is an unconfigured no-op echo in
  every package. No Playwright (per brief).

## Decisions

- Optimistic-in-client over server-side prioritization: the server
  saturates by design during inference (all cores on ORT), and even
  a fast PATCH still round-trips; immediate local feedback is the
  only fix that holds under every delay mechanism.
- Tracker in `@f8/core`, not in the hook file: the repo keeps
  framework-free logic in core with node-runnable unit tests, and
  the ui package has no async hook-test harness.
- Rollback restores values rather than refetching: the PATCH
  failure already surfaces via toast, and the next load/save
  reconciles any residual skew.
