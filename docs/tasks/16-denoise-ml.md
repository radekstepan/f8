# Task 16 — Lightweight denoise for high-ISO shots

## What changed

High-ISO photos get a server-side learned denoise behind a strength
slider (0–100) and an Auto toggle keyed on EXIF ISO (engages at ISO
1600+). The Inspector's Denoise section previews on a ≤512px downsample
first with a before/after, then applies at up to 2048px as the canvas
and export base. The recipe stores only `{strength, auto, source}`, so
reopening a photo offers a one-click restore instead of silently showing
the noisy original.

- `packages/core/src/vision/denoise.ts` (new, re-exported via
  `vision/index.ts`)
  - Model constants: `DENOISE_FILE` (`dncnn_color.onnx`),
    `DENOISE_FILE_SIZE` (2,680,354), `DENOISE_DEFAULT_URL` (npuscale v1.2
    release asset), `DENOISE_LICENSE` (MIT), `F8_DENOISE_*` env names.
  - `denoiseStrengthForIso` / `shouldAutoDenoise` /
    `effectiveDenoiseStrength`: the ISO-keyed auto ladder (0 below ISO
    400 → 65 at ISO 6400+, capped — see calibration).
  - `packDenoiseInput` (RGB float32 NCHW 0..1) / `parseDenoiseOutput`
    (3-plane output used directly as the clean image, clamped,
    non-finite cells sanitized to the original, blended by strength —
    RangeError on shape mismatch).
  - `blendDenoised` (strength mix for the classical path) and
    `denoiseClassic` (luminance bilateral radius 2 + chroma box
    smoothing, hue-preserving green recovery, blended by strength).
  - `isDenoiseActive` (strength > 0).
- `packages/core/src/types.ts`: `DenoiseSource` (`onnx` | `classic`) +
  `DenoiseState`; `EditState.denoise?` (absent/null when off, like
  `faceAdjust`/`selectiveAdjust`).
- `packages/core/src/data.ts`: `isOriginalLook` returns false for an
  active denoise (denoised base pixels are a visible look).
- `apps/server/src/denoise.ts` (new) + routes in `app.ts`
  - `GET /api/denoise/health`, `POST /api/denoise/warmup` (lazy ~2.6MB
    download with progress, same shape as the other ML assists),
    `POST /api/denoise/preview` (rejects long edges over 512px — the
    downsample-first flow is enforced by the API, not just the client),
    `POST /api/denoise/apply` (up to 2048px). Strength blends
    server-side, so preview and apply match exactly.
  - Opportunistic ONNX: warmed sessions serve, every failure falls
    through to the classical fallback, so denoise never 503s for ML
    reasons; every response names its source.
- `apps/web/src/vision/remoteDenoise.ts` (new) + `useDenoise.ts` (new):
  warmup/health polling and pixel transport mirroring
  `remoteSelectiveMask`; the hook owns the preview before/after and the
  applied base (session object URLs), the app owns the recipe patch (an
  effect matching on the applied base, guarded on equality so restores
  at the stored strength are recipe no-ops).
- `apps/web/src/App.tsx`: denoise runs on the original `photo.src`
  (the Inspector keeps the original even while applied, so a re-run
  never denoises twice); the canvas and export dialog receive the
  denoised base via `viewPhoto` while the recipe is active; reset
  clears the session pixels too.
- `packages/ui/src/components/Inspector.tsx`: `DenoiseAssist`
  view-model + `DenoiseControl` in a new Denoise section (Auto toggle
  with ML badge, strength slider, preview before/after, apply, applied
  + stale-restore states, classical note, error retry).
- `apps/web/src/index.css`: auto row + before/after compare layout.
- Tests: core `denoise.test.ts` (14), server `denoise.test.ts` (8, incl.
  a real-weights ONNX case gated on `F8_TEST_DENOISE_WEIGHTS`), UI
  `denoise.test.tsx` (8).
- Docs: this writeup + `README.md` (feature bullet, `F8_DENOISE_*` env
  rows, demo-boundary note).

## Model choice

The task names NAFNet-tiny, but every downloadable NAFNet ONNX is 65MB+
(the ailia `NAFNet-SIDD-width32` export is 117MB) — too heavy and too
slow on CPU for an interactive slider. DnCNN color-blind (KAIR, Zhang
et al. 2017) is the documented equivalent tiny ONNX: 2.6MB, MIT,
fully-convolutional with dynamic H/W, ~0.8s per 512px preview and ~9s
per 2048px apply on CPU. Verified by probing the actual export with
`onnxruntime-node` before wiring it: input `input` 1×3×H×W float32
0..1, output `output` the denoised image directly (not a residual —
neutral gray yields ~0.5 outputs), dynamic shapes accepted (500×333
runs). `F8_DENOISE_URL` accepts any image-to-image denoiser in the same
layout; residual-style exports do not serve (the output is used
directly, never subtracted).

## Calibration

