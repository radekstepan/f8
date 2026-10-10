# Auto Enhance, Repair & Auto-Align: Implementation Plan

## Goal

Replace the three illustrative/manual photo features with real image analysis, browser-first, in dependency order: (1) true auto-enhance from pixel histograms, (2) EXIF-correct import orientation, (3) worker + WASM build foundation, (4) auto-straighten via line detection, (5) Telea/NS inpainting for repair. Each phase below is a self-contained copy-paste prompt for a future agent session.

## Success Criteria

- Auto Enhance derives per-photo adjustments from actual pixel data (no fixed preset) and stays undoable via the existing history hook.
- Imported phone photos never appear sideways; orientation is corrected at decode.
- Straighten offers a detected angle the user accepts or rejects; detection runs off the main thread.
- Repair fills masked regions with neighbourhood reconstruction (OpenCV inpaint), not blur, with blur kept as fallback.
- Every new algorithm ships with unit tests on synthetic fixtures plus golden-image regression tests; `yarn typecheck`, `yarn build`, and the test suite all pass.

## Approach

Keep the existing architecture: framework-free analysis code in `packages/core` (pure, testable), React wiring in `packages/ui` and `apps/web`. Add a `packages/core/src/vision/` module for analysis functions that take `ImageData`-like input and return plain data (never DOM nodes), so they run identically in Node tests, workers, and the main thread. Introduce Vitest for tests and a Vite worker for OpenCV WASM, loaded lazily only when a heavy feature is used. Classical computer vision first; learned models only behind the Phase 6 decision gate.

## Steps

### Phase 0 prompt — test runner + vision scaffold (do first)

> In the photomator repo, set up Vitest as the test runner and scaffold the vision module. 1) Add a `vitest` devDependency and a `test` script to each workspace package that will hold tests (`packages/core` at minimum), plus a `test` task in `turbo.json` with `dependsOn: ["^build"]`. Follow the official Vitest guide for config. 2) Create `packages/core/src/vision/` with `analyze.ts` (pure helpers operating on `{ width, height, data: Uint8ClampedArray }`, no DOM access), `index.ts` re-exports, and update `packages/core/src/index.ts`. 3) Add `packages/core/src/vision/fixtures.ts` generating small synthetic images in code (solid color, horizontal/vertical gradients, half-black-half-white, single bright line at a known angle) and write `analyze.test.ts` proving the fixtures behave as documented. 4) Verify: `yarn test` (or per-package `vitest run`), `yarn typecheck`, `yarn build` all pass. Do not change any UI or image-pipeline behavior in this phase.

### Phase 1 prompt — real auto-enhance from histograms

> In the photomator repo, implement true histogram-based auto-enhance. Context: `useEditor.autoEnhance` in `packages/ui/src/hooks/useEditor.ts` currently applies a fixed preset (`INITIAL_EDIT` + exposure 0.22, clarity 12); `PhotoCanvas` in `packages/ui/src/components/PhotoCanvas.tsx` already downsamples to 160x100 for histograms. 1) In `packages/core/src/vision/`, add pure functions: per-channel histograms, percentile-based black/white points, exposure shift estimate, and gray-world white-balance gains; map these to a `Partial<EditState>` patch (exposure, contrast, temperature, tint, saturation only — never geometry/retouch fields). 2) Add unit tests on synthetic fixtures (dark image gains positive exposure; strong color cast gains opposing temperature/tint; mid-gray image stays near-neutral) plus one golden test on a checked-in fixture photo asserting the patch is within tolerance of recorded values. 3) Wire `autoEnhance` to analyze the current photo's downsampled pixels and apply the computed patch, preserving the existing toggle-off snapshot behavior and geometry fields. 4) Verify: new tests pass, `yarn typecheck`, `yarn build`, and manual check that Enhance on photo-1 differs from Enhance on an imported dark photo.

### Phase 2 prompt — EXIF-correct import orientation

> In the photomator repo, fix import orientation using the browser's own decoder. Context: `importFiles` in `apps/web/src/App.tsx` creates object URLs and `loadImage` in `packages/core/src/image.ts` decodes via `new Image()`, ignoring EXIF orientation. 1) In the import path, decode with `createImageBitmap(file, { imageOrientation: "from-image" })` (documented on MDN) so pixels arrive pre-rotated, and record dimensions from the decoded bitmap. 2) Ensure the rest of the pipeline (`geometryCanvas`, export) treats imported bitmaps as orientation-1 (no double rotation). 3) Add tests for the orientation-mapping helper (each EXIF orientation 1-8 maps to the correct rotation/flip, even though the browser now handles it — the helper documents intent and guards regressions). 4) Verify: `yarn typecheck`, `yarn build`, tests pass, and a portrait phone photo imports upright.

### Phase 3 prompt — worker + build foundation for OpenCV WASM

> In the photomator repo, add the off-main-thread foundation for heavy vision work. Context: `apps/web/vite.config.ts` uses `vite-plugin-singlefile`, which inlines JS/CSS into `dist/index.html` and therefore cannot carry lazily-loaded WASM/worker chunks unchanged. 1) Create a Vite module worker (`new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })` pattern from the Vite features guide) behind a small promise-based client in `packages/ui` or `apps/web`, with typed request/response messages and a loading/error state for the UI. 2) Add `@techstark/opencv-js` (npm package with TypeScript support) as a lazy dependency loaded only inside the worker on first use; expose worker readiness (downloading / ready / failed) to the UI with graceful fallback when WASM fails to load. 3) Rework the single-file build minimally: keep inlining for the main bundle but exclude/emit the worker + WASM as separate assets, or drop single-file if exclusion proves fragile — document the choice in the README build section. 4) Ship one trivial worker round-trip (e.g. worker returns the OpenCV version and grayscales a 4x4 fixture) with tests for the message protocol. 5) Verify: `yarn build` output still runs via `vite preview`, worker initializes in the browser, `yarn typecheck`, tests pass.

