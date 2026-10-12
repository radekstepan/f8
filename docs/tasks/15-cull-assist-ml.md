# Task 15 — ML import-time cull assist

## What changed

Find the blurry photos, near-duplicate bursts, and keepers in an import:
classical Laplacian blur detection, DCT perceptual-hash grouping, and a tiny
logistic keeper scorer run server-side over the cached grid thumbs, cache one
assessment row per content hash in the SQLite catalog, and flag photos with
`blurry` / `duplicate` / `keeper` labels (source `ml`). Albums grow a "Find
blurry photos" menu entry with an ML badge (sidebar + grid header); flagged
photos carry icon pills on the grid, a Cull status filter narrows to blurry
or keepers, and every flag can be added or removed by hand in the info
dialog. A file is never re-detected: cached metrics are keyed by content
hash, and each photo is labeled at most once.

- `packages/core/src/vision/cull-assist.ts` (new, re-exported via
  `vision/index.ts`)
  - `laplacianVariance` / `blurScore` / `isBlurryScore`: 4-neighborhood
    Laplacian variance over Rec.709 luma; under `CULL_BLUR_THRESHOLD` (90)
    is blurry. `blurConfidence` fades the flag's score toward the boundary.
  - `perceptualHash` (`perceptualHashFromGray`): 64-bit DCT hash — bilinear
    32×32 luma, top-left 8×8 DCT-II low block (orthonormal scale skipped, it
    cancels in the median compare), one bit per coefficient above the AC
    median. `phashToHex` / `parsePhashHex` (RangeError on malformed input),
    `hammingDistance` (RangeError outside 64 bits).
  - `groupNearDuplicates`: union-find at `CULL_DUPLICATE_HAMMING` (8), so
    grouping is transitive; 2+ member groups only, sorted deterministically.
  - `aestheticFeatures` / `aestheticScore`: tiny logistic scorer
    (sigmoid over sharpness/exposure/contrast, inspected coefficients, no
    weights file) → 0..1 keeper score; `CULL_KEEPER_THRESHOLD` (0.6).
  - `pickGroupBest` (aesthetic, then sharpness, then id),
    `assignCullLabels` (the flag truth table — blurry under threshold,
    non-best group members duplicate, sharp unique pretty photos keeper),
    `assessPixels` (one-photo blur + hash + score).
- `packages/core/src/library.ts`: `CullAlbumReport` / `CullGroup` types +
  `cullAlbum` client method (`POST /api/cull-assist/cull`).
- `apps/server/src/db.ts`: `SCHEMA_VERSION` 2 → 3. `MIGRATION_3` adds
  `photo_cull` (hash PK, blur, blurry, phash hex, aesthetic, algorithm
  version stamp) and `photo_cull_labels` (photo_id PK, `ON DELETE CASCADE`
  marker for "cull-labeled"). Migrations apply incrementally, so v1/v2
  catalogs upgrade in place with photos intact.
- `apps/server/src/store.ts`: cull round-trip/list/count, the
  labeled-marker get/list/mark, and scoped `setMlLabels`
  (`{ only: [...] }` restricts the ML delete to one feature's vocabulary;
  unscoped still replaces every ML label, and user labels always win
  conflicts).
- `apps/server/src/semantic-search.ts`: both `setMlLabels` calls now pass
  `{ only: SEMANTIC_CONCEPT_VOCAB }`, so semantic passes preserve cull
  flags (and vice versa). Behavior unchanged otherwise.
- `apps/server/src/cull-assist.ts` (new) + route in `app.ts`
  - `POST /api/cull-assist/cull` (`{albumId}` → assessed/alreadyAssessed/
    labeled/alreadyLabeled/blurry/keepers/groups/skipped/failed; 404 on
    unknown album).
  - `assessPhoto`: cache-hit by hash short-circuits before pixels are read
    (stale versions re-assess); pixels come from the cached grid thumb via
    the shared `pixelsForPhoto` (same source as semantic search).
  - `cullAlbum`: assesses uncached hashes, then plans flags album-wide from
    the cache and writes them only for newly labeled photos.
  - `createCullQueue`: import-time fire-and-forget sequential queue hooked
    into both import routes (fresh imports only — duplicates and relinks
    enqueue nothing). No weights, so it always attempts; per-photo
    failures never stall the queue.
- `apps/server/src/fixtures.ts`: `cullEnqueue` injection (void by default,
  like `semanticEnqueue`).
- `apps/web/src/vision/remoteCullAssist.ts` (new) + `useCullAssist.ts`
  (new): single-request cull with a busy flag — no warmup polling, since
  the pass is classical.
- `apps/web/src/App.tsx`: `cullAlbumPhotos` menu callback (report toast
  with blurry/duplicate/keeper counts, library reload), `CullFilter`
  state (`all`/`blurry`/`keepers`, wired into the collection/filter
  interplay and scroll keys), culling progress toast.
- `packages/ui`: `onCullAlbum` menu items with ML badges in `Sidebar` and
  `PhotoStrips`, a Cull status chip group, `Blurry · ML` / `Duplicate ·
  ML` / `Keeper · ML` pills on flagged grid thumbs, cull flags appended
  to the info-dialog label datalist (hand add/remove reuses the existing
  label PATCH plumbing, including the ML badge on ML flags).
- `apps/web/src/index.css`: badge stack + per-flag pills.
- Tests: core `cull-assist.test.ts` (22) + `library-client.test.ts` (+1),
  server `cull-assist.test.ts` (13), UI `cullAssist.test.tsx` (6).
- Docs: this writeup + `README.md` (feature bullet, demo-boundary note).

## Thresholds

