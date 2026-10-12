# Task 13 — ML selective (masked) adjustments

## What changed

Segment → adjust for subjects: a small U²-Net portrait segmenter finds the
subject with a soft mask, and masked exposure/contrast/saturation apply
through the mask (subject) or its inverse (background) — "brighten subject
only". Every entry point says it's ML, and every result says whether ML or
the classical fallback served it.

- `packages/core/src/vision/selective-mask.ts` (new, re-exported via
  `vision/index.ts`)
  - `packSelectiveMaskInput`: stretch resize to the 320 u2netp grid (RGB
    float32 0..1, ImageNet-normalized NCHW — matching the rembg u2net
    preprocessing) plus the source size for mapping the mask back.
  - `parseSelectiveMaskOutput`: raw square single-channel side output →
    soft 0..1 mask at working size. Direct probabilities, clamped, with
    non-finite sanitized to 0 *before* blending (a NaN neighbor otherwise
    poisons the whole bilinear resample — the unit tests caught it), then
    bilinear resample. Deliberately no min-max stretch: the export ships
    sigmoided outputs (verified), and stretching would manufacture a
    subject on subject-free photos (verified: flat gray yields all-~0).
    Throws RangeError on non-square outputs (the server falls back to
    classical instead).
  - `proposeClassicSubjectMask`: classical proposer that serves when ONNX
    weights are absent — face-box-derived head-and-shoulders soft ellipses
    when faces are found (reuses `proposeFaceCandidates`), else a
    center-prior skin saliency, blurred twice. Null when the mask is empty
    or full-frame (no usable subject).
  - `selectiveMaskCoverage` (subject fraction ≥ 0.5),
    `resizeSelectiveMask` / `downsampleSelectiveMask` (bilinear; stored
    masks cap at a 96px long edge),
    `encodeSelectiveMask` / `decodeSelectiveMask` (base64 8-bit recipe
    wire format; decode returns null on corrupt payloads so render never
    throws on a damaged recipe).
  - `applySelectiveAdjust` (in-place mask-composite over a caller-owned
    buffer: per-pixel exposure gain / pivot contrast / chroma saturation
    with the global pipeline's math, composited by the mask — the
    unselected side passes through bit-identical),
    `selectiveAdjustForMask` (recipe state with the default +0.5 EV
    brighten-subject suggestion, or null when the mask has no usable
    subject so a no-op apply stores no badge),
    `isSelectiveAdjustActive` / `editHasSelectiveAdjust`.
- `packages/core/src/types.ts`: `SelectiveMaskSource` (`onnx | classic`),
  `SelectiveTarget` (`subject | background`), `SelectiveAdjustState`
  (`{maskB64, maskWidth, maskHeight, target, exposure, contrast,
  saturation, source}`), and optional `EditState.selectiveAdjust`
  (null/absent when unapplied, including legacy server recipes).
- `packages/core/src/adjustments.ts`: `renderAdjustedPixels` applies the
  masked pass after the point pass (with the face pass) and before the
  clarity/sharpness passes; `isNeutralEdit` accounts for it. Preview and
  export share the path. Corrupt masks skip silently.
- `packages/core/src/data.ts`: `isOriginalLook` returns false when
  `selectiveAdjust` is set (the optional key is absent from `DEFAULT_EDIT`,
  so it needs the explicit check — a masked edit is a visible look).
- `apps/server/src/selective-mask.ts` (new) + routes in `app.ts`
  - `GET /api/selective-mask/health` (always serving; `source` is `"onnx"`
    once u2netp weights + session are warm, else `"classic"`; also reports
    the model file/size/license/URL), `POST /api/selective-mask/warmup`
    (background provisioning, health-poll progress like face-detect),
    `POST /api/selective-mask/detect` (downsampled RGBA → stored-shape
    mask + coverage + source; mask null when no usable subject).
  - u2netp weights (~4.6MB) download once into
    `<data>/models/selective-mask`; every ONNX failure falls through to
    the classical proposer, so detect never 503s for ML reasons. Env:
    `F8_SELECTIVE_MASK_URL` / `F8_SELECTIVE_MASK_DIR` /
    `F8_SELECTIVE_MASK_OFFLINE` (plus `PHOTOMATOR_*` aliases).
  - Session input/output names are read dynamically (first by session
    order — verified `input.1` / `1959` on u2netp) so URL overrides with
    renamed tensors still serve; the square-shape check rejects non-mask
    models.
