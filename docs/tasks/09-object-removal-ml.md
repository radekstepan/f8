# Task 09 — ML one-click object removal

## What changed

Detect → mask → inpaint for people removal, reusing the existing ROI→inpaint
pipeline with zero new infra. The Repair inspector gains a "One-click
removal" section (badged **ML**) with a "Remove people" button: detection
runs on the photo server, the user confirms each person (checkboxes +
confidence), and Apply turns the checked boxes into repair strokes that heal
through the current repair method.

- `packages/core/src/vision/object-detect.ts` (new, re-exported via
  `vision/index.ts`)
  - `packObjectDetectInput`: letterboxed resize to the 640 YOLO grid
    (NCHW float32, gray pad) plus the letterbox geometry for mapping
    boxes back — mirrors `packStraightenInput` conventions.
  - `parseYoloDetections` (+ `mapYoloBoxToNormalized`): YOLOv8
    [84,8400] output → normalized person boxes (class 0), score
    threshold 0.3, NMS IoU 0.45, capped at 20, score-descending.
  - `detectionsToRepairPoints`: covers each box with 50%-overlapping
    repair discs (width-relative sizing, matching
    `rasterizeRepairMask`), one stroke id per detection so each
    person's removal stays individually editable/deletable; capped at
    48 discs per detection.
  - `detectionsToRepairMask`: boxes → `RepairMask` (the detect→mask
    contract; box interior filled, rest zero).
  - `proposePersonCandidates`: classical skin-tone proposer (Kovac
    rule → coarse connected components → expanded boxes, fixed 0.5
    approximate score). Serves when ONNX weights are absent.
- `apps/server/src/object-detect.ts` (new) + routes in `app.ts`
  - `GET /api/object-detect/health` (always serving; `source` is
    `"onnx"` once YOLO weights + session are warm, else `"classic"`;
    also reports the model file/size/license/URL), `POST
    /api/object-detect/warmup` (background provisioning, health-poll
    progress like ml-heal), `POST /api/object-detect/detect`
    (downsampled RGBA → normalized person boxes).
  - YOLOv8n weights (~12MB) download once into
    `<data>/models/object-detect`; every ONNX failure falls through
    to the classical proposer, so detect never 503s for ML reasons.
    Env: `F8_OBJECT_DETECT_URL` / `F8_OBJECT_DETECT_DIR` /
    `F8_OBJECT_DETECT_OFFLINE` (plus `PHOTOMATOR_*` aliases).
- `apps/web/src/vision/remoteObjectDetect.ts` (new): warmup/health
  polling + detect transport mirroring `remoteStraighten.ts`.
- `apps/web/src/vision/useObjectRemoval.ts` (new): `detect(src)`
  decodes a ≤640px downsample, warms + runs detection, and holds
  confirm flags per detection; `apply(existing, aspect)` returns the
  checked strokes; resets on photo switch. Mirrors `useStraighten.ts`.
- `apps/web/src/App.tsx`: instantiates the hook, passes a `removal`
  view model into `repairAssist`, and applies checked detections as
  one atomic history entry (toast confirms the count + method).
- `packages/ui/src/components/Inspector.tsx`: `ObjectRemovalAssist`
  view model (optional on `RepairAssist`) + `ObjectRemovalControl`
  rendered between the reconstruction control and the stroke list:
  idle → detecting (shared `MlProgressView`) → confirm list with
  per-person checkboxes, `· ML` score tags, Apply-with-count →
  empty/error states. Classical results are labeled a scan, never ML.
- `apps/web/src/index.css`: `.ml-badge` + `.object-removal` styles;
  the rest reuses existing inspector classes.
- Tests: `object-detect.test.ts` (core, 14), `object-detect.test.ts`
  (server, 6: validation, classical fallback over HTTP, health),
  `objectRemoval.test.tsx` (UI, 5 markup cases).
- Docs: this writeup + `README.md` (feature bullet, env table,
  demo-boundary note).

## Model choice

