# Task 17 — Export-time super-resolution 2x

## What changed

Exports grow a "Super-resolution 2x" option (ML badge): the rendered
export canvas doubles through a server-side Real-ESRGAN x2plus ONNX
(~64MB, lazy download, cached for offline use) and feeds the existing
JPEG/PNG/WebP save path. Large frames run tiled with live per-tile
progress and a cancel button; a photo's right-click menu offers
"Export 2x", which opens the export dialog pre-checked.

- `packages/core/src/vision/superres.ts` (new, re-exported via
  `vision/index.ts`)
  - Model constants: `SUPERRES_FILE` (`realesrgan_x2.onnx`),
    `SUPERRES_FILE_SIZE` (67,073,446), `SUPERRES_DEFAULT_URL` (npuscale
    v1.1 release asset), `SUPERRES_LICENSE` (BSD-3-Clause), `F8_SUPERRES_*`
    env names, `SUPERRES_SCALE` (2), `SUPERRES_TILE` (512),
    `SUPERRES_TILE_OVERLAP` (16), `SUPERRES_MAX_INPUT_DIM` (2048).
  - `superresOutputSize` / `superresTilePlan`: 2x scale math and the
    halo-discard tile layout (RangeError on invalid/over-cap dims).
  - `packSuperresInput` (RGB float32 NCHW 0..1) / `parseSuperresOutput`
    (2x 3-plane output used directly as the upscaled image, clamped,
    non-finite cells sanitized toward the bilinear original, bilinear
    alpha — RangeError on shape mismatch).
  - `stitchSuperresTiles` (halo-discard assembly, placement-checked) and
    `upscaleClassic2x` (separable Lanczos-3 RGB + bilinear alpha).
  - `superresTileProgress` (polled tile counts → 0.15..0.95 band +
    stage copy; pure so the transport and tests share it).
  - `SuperresExportBinding` (`run` + `health`): the UI-facing transport
    seam, mirroring `RepairInpaintBinding`.
- `packages/core/src/types.ts`: `SuperresSource` (`onnx` | `classic`).
- `packages/core/src/image.ts`: `exportPhoto` split into
  `renderExportCanvas` (geometry + adjustments + effects) and
  `encodeExportCanvas` (JPEG/PNG/WebP) with no behavior change, so the
  2x flow upscales between the shared render and the shared encode.
- `apps/server/src/superres.ts` (new) + routes in `app.ts`
  - `GET /api/superres/health`, `POST /api/superres/warmup` (lazy ~64MB
    download with progress, same shape as the other ML assists),
    `POST /api/superres/upscale` (2048px long-edge ceiling),
    `GET /api/superres/progress` (live tile counts, polled while the
    POST is in flight — the ml-heal progress pattern; skipped in the
    request log like its sibling).
  - Opportunistic ONNX: warmed sessions serve tiled ML, every failure
    falls through to the classical fallback, so upscale never 503s for
    ML reasons; every response names its source and tile count.
- `apps/web/src/vision/remoteSuperres.ts` (new): `runRemoteSuperres`
  (POST + progress polling mapped through `superresTileProgress`,
  10-minute timeout, abortable), `warmupRemoteSuperres`,
  `fetchSuperresHealth`.
- `apps/web/src/App.tsx`: a memoized `SuperresExportBinding` (warmup
  then upscale) passed to the export dialog; `requestExport2x` parks
  context-menu requests until the photo is open and seeded (the scene/
  face enhance pattern), then opens the dialog pre-checked; the armed
  flag clears on close. Passed to `PhotoBrowser` and `Filmstrip`.
- `packages/ui/src/components/EditorDialogs.tsx`: the export dialog
  gains the 2x checkbox (ML badge, doubled-dimension hint, engine
  note from one health read, over-cap guard disabling Export), the
  `ml-progress` bar with stage copy, a Cancel upscale button, and
  engine-naming toasts; the plain path is byte-identical behavior.
- `packages/ui/src/components/PhotoStrips.tsx`: "Export 2x" + ML badge
  in the photo context menu (grid + filmstrip) via `onExport2x`.
- `apps/web/src/index.css`: `.superres-field` spacing (reuses
  `.ml-progress` / `.inspector-note`).
- Tests: core `superres.test.ts` (15), server `superres.test.ts` (8,
  incl. a real-weights ONNX case gated on `F8_TEST_SUPERRES_WEIGHTS`),
  UI `superresExport.test.tsx` (6) + 3 new `photoContextMenu` cases.
- Docs: this writeup + `README.md` (feature bullet, `F8_SUPERRES_*` env
  rows, demo-boundary note).

## Model choice