### Phase 4 prompt — auto-straighten via Hough line detection

> In the photomator repo, implement horizon/straighten detection. Context: `straighten` (-15..15 deg) in `EditState` is manual-only; `geometryCanvas` already compensates zoom for straightening. 1) In the worker, implement: downscale to ~512px wide, grayscale, blur, Canny, then `HoughLinesP`, and vote for the dominant near-horizontal angle in [-15, 15] degrees weighted by segment length; return `{ angle, confidence }`. Pure vote/weight logic must live in `packages/core/src/vision/` and be unit-tested on synthetic line fixtures (exact known angles, plus a no-lines fixture yielding low confidence). 2) Add UI: an "Auto" button next to the Straighten slider in the crop inspector that runs detection, shows the suggested angle with confidence, and applies it via the existing `onChange({ straighten })` history path on user accept (never auto-apply silently). 3) Tune defaults (Canny thresholds, Hough threshold/minLineLength/maxLineGap) against 3-5 sample photos and record them as constants with a comment explaining the tradeoff. 4) Verify: unit tests pass, `yarn typecheck`, `yarn build`, manual check on a tilted horizon photo and a photo with no clear lines (should report low confidence, not a wild angle).

### Phase 5 prompt — OpenCV inpainting for repair

> In the photomator repo, upgrade repair from blur to real inpainting. Context: `geometryCanvas` in `packages/core/src/image.ts` handles `retouches` by blurring (repair) or pixel-copying (clone); `PhotoCanvas` collects `RetouchPoint` strokes. 1) Build a mask rasterizer in `packages/core/src/vision/`: convert `RetouchPoint[]` (normalized coords, repair kind only) into an 8-bit single-channel mask at working resolution; unit-test that points land on expected mask pixels including brush-size scaling and clamping. 2) In the worker, run `cv.inpaint` with `INPAINT_TELEA` (default) and `INPAINT_NS` (option), radius tied to brush size; apply at export/preview resolution and composite the result back through the existing pipeline. Keep the current blur repair as automatic fallback if the worker/WASM is unavailable, and leave clone-stamp behavior untouched. 3) Add golden tests: a small fixture with a synthetic blemish produces inpainted output within tolerance of the recorded result. 4) Verify: tests pass, `yarn typecheck`, `yarn build`, manual check that repair on a real photo looks materially better than blur and that export matches preview.

### Phase 6 prompt — (optional, gated) learned-model escalation

> Only start after Phases 0-5 are done and classical quality has been judged insufficient on real photos. In the photomator repo, spike ONE learned-model path behind a feature flag: either (a) in-browser inference with ONNX Runtime Web (`onnxruntime-web`, WASM execution provider everywhere, WebGPU execution provider where the browser supports it — verify the current support matrix in the ONNX Runtime Web docs during the spike), or (b) a local sidecar service on the Linux/RTX 5090 box exposing one HTTP endpoint (send image + mask, receive inpainted image) with the web app treating it as an optional remote worker. Do not commit to a model until the spike measures quality, latency, and bundle/deploy cost on 5 representative photos. Deliverable is a short decision note plus the spike; productization is a separate plan.

## Validation Plan

- Per phase: `yarn test` (new + existing tests), `yarn typecheck`, `yarn build`, then `yarn workspace @photomator/web preview` smoke test of the touched surface.
- Highest-risk check: Phase 3's production build with worker + WASM chunks loading correctly under `vite preview` (dev-server success does not prove this).
- Golden-image tests must use fixtures committed to the repo (no network); existing remote Pexels samples must never be test inputs.
- Manual acceptance per phase is stated in each prompt; do not mark a phase done without its manual check.

## Risks / Open Questions

- Remote sample photos load with `crossOrigin="anonymous"` (`loadImage`); if a CDN omits CORS headers the canvas is tainted and pixel analysis throws — analysis code must catch this and surface "analysis unavailable" instead of breaking the editor.
- OpenCV WASM is a multi-megabyte lazy download; keep it out of the initial bundle (Phase 3) and show download progress. Exact size to be verified at integration time.
- Single-file build versus separate worker/WASM assets is a real tradeoff: dropping single-file simplifies everything later. Recommendation is to drop it in Phase 3 if exclusion config proves fragile.
- ONNX WebGPU browser support is narrower than WASM; keep WASM as the universal fallback and verify the current matrix in the ONNX docs during Phase 6 rather than trusting this plan's memory.
- Open questions: none that block Phase 0. Model choice (Phase 6) is deliberately deferred.

## Sources

- https://vitest.dev/guide/
- https://vite.dev/guide/features.html
- https://docs.opencv.org/4.13.0/df/d3d/tutorial_py_inpainting.html
- https://docs.opencv.org/4.13.0/d6/d10/tutorial_py_houghlines.html
- https://docs.opencv.org/4.13.0/da/d22/tutorial_py_canny.html
- https://docs.opencv.org/4.13.0/d5/d10/tutorial_js_root.html
- https://raw.githubusercontent.com/opencv/opencv/4.x/modules/photo/include/opencv2/photo.hpp
- https://github.com/techstark/opencv-js
- https://github.com/richardtallent/vite-plugin-singlefile
- https://onnxruntime.ai/docs/get-started/with-javascript/web.html
- https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html
- https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap
