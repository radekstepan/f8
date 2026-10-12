# Task 04 — Local ML ideas for Photomator

Ideas-only survey: what existing ML does today, and what else small local
models could do automatically. No product code changed.

## Existing ML / vision (inspected)

- `apps/server/src/ml-heal.ts` — all neural repair runs server-side via
  `onnxruntime-node` on CPU: LaMa single-pass fill (Balanced, ~208MB
  weights, auto-downloaded) and Moebius diffusion (Best, ~1.3GB, ~45s/area
  on M1 Pro). Client POSTs a square ROI crop, gets 512x512 output.
- `apps/server/src/straighten-ml.ts` — straighten fallback: Sobel gradient
  vote today (no weights), ONNX tilt-regressor-ready
  (`straighten_regressor.onnx`, 224px grid, ImageNet norm in
  `packages/core/src/vision/straighten-ml.ts`).
- `apps/web/src/workers/vision.worker.ts` + `packages/core/src/vision/` —
  lazy OpenCV worker (Canny/Hough straighten, Telea/NS inpaint), pure-TS
  pre/post-processing shared with Node tests (`ml-heal.ts` ROI
  plan/pack/composite), typed worker protocol in `worker-protocol.ts`.
- `packages/core/src/vision/enhance.ts` — auto-enhance is classical
  (histograms, gray-world WB); no learned model.
- Tools are adjust / crop / repair (`packages/core/src/types.ts`); photos
  never leave the device; CoreML measured ~2x slower than CPU for Moebius,
  so server CPU is the default engine.

Constraints this implies: server CPU budget is seconds-to-a-minute per
photo (fine for on-demand, not for bulk import); browser WebGPU/WASM suits
small (<50MB) models; every model must be ONNX-exportable, cached once,
and degrade gracefully offline.

## Ideas (ranked by fit)

1. **One-click object removal.** Biggest unlock with zero new infra: add a
   small detector/segmenter (e.g. YOLO-NAS-class or MobileSAM ONNX,
   tens of MB) whose mask feeds the existing LaMa/Moebius ROI pipeline.
   "Remove people / power lines" becomes detect → mask → inpaint.
2. **Auto dust/spot detection for repair.** Classical blob candidates plus
   a tiny false-positive classifier; surface as suggested repair masks the
   user accepts per spot. Reuses the whole heal stack.
3. **Subject-aware auto-enhance.** A tiny scene classifier (portrait /
   landscape / night / document) picks per-scene enhance parameters
   instead of one fixed patch — portrait protects skin tones, landscape
   allows stronger contrast. Runs on the existing 160px analysis image.
4. **Face-aware exposure / white balance.** Face detection (small ONNX,
   e.g. YuNet/SCRFD-tiny) anchors WB on skin tones and lifts underexposed
   faces; also enables **auto red-eye removal** (face + eye landmarks).
5. **Composition / auto-crop suggestions.** Saliency + rule-of-thirds
   scoring proposes 1–3 crops in the Crop view; user accepts, never
   auto-applies (same UX contract as straighten Auto). Saliency can start
   classical, upgrade to a small learned model.
6. **Selective (masked) adjustments.** Person/background segmentation
   (BiRefNet-lite / MODNet-class, server-side) enables "brighten subject
   only" — the most-requested-adjustment-shaped gap once global enhance
   exists. Mask plugs into the existing mask-composite pattern.
7. **Local semantic search / smart albums.** CLIP-image embeddings computed
   server-side at import, stored in the SQLite catalog: search "beach" or
   "dog" with no cloud. Privacy story stays intact; cost is import-time,
   amortized, and skippable offline.
8. **Import-time cull assist.** Blur detection (classical Laplacian first),
   near-duplicate grouping (perceptual hash), and optionally a tiny
   aesthetic scorer flag the keepers when importing hundreds of photos.
   Directly serves the import-progress pain in tasks 08/09.
9. **Lightweight denoise for high-ISO shots.** A small learned denoiser
   (e.g. NAFNet-tiny ONNX) behind a new adjust slider or an auto toggle
   keyed on EXIF ISO. Server-side; preview on downsample first.
10. **Export-time super-resolution.** Real-ESRGAN-tiny ONNX as an export
    option ("Export 2x"). Slow on CPU but export is already
    wait-tolerant, unlike interactive editing.
11. **Straighten regressor weights.** Already scaffolded (idea #0): publish
    or train the 224px tilt regressor so soft horizons work where Hough
    finds no lines.

Deliberately excluded: cloud APIs (breaks the local-first promise),
generative fill that invents people/faces (taste + liability), anything
needing a GPU server (we ship CPU-only).

## Suggested first three

Object removal (#1), spot detection (#2), scene-aware enhance (#3): all
reuse the ROI/ORT/worker machinery, all degrade to existing classical
behavior, and each is independently shippable behind the current
download-progress UI.

## Report

- What: inspected the files above, wrote this ideas-only doc. No product,
  test, or config changes (nothing trivial worth changing).
- Files changed: `docs/tasks/04-local-ml-ideas.md` (new, this file).
- Tests: none added — ideas-only per task instructions; no logic changed.
- Verification: no code touched, so no test suite or typecheck applies;
  verified by re-reading cited implementation bodies (not grep-only).
- How to verify: read this file; cross-check claims against the cited
  sources.
- Unresolved: model licenses/sizes need per-idea validation at
  implementation time (ONNX export availability, weight size, CPU latency);
  no benchmarks were run for this survey.
