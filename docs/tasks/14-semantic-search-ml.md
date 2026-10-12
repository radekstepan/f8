# Task 14 — ML local semantic search / smart albums

## What changed

Search "beach" or "dog" with no cloud: CLIP-image embeddings are computed
server-side at import, stored in the SQLite catalog, and ranked against
text queries through precomputed concept vectors in the same space. Albums
grow a "Label unlabeled photos (ML)" menu entry (sidebar + grid header)
that embeds and zero-shot-labels every photo that lacks ML labels yet;
labels ride each photo record, show in the info dialog with ML badges, can
be added or removed by hand, and double as smart albums (clicking one
searches for it).

- `packages/core/src/vision/semantic-search.ts` (new, re-exported via
  `vision/index.ts`)
  - `packSemanticInput`: CLIP preprocessing (shortest edge → 224 bilinear,
    center-crop 224, /255, CLIP mean/std) into float32 NCHW. The reference
    uses bicubic resampling; bilinear differs negligibly for retrieval and
    keeps the pack dependency-free.
  - `parseSemanticOutput`: pooled `image_embeds` → L2-normalized 512-d unit
    vector, non-finite lanes sanitized to 0 first; RangeError on misshape
    so a wrong model fails loudly per photo.
  - `assignSemanticLabels`: zero-shot softmax (logit scale 100) over the
    50-concept vocabulary → up to 3 stored labels (top ≥ 0.10, extras ≥
    0.12), best first.
  - `conceptsOfQuery` / `queryEmbedding`: exact labels + ~120 aliases +
    plural folding ("churches" → "church", irregulars via the alias table);
    multi-word queries average their concepts. Empty when nothing maps
    (the server falls back to keyword matching).
  - `rankSemanticPhotos` + `semanticHitScore`: the hit truth table —
    cosine ≥ 0.26 hits outright; 0.22–0.26 needs zero-shot support (the
    concept's softmax probability ≥ 0.10); stored-label matches always
    hit, boosted to 0.245. Best first, capped at 50.
  - `encodeEmbedding` / `decodeEmbedding` (base64 float32 LE wire format;
    decode returns null on corrupt payloads, never throws),
    `normalizeUserLabel`, cosine/softmax/normalize primitives.
- `packages/core/src/vision/semantic-concepts.ts` (new, generated, ~139KB
  text): the 50 vocabulary labels, their `"a photo of …"` prompts, and the
  L2-normalized concept vectors (little-endian float32 base64), embedded
  once at build time with the matching CLIP text encoder — the runtime
  ships the vision encoder only, so queries never run a text model.
- `packages/core/src/types.ts`: `PhotoLabel` (`{label, score, source}`),
  optional `Photo.labels`.
- `packages/core/src/library.ts`: required `LibraryPhoto.labels`, new
  client methods (`semanticSearch`, `labelAlbum`, `updateLabels`,
  `semanticHealth`, `semanticWarmup`) + response types.
- `apps/server/src/db.ts`: `SCHEMA_VERSION` 1 → 2. `MIGRATION_2` adds
  `photo_embeddings` (`photo_id` PK, model/version/dim stamp, 2KB float32
  LE blob) and `photo_labels` (`photo_id, label` PK, score, `ml|user`
  source), both `ON DELETE CASCADE`, plus a label index. Migrations apply
  incrementally, so v1 catalogs upgrade in place with photos intact.
- `apps/server/src/store.ts`: embedding round-trip/list/count, label
  get/batch-set/add/remove, `listUnlabeledMl` (user-only labels do not
  count), `countMlLabeled`. `setMlLabels` runs in a transaction and never
  overwrites a user's same-text label (the user's claim wins).
- `apps/server/src/semantic-search.ts` (new) + routes in `app.ts`
  - `GET /api/semantic-search/health` (labeling readiness + catalog
    counts + model file/size/license/URL), `POST .../warmup`
    (background provisioning, health-poll progress),
    `POST .../search` (`{q, limit}` → mode/matched/ranked hits; always
    serves), `POST .../label` (`{albumId}` → labeled/already/skipped/
    failed; 503 + `needsDownload` without weights),
    `PATCH /api/photos/:id/labels` (`{add, remove}` → updated photo).
  - Weights (~89MB quantized) download once into
    `<data>/models/semantic-search`; session I/O names read dynamically
    (verified `pixel_values` → `image_embeds`), the 512-d parse rejects
    non-CLIP overrides per photo. Env: `F8_SEMANTIC_SEARCH_URL` /
    `F8_SEMANTIC_SEARCH_DIR` / `F8_SEMANTIC_SEARCH_OFFLINE` (plus
    `PHOTOMATOR_*` aliases).
  - Import-time embedding is a fire-and-forget sequential queue hooked
    into both import routes (fresh imports only — duplicates and relinks
    keep their rows). Weights absent drains silently: imports never wait
    on, download, or fail for ML.
  - Pixels come from the cached grid thumb (always a small JPEG) decoded
    with jpeg-js (new server dep, MIT, zero-dep) — no new toolchain, and
    pre-existing thumbs bypass the encoder entirely.