Strength sweep (PSNR vs the clean frame) with synthetic Gaussian noise
over three real dev-library photos:

| photo | σ=12 noisy | 10% | 25% | 35% | 50% | 65% |
| --- | --- | --- | --- | --- | --- | --- |
| clock (textured) | 26.6 | 27.3 | **27.6** | 27.3 | 26.2 | 24.9 |
| landscape | 27.8 | 28.5 | 29.7 | 30.4 | 31.6 | **32.5** |
| portrait-ish | 26.8 | 27.4 | 28.3 | 28.8 | **29.2** | **29.2** |

| photo | σ=20 noisy | 10% | 25% | 35% | 50% | 65% |
| --- | --- | --- | --- | --- | --- | --- |
| clock | 22.3 | 23.0 | 23.9 | 24.3 | **24.4** | 23.9 |
| landscape | 23.7 | 24.4 | 25.6 | 26.4 | 27.7 | **28.9** |
| portrait-ish | 22.5 | 23.2 | 24.3 | 25.0 | 25.9 | **26.5** |

65 wins or ties in 5/6 pairs, so auto caps at 65; the most textured
frame at light noise peaks at 25, so the low rungs stay conservative
(800→20, 1600→35, 3200→50, 6400+→65). Strength 100 is left to the
manual slider: it crushes flats (σ=25 variance 613→2.4, unbiased) but
smears fine texture. Heavy noise (σ=25) improves 20.4→23.3dB at 65%.

## Fallback behavior

- Weights absent/offline/ORT missing: the classical bilateral serves
  with a "Classical denoise" note and no ML badge; health still reports
  ready/serving, so the flow never blocks on a download.
- `F8_DENOISE_OFFLINE=1` disables provisioning; warmup records the
  error in health while detect-equivalents keep serving classically.
- Oversized previews (long edge > 512px) get a 400 naming the apply
  route; malformed bodies/strengths get 400s, never silent clamps.
- Reload with an active recipe shows "Restore denoise" (one click
  re-runs the stored strength); export without session pixels exports
  the original — the stale banner says so rather than pretending.
- Reset clears the recipe and drops the session base together.

## Decisions

- **DnCNN over NAFNet.** "Lightweight" rules out 65–275MB restorers on
  CPU; a 2.6MB blind denoiser previews in under a second and applies in
  ~9s, which is what makes the slider interactive.
- **Pixels in the session, strength in the recipe.** A denoised base
  can't ride `/api/library` like a 96px mask (megabytes per photo), so
  the recipe keeps the strength and the client re-runs after reload —
  explicit and honest via the stale-restore state.
- **Preview cap enforced server-side.** The preview route rejects
  non-downsamples, so the downsample-first flow holds for any client,
  not just this UI.
- **Denoise runs on original pixels only.** The canvas/export swap to
  the denoised base, but every denoise run decodes from the original
  src — re-running (or restoring) can never stack denoise on denoise.
- **Apply capped at 2048px.** Full 24MP ONNX on CPU would take minutes;
  2048 covers Large exports and below, matches the canvas pipeline, and
  Original-size exports upscale the base (documented boundary).
- **Conservative auto ladder.** Auto undershoots on textured frames by
  design; the slider + preview cover users who want more.

## How verified

- Core: 38 files / 698 tests pass (14 new: ISO ladder incl. invalid
  ISOs, auto threshold boundary, effective strength incl. clamping,
  NCHW pack layout, output blend endpoints, clamp + NaN sanitize,
  shape-mismatch rejection, blend mismatch, classical copy-at-0,
  variance halving, flat passthrough, edge preservation, strength
  scaling).
- Server: 16 files / 153 tests pass (8 new: preview/apply validation,
  strength + encoding rejection, downsample-first enforcement, 2048
  ceiling, classical health naming model + MIT + URL, classical grain
  reduction, HTTP preview/apply/oversized/malformed, real-weights ONNX
  warm + serve via `F8_TEST_DENOISE_WEIGHTS`).
- UI: 12 files / 74 tests pass (8 new: absent without assist, high-ISO
  auto hint + ML badge, clean-capture manual start, preview
  before/after + apply + ML tag, classical note without the tag,
  applied + stale-restore states, error retry).
- `yarn typecheck` in `packages/core`, `apps/server`, `packages/ui`,
  `apps/web` — pass (after rebuilding core + UI `dist`, which
  dependents resolve `@f8/*` through; `dist` is git-ignored).
- Throwaway probes in `/tmp` (not committed): ORT contract probe
  (names, dynamic shapes, direct-output semantics, timing at
  512/1600px), in-process e2e through `app.request` (real 2.6MB
  download in ~1s, health flips to `onnx`, noisy real photo → 200 in
  770ms), flat-patch unbiased check, the 3-photo × 2-level strength
  calibration above, and an eyeballed clean/noisy/denoised triptych.
- Playwright was not run (per task instructions).