- `apps/web/src/vision/remoteSelectiveMask.ts` (new): warmup/health polling
  + detect transport mirroring `remoteFaceDetect.ts`, with wire-mask
  validation.
- `apps/web/src/vision/useSelectiveMask.ts` (new): `detect(src)` decodes a
  ≤320px downsample and warms + runs segmentation; resets on photo switch.
- `apps/web/src/App.tsx`: `selectiveMask` hook, one-undo-step apply with a
  toast naming target/params + ML-ness, live `onAdjust` tweaks coalesced
  by the `selective-mask` merge key, Clear for the stored mask + params.
- `packages/ui/src/components/Inspector.tsx`: `SelectiveMaskAssist` view
  model + `SelectiveMaskControl` in the adjust tool under the faces row:
  idle (Brighten Subject Only + ML badge) → detecting (shared
  `MlProgressView`) → ready (summary `Subject 23% · ML`, subject/background
  toggle, exposure/contrast/saturation draft sliders, Apply) → applied
  (badge `Subject · +0.5 EV · ML` + live target/sliders + Rescan/Clear) →
  empty/error states. Classical results are labeled a scan, never ML.
- `packages/ui/src/hooks/useEditor.ts`: reset clears `selectiveAdjust`.
- `apps/web/src/index.css`: `.selective-mask` block + target toggle; the
  rest reuses inspector classes.
- Tests: `selective-mask.test.ts` (core, 29), `selective-mask.test.ts`
  (server, 6: validation, health naming the model, classical fallback
  direct + over HTTP, empty result, HTTP 400), `selectiveMask.test.tsx`
  (UI, 7 markup cases), 1 new `isOriginalLook` case (inside the core file).
- Docs: this writeup + `README.md` (feature bullet, env table,
  demo-boundary note).

## Model choice

U²-Net portrait (`u2netp`) ONNX redistributed by rembg (~4.6MB fp32, input
320, seven 320×320 single-channel side outputs of which the first is the
fused mask), chosen over full U²-Net (~168MB — too heavy for a lazy photo
edit) and MODNet (no canonical small ONNX release with a stable URL).
u2netp is portrait/saliency-trained, MODNet-class in size, and a single
file behind a stable release URL, so the "zero new infra" promise holds
(one lazy download on the existing photo server, ~180ms CPU inference).

- Default URL:
  `https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx`
- License: Apache-2.0 (U²-Net). Surfaced in `/health` (`model`
  object) so clients and operators always see it; no weights are
  committed — they download once into the git-ignored data dir.
- No new runtime: `onnxruntime-node` CPU on the server, already a
  dependency for ml-heal.
- Verified end to end here (not by construction): Lena → coverage 0.100
  with a clean centered person mask; a wall clock → 0.716 with a
  pixel-perfect clock mask; a mountain landscape → 0.060 on the sunlit
  face (coherent salient region, kept honestly); flat gray → all-~0
  outputs → null mask ("no subject"). Fresh-dir provisioning downloads
  exactly 4,574,861 bytes and warms to `source: "onnx"`.

## Fallback behavior

- Weights absent (first run offline, `F8_SELECTIVE_MASK_OFFLINE=1`, ORT
  missing, corrupt output, inference throw): the classical proposer
  serves — head-and-shoulders from face boxes when faces are found, else
  center-prior skin saliency. It misses backs-turned subjects and can fire
  on warm centered objects; the UI calls it a "classical scan", shows an
  explanatory note, and omits the `· ML` tags — a fallback result is never
  presented as ML.
- No usable subject (coverage < 1% or > 98%, either source): the server
  returns a null mask with the coverage, and the UI reports "No subject
  found" as an explicit state, not a silent no-op. The full-frame veto
  keeps a whole-frame mask from turning a masked edit into a global shift.
- Corrupt stored mask: decode returns null and the pipeline skips the
  selective pass — a damaged recipe renders the unmasked photo, never an
  error.
- Server unreachable: the hook reports an error with Retry; nothing is
  applied. Segmentation never blocks painting (a discrete button, not a
  gate).