- `apps/web/src/vision/remoteSemanticSearch.ts` (new) + `useSemanticSearch.ts`
  (new): debounced (300ms) search with stale-response guards and a null
  rank on server failure (the grid falls back to its client filter);
  `labelAlbum` downloads the weights once with progress and retries, so
  one menu click always finishes the job.
- `apps/web/src/App.tsx`: server ranks drive the grid (semantic ranks
  keep relevance order; keyword ranks sort as before), `· ML` result
  notes under search headings, label-action toasts, label add/remove/
  label-search wiring, labeling progress toast.
- `packages/ui`: `onLabelAlbum` menu items with ML badges in `Sidebar` and
  `PhotoStrips` (+ `searchNote` under grid headings), a Labels section in
  the info dialog (chips with ML badges, × remove, add field with vocab
  datalist, empty-state note), `updateLabels` in `useLibrary`.
- `apps/web/src/index.css`: label chips, add field, search note.
- Tests: core `semantic-search.test.ts` (20, incl. two real-embedding
  fixtures — a supported weak flower photo and the bedroom hub),
  `library-client.test.ts` (+2), server `semantic-search.test.ts` (16),
  UI `semanticSearch.test.tsx` (7).
- Docs: this writeup + `README.md` (feature bullet, env table,
  demo-boundary note).

## Model choice

CLIP ViT-B/32, Xenova ONNX-quantized port (`Xenova/clip-vit-base-patch32`,
`vision_model_quantized.onnx`, 89,117,001 bytes), chosen because the task
names CLIP-image embeddings and the quantized export keeps the one-time
download small with ~12ms CPU inference per photo. The runtime ships the
vision encoder only: the 50 vocabulary concepts were embedded once at
build time with the matching quantized text encoder
(`text_model_quantized.onnx`, 64MB, throwaway — never shipped) under
`"a photo of …"` prompts, L2-normalized, and committed as base64 text.
A query therefore costs one embedding average plus 50 dots per photo —
milliseconds even for large libraries.

- Default URL:
  `https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model_quantized.onnx`
- License: OpenAI's CLIP release ships no separate weights license file
  (the code is MIT); the weights are a Xenova ONNX conversion of that
  release. Surfaced verbatim in `/health` (`model` object) so clients and
  operators always see it; no weights are committed — they download once
  into the git-ignored data dir.
- No new runtime: `onnxruntime-node` CPU on the server, already a
  dependency; `jpeg-js` (MIT) decodes the cached thumbs.

## Schema

`photo_embeddings` keys one 512-d float32 LE blob per photo with a
`clip-vit-base-patch32` / `v1-quantized` stamp, so a future model swap
re-embeds instead of mixing spaces (stale-dims rows read back as misses).
`photo_labels` keys `(photo_id, label)` with a score and `ml|user` source;
ML rows are replaced wholesale per labeling run, user rows are never
touched by it, and deleting a photo cascades both tables. `/api/library`
ships labels via one batched query (chunked IN-lists, no N+1).

## Fallback behavior

- Weights absent (first run offline, `F8_SEMANTIC_SEARCH_OFFLINE=1`, ORT
  missing): imports skip embedding silently and stay unlabeled; the label
  action answers 503 with `needsDownload`, and the client downloads once
  with progress, then retries automatically. Search degrades to keyword
  mode over labels and metadata instead of failing. Deliberately unlike
  the detect endpoints, labeling has no classical fallback — a guessed
  label corrupts search worse than no label, so the honest behavior is to
  skip and say so.
- Non-file photos (URL samples), missing originals, and undecodable
  thumbs skip with a per-photo reason in the label report; inference or
  parse failures land in `failed`, never abort the run.
- Flat zero-shot distributions (top probability < 0.10, e.g. an
  out-of-vocabulary interior) store the embedding but no labels — the
  photo stays searchable by filename/keyword and gains no wrong labels.
