# Task 10 — ML auto dust/spot detection for repair

## What changed

Detect → mask → inpaint for dust spots, reusing the existing ROI→inpaint
pipeline with zero new infra. The Repair inspector gains an "Auto dust
spots" section (badged **ML**) with a "Find dust spots" button: the photo
server proposes classical blob candidates, filters them through a tiny
ML false-positive classifier, and the user accepts each spot (checkboxes
+ confidence) before Apply turns the checked spots into repair strokes
that heal through the current repair method.

- `packages/core/src/vision/dust-spots.ts` (new, re-exported via
  `vision/index.ts`)
  - `proposeDustCandidates`: classical luminance-contrast blob proposer
    (box-blur background via integral image → dark/bright seeds →
    connected components gated on area, bbox aspect, fill ratio, plus
    ring-contrast verification that rejects halos the background window
    pulls around strong spots). Returns candidates with per-candidate
    features and the fixed 0.5 approximate score.
  - `scoreSpotFeatures` / `filterSpotsWithClassifier`: the tiny ML
    stage — a logistic regression over four features (contrast, size,
    circularity, border proximity) that drops likely false positives
    and attaches classifier probabilities, score-descending, capped at
    60.
  - `spotsToRepairPoints`: one repair disc per spot (fitted radius ×
    1.6 margin to cover soft fringes), one stroke id per spot so each
    repair stays individually editable/deletable.
  - `spotsToRepairMask`: spots → `RepairMask` (the detect→mask
    contract; disc interiors filled, rest zero).
  - `parseDustSpotsWeights`: validates external classifier-coefficient
    JSON for the `F8_DUST_SPOTS_WEIGHTS` override.
- `apps/server/src/dust-spots.ts` (new) + routes in `app.ts`
  - `GET /api/dust-spots/health` (always serving; `source` is `"ml"`
    when the classifier filters, else `"classic"`; also reports the
    classifier model/version/weights-kind/license and any weights
    error), `POST /api/dust-spots/warmup` (answers health immediately
    — no weights to provision — kept for client symmetry), `POST
    /api/dust-spots/detect` (downsampled RGBA → scored spots).
  - ML by default via the embedded coefficients; `F8_DUST_SPOTS_OFFLINE=1`
    or an unreadable custom-weights file serves classical-only
    candidates, so detect never 503s for ML reasons. Env:
    `F8_DUST_SPOTS_WEIGHTS` / `F8_DUST_SPOTS_OFFLINE` (plus
    `PHOTOMATOR_*` aliases).
- `apps/web/src/vision/remoteDustSpots.ts` (new): warmup/health
  polling + detect transport mirroring `remoteObjectDetect.ts`.
- `apps/web/src/vision/useDustSpots.ts` (new): `detect(src)`
  decodes a ≤1280px downsample, warms + runs detection, and holds
  accept flags per spot; `apply(existing)` returns the checked
  strokes; resets on photo switch. Mirrors `useObjectRemoval.ts`.
- `apps/web/src/App.tsx`: instantiates the hook, passes a `dustSpots`
  view model into `repairAssist`, and applies checked spots as one
  atomic history entry (toast confirms the count + method).
- `packages/ui/src/components/Inspector.tsx`: `DustSpotsAssist`
  view model (optional on `RepairAssist`) + `DustSpotsControl`
  rendered after the removal control: idle → detecting (shared
  `MlProgressView`) → accept list with per-spot checkboxes, `· ML`
  score tags, Repair-with-count → empty/error states. Classical
  results are labeled a scan, never ML.
- `apps/web/src/index.css`: the control reuses `.object-removal`
  styles; `.dust-spots .retouch-group-list` gets a taller scroll
  window (60 spots vs 20 people).
- Tests: `dust-spots.test.ts` (core, 15), `dust-spots.test.ts`
  (server, 9: validation, ML detect direct + over HTTP, clean photo,
  offline classical, unreadable-weights fallback, custom weights,
  HTTP 400), `dustSpots.test.tsx` (UI, 5 markup cases).
- Docs: this writeup + `README.md` (feature bullet, env table,
  demo-boundary note).

## Model choice