## Decisions

- **Direct probabilities, not rembg's min-max.** rembg stretches every
  output to full range, which is fine for background removal (the user
  expects a cutout) but fabricates subjects on empty photos. The export
  ships sigmoided outputs, so the parser uses them directly — the mountain
  (6% coherent salient region) and flat gray (honest empty) probes above
  pinned the behavior, and the coverage gates do the rest.
- **96px recipe masks.** `/api/library` ships every photo's full recipe at
  load, so a 160px mask (34KB base64 worst case) would tax library loads
  once several photos carry selective edits. 96px caps the worst case at
  ~12KB; exposure/contrast/saturation are low-frequency, and the soft
  upsampled edges avoid halos. Documented in the constant and the README
  boundary (hair-strand detail is out of reach).
- **One recipe field, mask plus params.** `selectiveAdjust` stores the
  mask, the target, and the three params, so the applied badge, undo,
  persistence, and preview/export all ride the existing recipe machinery
  with no extra plumbing. A fresh scan replaces the stored adjust (never
  stacks). Masked math reuses the global pipeline's exact response
  (2^(EV·0.6), pivot contrast, chroma saturation), so masked +0.5 EV
  matches global +0.5 EV inside the mask.
- **Live sliders after apply.** Unlike faces (one reviewed summary +
  Apply), selective edits are meant to be tuned: the applied state keeps
  the target toggle and all three sliders live, coalesced by the
  `selective-mask` merge key. Narrower ranges than global (±1 EV, ±50)
  keep the short sliders precise; the core still clamps to global ranges.
- **Masked pass rides with the face pass.** Both land between the point
  pass and clarity/sharpness so detail work operates on adjusted pixels
  instead of ringing mask edges.
- **Source framing, like faces/removal/dust.** Segmentation runs on
  `photo.src`; the mask aligns on unrotated/uncropped photos and does not
  remap through rotation/crop yet (README boundary; remapping is the
  follow-up). Copy/paste carries the mask with the adjustments, like face
  boxes — also noted in the boundary.
- **Inspector only.** The task asked for the Inspector; no menubar,
  shortcut, or context-menu entries were added (faces grew those, but the
  control is self-contained and discoverable where the sliders live).

## How verified

- Core: 35 files / 639 tests pass (29 new: 320-grid RGB pack with ImageNet
  normalization + quadrant mapping, direct-probability parse incl. the
  real 320² shape / flat-low preservation / clamp + NaN sanitization /
  misshape, coverage, resize/downsample incl. the 96px cap, base64
  round-trip + corrupt-null, classical face-derived geometry /
  skin-saliency fallback / null-on-empty, subject-only application with
  bit-identical background + inverse background target + soft mid-mask
  blend + contrast/saturation path + recipe-size resample + neutral no-op
  + buffer-mismatch, recipe builder incl. gates, active-state contract,
  pipeline render + neutrality + corrupt-skip + non-original look).
- Server: 13 files / 116 tests pass (6 new: body validation, health
  without weights naming the u2netp model, classical mask direct + over
  HTTP incl. wire-shape check, empty result, HTTP 400).
- UI: 9 files / 53 tests pass (7 new: control absent/idle ML badge,
  ready ML summary with target toggle + sliders + apply, classical
  labeling without the ML tag, empty (both sources) / error states,
  applied badge with live sliders + rescan/clear, background classical
  summary).
- `yarn typecheck` in `packages/core`, `apps/server`, `packages/ui`,
  `apps/web` — pass (after rebuilding core + UI + server `dist`, which
  dependents resolve `@f8/*` through; `dist` is git-ignored, not
  committed).
- Real-model probes (throwaway scripts in `/tmp`, not committed):
  verified session contract (`input.1` 1×3×320×320, 7× 1×1×320×320, first
  output is the fused mask), Lena/clock/mountain/gray masks inspected as
  images, server `ensureSelectiveMaskReady` + `runSelectiveMaskDetect` on
  a seeded dir → health `onnx`, Lena coverage 0.100 in ~180ms, flat gray
  → null mask; fresh-dir provisioning downloads exactly 4,574,861 bytes
  and warms to `onnx`.
- Playwright was not run (per task instructions).