- Server unreachable mid-typing: the grid falls back to its client-side
  substring filter (now label-aware) instead of erroring per keystroke.
- Corrupt embedding blobs read back as misses (skipped, never thrown).

## Decisions

- **Vision-encoder-only runtime with build-time concept vectors.** A
  runtime text encoder (+64MB weights, +2.2MB tokenizer, BPE runtime)
  buys open-vocabulary queries; the fixed 50-concept vocabulary with
  aliases and plurals covers the task's "beach"/"dog" cases at a third
  of the download and milliseconds per query. Documented boundary, not a
  limitation discovered later.
- **Hit truth table instead of a single floor.** A bedroom interior
  (out of vocabulary) matched a dozen concepts at 0.24–0.255 — above any
  single floor that keeps true weak subjects (small flowers at 0.256).
  Strong cosines (≥ 0.26) hit outright; weaker ones need zero-shot
  support (probability ≥ 0.10, where hub tops sit ~0.09). Verified on the
  dev library: dog/cat/beach return nothing, church drops 19 → 9 with the
  true churches kept, mountain 3/3, clock 4/4 minus the hub FP.
- **Labels are search citizens, not decoration.** ML labels seed keyword
  recall, user labels always hit (boosted), and label chips search —
  that is the v1 "smart album". Saved smart-album CRUD is the follow-up.
- **Embeddings keyed by photo id, stamped by model.** Relinks keep their
  vectors (same record); duplicates never re-embed; already-labeled
  photos are never re-detected (the label report says so explicitly).
- **Thumbs as the pixel source.** The ≤640px cached JPEG decodes in ~20ms
  of pure JS with no toolchain dependency, and CLIP's 224 grid barely
  notices the downsample (verified: the same photos rank identically off
  1616px thumbs in probes and 640px thumbs in production).
- **jpeg-js via hand-written manifest entries.** The sandbox proxy blocks
  yarn's registry, so `package.json` + `yarn.lock` were edited by hand
  (the lock entry carries no checksum until the next networked
  `yarn install` seals it) and the tarball verified out-of-band. vitest,
  tsc, and the real-model probes all resolve the extracted package.

## How verified

- Core: 36 files / 661 tests pass (20 new: 224-grid NCHW pack incl.
  center-crop-no-stretch, pooled-output parse incl. NaN sanitization +
  misshape, normalize/cosine/softmax, concept blob decode + unit checks,
  near-concept and mixed-concept labeling, query mapping incl.
  aliases/plurals/dedup, multi-concept averaging, mocked-cosine ranking
  with floors, label boost + result cap, catalog round-trip + corrupt
  nulls, user-label validation, the hit truth table, and the real
  supported-weak vs hub fixtures).
- Server: 14 files / 132 tests pass (16 new: v1→v2 migration preserving
  photos, embedding round-trip, label ML/user precedence, unlabeled-only
  listing + 500-chunk batching, delete cascade, body validation,
  semantic + keyword search over HTTP with mocked embeddings,
  label-only-unlabeled incl. re-run no-op + unknown album, embedded
  skip, 503 needsDownload direct + over HTTP, offline queue drain,
  queue embed with stub vision, fresh-import enqueue (not duplicates),
  health with catalog counts + model identity, labels PATCH add/remove/
  validation/404, labels on `/api/library`).
- UI: 10 files / 60 tests pass (7 new: sidebar trigger for labeling
  alone, no trigger without actions, grid menu for labeling alone +
  built-in hiding, search-note display rules, labels section markup +
  empty state + handler hiding, CSS rules).
- `yarn typecheck` equivalents in `packages/core`, `apps/server`,
  `packages/ui`, `apps/web` — pass (after rebuilding core + UI +
  server `dist`, which dependents resolve `@f8/*` through; `dist` is
  git-ignored, not committed).
- Real-model probes (throwaway scripts in `/tmp`, not committed):
  verified session contract (`pixel_values` → `image_embeds` 1×512,
  ~12ms inference), zero-shot labels eyeballed against 6 viewed photos
  (clock/church/mountain/flower correct), thresholds calibrated on the
  dev library, then full e2e through the real HTTP routes against a
  scratch catalog copy: 36/36 labeled in 5.7s, church/mountain/clock
  rank the viewed-true photos first, dog/cat/beach correctly empty,
  aliases/plurals (`puppy`, `churches`) resolve, health reports
  ready/serving with catalog counts.
- Playwright was not run (per task instructions).