YOLOv8n ONNX, ~12MB fp32, input 640, output [1,84,8400] (COCO, person =
class 0). Chosen over MobileSAM (~40MB + prompt plumbing) and YOLO-seg
variants (mask-proto postprocessing) because box → disc-strokes is the
minimal mask that the existing feathered-blend pipeline already heals
cleanly, and 12MB keeps the "zero new infra" promise (one lazy download
on the existing photo server).

- Default URL:
  `https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.onnx`
- License: AGPL-3.0 (Ultralytics). Surfaced in `/health` (`model`
  object) so clients and operators always see it; no weights are
  committed — they download once into the git-ignored data dir.
- No new runtime: `onnxruntime-node` CPU on the server, already a
  dependency for ml-heal.

## Fallback behavior

- Weights absent (first run offline, `F8_OBJECT_DETECT_OFFLINE=1`, ORT
  missing, corrupt output, inference throw): the classical skin-tone
  proposer serves. It finds exposed-skin figures and misses fully
  clothed ones; results carry the fixed 0.5 score and the UI calls
  them a "classical scan", shows an explanatory note, and omits the
  `· ML` tags — a fallback result is never presented as ML.
- Server unreachable: the hook reports an error with Retry; nothing is
  applied. Detection never blocks painting (unlike ML-heal warmup, it
  is a discrete button, not a gate).
- Empty result ("No people found") and all-unchecked Apply (disabled
  button) are explicit states, not silent no-ops.

## Decisions

- **Strokes, not a parallel mask path.** Detections become ordinary
  repair strokes, so grouping, undo, overlay persistence, per-person
  delete, rotation remap, and all four healing methods work unchanged.
  The direct `detectionsToRepairMask` exists only as the tested
  interchange contract.
- **Server-side, straighten-shaped.** Detection placement, health/
  warmup/progress polling, and hook structure copy the straighten-ML
  fallback (the closest analog: small model, classical fallback,
  discrete assist UI) rather than inventing a new pattern.
- **People only in v1.** The API validates `labels` and rejects
  non-person classes with 400, so "remove power lines" can extend the
  label set later without a contract break. Power-line removal needs a
  line proposer/segmenter, not a box detector, so it is a follow-up.
- **Source framing.** Detection runs on `photo.src` (what
  `decodeDownsampled` sees), while strokes live in final-canvas
  coordinates: boxes align on unrotated/uncropped photos and do not
  remap through rotation/crop yet. Documented in the hook header and
  the README boundary note; remapping via the existing
  rotate/crop geometry helpers is the follow-up.
- **Confirm-before-apply.** Detections are never applied silently:
  the list defaults to all-checked but requires an explicit Apply
  click, and each applied person is its own stroke group (separate
  "Repair N" row) for later editing.

## How verified

- Core: 31 files / 547 tests pass (14 new: letterbox pack, box
  mapping, YOLO parse + NMS + thresholding + caps, stroke coverage of
  sampled box grids, detect→mask contract, mocked-detector wiring
  through `rasterizeRepairMask` into `planMlHealRoi`, classical
  proposer find/skip/empty).
- Server: 10 files / 95 tests pass (6 new: body validation incl.
  label rejection, health without weights naming the model, classical
  figure detection direct + over HTTP, empty result, HTTP 400).
- UI: 4 files / 23 tests pass (5 new: absent without assist, idle ML
  badge + button, ML list with count apply, classical labeling,
  error retry).
- `yarn typecheck` in `packages/core`, `apps/server`,
  `packages/ui`, `apps/web` — pass (after rebuilding core + UI
  `dist`, which server/UI/web resolve `@f8/*` through; `dist` is
  git-ignored, not committed).
- Playwright was not run (per task instructions).
- ONNX-path note: the YOLO inference branch runs only with weights +
  `onnxruntime-node` present; this environment served the classical
  fallback in every test (health `source: "classic"`), so the ONNX
  branch is verified by construction (same session pattern as the
  straighten/ml-heal paths) plus the pure parse/pack unit tests —
  first online warmup will exercise it end to end.