The task names Real-ESRGAN-tiny, and the npuscale project (already our
DnCNN source) ships exactly that shape as `realesrgan_x2.onnx`: the
Real-ESRGAN x2plus graph re-exported to ONNX with dynamic H/W, 64MB,
BSD-3-Clause upstream weights. Verified by probing the actual export
with `onnxruntime-node` before wiring it: input `input` 1×3×H×W
float32 0..1, output `output` the 2x image directly (neutral gray
yields ~0.5 outputs), dynamic shapes accepted (32–256px runs, ~2s at
256² on CPU). `F8_SUPERRES_URL` accepts any 2x super-resolver in the
same layout; non-upscaler models fail the 2x shape check and fall back
to classical. 64MB is the largest single-file weight in the app after
CLIP (~89MB) and far below ML Heal, and export pays it once.

## Timing

CPU inference scales ~linearly with pixels (~2s per 256²): a 600×400
export upscales in ~8s (2 tiles), a 1200×800 in ~32s, a 2048px frame
in ~95s — wait-tolerant with per-tile progress, as the task expects.
Whole-image inference past 512px would hold the full RRDB activation
map, hence the 512px cores / 16px halos; a seam probe shows no
discontinuity at tile edges (max step 6 inside the seam band vs 5
globally on a gradient).

## Fallback behavior

- Weights absent/offline/ORT missing: the classical Lanczos-3 serves
  with no ML badge and an honest note ("ML weights unavailable"),
  including while the ~64MB weights download in the background — the
  first 2x export is classical, later ones are ML.
- `F8_SUPERRES_OFFLINE=1` disables provisioning; upscale keeps serving
  classically.
- Inputs over the 2048px long edge get a 400 naming the cap; the
  dialog pre-guards from photo dims (Export disabled with the hint)
  and re-checks the rendered canvas (crop/rotation shift it).
- Cancel aborts the client fetch and poll; the server finishes its
  tiles harmlessly (single-user local server, documented).
- Malformed bodies/byte mismatches get 400s, never silent clamps.
- 2x upscales the dialog's photo src, which is the denoised base while
  a denoise recipe is applied — denoise + 2x compose.

## Decisions

- **Real-ESRGAN x2plus over a smaller net.** ESPCN-class tinies are
  smaller but visibly softer; at 64MB the genuine x2plus graph stays
  affordable (one download, tiled CPU) and matches the task's naming.
- **Context menu arms the dialog instead of exporting headless.**
  A headless export would need its own format/size/progress UI; parking
  the request (scene/face pattern) and pre-checking the dialog keeps
  one progress UI and the existing save path.
- **Warmup inside the binding's run.** The dialog calls one method;
  warmup is a no-op roundtrip once serving and kicks the background
  download on first use — denoise semantics exactly.
- **Tiled ML up to 2048px, no classical-by-size.** Everything the
  route accepts gets ML when weights are warm; classical means
  weights-unavailable, never a silent size downgrade.
- **Filename unchanged.** The toast names the 2x + engine; renaming
  the user's filename would surprise.
- **No recipe state.** Unlike denoise, 2x is an export-time choice,
  not a look — nothing persists, nothing restores.

## How verified

- Core: 39 files / 713 tests pass (15 new: scale math, single-tile
  layout, tiled halo coverage, cap rejection, NCHW pack, output parse
  incl. clamp/NaN/mismatch, halo-discard stitch incl. mismatch,
  progress-band mapping incl. clamps, classical flat/edge/alpha).
- Server: 17 files / 161 tests pass (8 new: validation incl. the 2048
  ceiling, classical health naming model + BSD + URL, idle progress
  endpoint, classical 2x step preservation, HTTP upscale/oversized/
  malformed, real-weights ONNX warm + serve via
  `F8_TEST_SUPERRES_WEIGHTS` with progress assertions).
- UI: 13 files / 83 tests pass (9 new: option absent without binding,
  unchecked + ML badge when bound, armed pre-check + doubled dims,
  small-source preview, health-check copy, plain path intact, Export
  2x in grid + filmstrip, omitted without the handler).
- `yarn typecheck` in `packages/core`, `apps/server`, `packages/ui`,
  `apps/web` — pass (after rebuilding core + UI `dist`, which
  dependents resolve `@f8/*` through; `dist` is git-ignored).
- Throwaway probes in `/tmp` (not committed): ORT contract probe
  (names, dynamic shapes, direct-output semantics, timing at
  32–256px), real-weights tiled e2e (600×400 → 1200×800 in 7.9s,
  progress `done 2/2`, seam probe clean).
- Playwright was not run (per task instructions).