Calibrated on the 38 dev-library thumbs at production scale (640px wide —
  the legacy 1616px dev thumbs score lower per pixel, so calibration
  downsamples first):

- Blur 90: the two haziest frames (eyeballed: soft atmospheric haze) score
  85–86; the next-softest sharp frame (smooth-surface jug, tack-sharp
  where it matters) scores 172; box-blurred sharp frames score 10–35.
  True softness lands well under, sharp content 2x above.
- Hamming 8: same-frame variants land at 0 (exposure ±25), 0–2 (slight
  blur), 4–8 (6–10px shifts); the closest unrelated pair of 703 sits at
  18, and same-viewpoint hazy mountains at 26–44. Catches realistic burst
  differences with a 2x margin; 8%-reframed crops (6–14) mostly stay
  ungrouped — reframed shots are not near-dupes.
- Keeper 0.6: sharp dev photos score 0.67–0.91, the hazy pair 0.59–0.62
  (excluded as blurry regardless). Keeper ≈ technically sound: sharp,
  decently exposed, some contrast.

## Schema

`photo_cull` keys one assessment per content hash with a `v1-classical`
stamp, so an algorithm bump re-assesses instead of mixing scores — within
a version a file is never re-detected, even across delete + reimport
(reimports relabel from the cache without recomputing).
`photo_cull_labels` marks per-photo "flags assigned" (zero or more), so a
hand-removed flag is never re-added by a later pass while a fresh photo
row still gets its flags. Flags live in the shared `photo_labels` table
(source `ml`), written with vocabulary-scoped deletes; deleting a photo
cascades its labels and marker, while its hash assessment stays cached
for a future reimport.

## Fallback behavior

- Non-file photos (URL samples), missing originals, and undecodable
  thumbs skip with a per-photo reason; skips cache nothing, so a later
  pass retries honestly. Inference failures land in `failed`, never abort
  the run.
- Flat zero-flag photos (sharp but unremarkable solo frames) still get
  assessed + marked — processed, nothing to flag.
- Already-assessed / already-labeled photos are never recomputed or
  relabeled, so manual flag edits persist across runs.
- Import-queue flags use the album-so-far as group context (best-effort
  duplicates mid-bulk-import); the menu pass labels anything the queue
  had not seen yet. Blurry and keeper flags never depend on grouping.

## Decisions

- **Classical first, tiny scorer second.** The task names Laplacian-first
  blur and pHash grouping; both stay classical by design (documented
  boundary, like the scene classifier's inspected coefficients). The
  keeper scorer is a 3-feature logistic with inspected weights — an
  honest v1 the UI still badges ML, per the feature family.
- **Metrics by hash, labels by photo.** Keying assessments by content
  hash (not photo id) is what makes "never re-detect" survive delete +
  reimport; the per-photo marker is what keeps hand-removals permanent.
  Either key alone breaks one guarantee.
- **Label-once, from whole-album context.** Flags are assigned exactly
  once per photo but planned over every assessed album mate, so grouping
  sees previously labeled photos while already-labeled photos stay
  untouched (a queue/menu race may label from partial context — same
  values, benign).
- **One menu action, full pass.** "Find blurry photos" runs blur +
  grouping + keepers together: grouping needs album-wide hashes anyway,
  and three separate passes would triple-scan the album.
- **Scoped ML label writes.** Two ML features share `photo_labels`; each
  now deletes only its own vocabulary (`blurry`/`duplicate`/`keeper` vs
  the 50 semantic concepts — disjoint), with user labels winning every
  conflict as before.
- **Keeper ≈ technically sound, not best-of-shoot.** With a decent
  library most sharp photos keep; the filter's value is what it removes
  (blurry + duplicates), and group bests still rank by score.

## How verified

- Core: 37 files / 684 tests pass (22 new: Laplacian ordering incl.
  blurred-under-sharp, threshold boundary, degenerate sizes, confidence
  fade, luma stats, feature normalization, scorer ranking, hash
  round-trip + malformed rejection, hamming truth table, shifted-closer-
  than-unrelated on real-scale content, transitive grouping, best-pick
  tie-breaks, the six flag-planning cases, full-assessment smoke).
- Server: 15 files / 145 tests pass (13 new: v2→v3 migration preserving
  photos, cull round-trip, marker tracking, scoped per-feature writes +
  user precedence, assess-once/never-redetect incl. stale-version
  re-assess, skip taxonomy, real-thumb assessment, album e2e with
  rerun + hand-removal persistence, reimport-from-cache, body/album
  validation, HTTP incl. 400/404, import enqueue incl. duplicate
  exclusion, queue drain). The v1→v2 migration test now tracks latest (v3).
- UI: 11 files / 66 tests pass (6 new: sidebar/grid cull triggers +
  built-in hiding, cull chips incl. active state + hiding, grid badges
  incl. clean-photo absence, datalist flags, badge CSS).
- `yarn typecheck` in `packages/core`, `apps/server`, `packages/ui`,
  `apps/web` — pass (after rebuilding core + UI `dist`, which
  dependents resolve `@f8/*` through; `dist` is git-ignored).
- Throwaway probes in `/tmp` (not committed): threshold calibration over
  38 dev thumbs at 640px (blur/aesthetic distributions, 703-pair hamming
  floor, synthetic exposure/shift/blur/crop variants), four eyeballed
  soft frames, then full e2e through `cullAlbum` against a scratch
  dev-catalog copy: 36/36 Test-album photos assessed in 4.1s, the exact
  3 haziest probe frames flagged blurry, 31 keepers, 0 duplicate groups
  (correct — all distinct scenes), URL seeds skipped with reasons, rerun
  assessed/labeled nothing, v1 scratch catalog migrated straight to v3.
- Playwright was not run (per task instructions).