Logistic regression over four handcrafted blob features (`dust-logreg
v1`), not an ONNX network: dust-vs-speckle separates well on contrast,
size, compactness, and border proximity, and five floats need no
runtime, no download, and no new dependency. The coefficients are set
by inspection against the synthetic fixtures and ship embedded in
`@f8/core` — there is no weight URL and no separate weight license
(they are source, under the repo's own terms; health says exactly
that). Fitted replacements load via `F8_DUST_SPOTS_WEIGHTS`
(`{bias, contrast, size, circularity, border}` JSON); a proper training
pass over labeled spot/non-spot patches is the follow-up.

- Default weights: embedded `DUST_SPOTS_CLASSIFIER_WEIGHTS` (no
  download, no binaries committed).
- License: none separate — part of the source tree.
- No new runtime: pure TypeScript on the server, no OpenCV binding.

## Fallback behavior

- ML filter disabled (`F8_DUST_SPOTS_OFFLINE=1`) or custom weights
  configured-but-unreadable: the classical proposer serves directly
  with the fixed 0.5 score. The UI calls the result a "classical
  scan", shows an explanatory note, and omits the `· ML` tags — a
  fallback result is never presented as ML. The weights error stays
  visible in `/health` (`error` field).
- Server unreachable: the hook reports an error with Retry; nothing is
  applied. Detection never blocks painting (a discrete button, not a
  gate).
- Empty result ("No dust spots found") and all-unchecked Apply
  (disabled button) are explicit states, not silent no-ops.

## Decisions

- **Pure-TS proposer, not OpenCV SimpleBlobDetector.** The task
  suggested OpenCV in the worker or server, but the server has no
  OpenCV binding (only the browser worker does, via opencv.js) and
  routing detection through the worker would invent a new protocol
  plus a second placement for neural-adjacent code. A dependency-free
  luminance-contrast proposer keeps the task-09 server pattern
  (routes + health + hook + assist UI, all unit-testable in Node)
  and matches dust's actual signature (small, compact, high-contrast
  blobs) without blob-detector tuning.
- **Classifier-shaped ML, honestly labeled.** The "tiny false-positive
  classifier" is a real logistic-regression stage with a real
  filtering contract (tested: keeps strong spots, drops speckle,
  honors custom weights), but its v1 coefficients are inspected, not
  fitted — this writeup and the code header say so. The UI's ML
  badge means "the classifier filtered this list", and classical-only
  lists never carry it.
- **Strokes, not a parallel mask path.** Accepted spots become
  ordinary one-disc repair strokes, so grouping, undo, overlay
  persistence, per-spot delete, rotation remap, and all four healing
  methods work unchanged. The direct `spotsToRepairMask` exists only
  as the tested interchange contract.
- **1280px working width.** Dust spots are small enough that the 640px
  object-detect downsample would erase them; 1280 preserves ~2px+
  specks while keeping the local POST small (~6MB base64 worst case).
  Sub-pixel full-res specks remain out of reach (README boundary).
- **Source framing.** Like one-click removal, detection runs on
  `photo.src` while strokes live in final-canvas coordinates: spots
  align on unrotated/uncropped photos and do not remap through
  rotation/crop yet. Documented in the hook header and the README
  boundary note.
- **Confirm-before-apply.** Spots are never applied silently: the list
  defaults to all-checked but requires an explicit Repair click, and
  each applied spot is its own stroke group (separate "Repair N" row)
  for later editing.

## How verified

- Core: 32 files / 562 tests pass (15 new: dark/bright blob finding,
  large-region + scratch rejection, classifier scoring/filtering,
  custom weights, weights validation, per-spot stroke ids, heal-stack
  wiring through `rasterizeRepairMask` into `planMlHealRoi`,
  detect→mask contract).
- Server: 11 files / 104 tests pass (9 new: body validation, health
  naming the embedded classifier, ML spot direct + over HTTP, clean
  photo, offline classical, unreadable-weights fallback, custom
  weights, HTTP 400).
- UI: 5 files / 28 tests pass (5 new: absent without assist, idle ML
  badge + button, ML list with count apply, classical labeling,
  error retry).
- `yarn typecheck` in `packages/core`, `apps/server`,
  `packages/ui`, `apps/web` — pass (after rebuilding core + UI
  `dist`, which server/UI/web resolve `@f8/*` through; `dist` is
  git-ignored, not committed).
- Playwright was not run (per task instructions).
