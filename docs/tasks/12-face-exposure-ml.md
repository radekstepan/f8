# Task 12 — ML face-aware exposure / white balance

## What changed

Detect → correct for faces: a small YuNet face detector finds faces with
eye landmarks, and the faces drive three corrections — white balance
anchored on face skin tones instead of whole-image means, a softly masked
exposure lift over underexposed faces, and automatic red-eye suppression
around the eye landmarks. Every entry point says it's ML, and every result
says whether ML or the classical fallback served it.

- `packages/core/src/vision/face-exposure.ts` (new, re-exported via
  `vision/index.ts`)
  - `packFaceDetectInput`: stretch resize to the 640 YuNet grid (BGR
    float32 0..255, NCHW — matching OpenCV `blobFromImage` defaults, no
    normalization) plus the source size for mapping detections back.
  - `parseYuNetFaces`: raw YuNet stride heads (cls/obj/bbox/kps at strides
    8/16/32) → normalized faces with image-space eye landmarks. A faithful
    port of the OpenCV FaceDetectorYN postprocess (`score =
    sqrt(clamp(cls) * clamp(obj))`, threshold 0.6, box/landmark decode,
    NMS IoU 0.3), score-descending, capped at 20. Throws RangeError on
    misshaped outputs (the server falls back to classical instead).
  - `proposeFaceCandidates`: classical skin-tone proposer (shared
    `isSkinPixel` rule → coarse connected components gated on area,
    near-square aspect, fill ratio, and a full-frame veto) with
    proportional eye estimates and the fixed 0.5 approximate score.
    Serves when ONNX weights are absent.
  - `faceSkinMeans` / `computeFaceWhiteBalance`: the classic WB mapping
    fed with skin-tone means from inside the face boxes; null when fewer
    than 64 skin pixels anchor on (the caller uses the whole-image auto).
  - `faceMeanLuminance` (skin-preferred) / `faceLiftAmount` (EV toward
    luminance 112, capped at 1, dead zone at/above target).
  - `faceLiftMask` (feathered per-face ellipses, max-combined),
    `applyFaceLift` / `applyRedEyeFix` (in-place passes over a
    caller-owned buffer), `findRedEyeSpots` (red-dominant clusters around
    each eye; strict enough that warm skin never fires — see Decisions),
    `faceAdjustForFaces` (recipe state, or null when nothing would change
    so a no-op apply stores no badge), `isFaceAdjustActive` /
    `editHasFaceAdjust`.
- `packages/core/src/vision/enhance.ts`: extracted
  `whiteBalancePatchFromMeans` from `computeWhiteBalanceAuto` (no behavior
  change; existing tests guard it) so the skin anchor reuses the exact
  classic mapping.
- `packages/core/src/types.ts`: `FaceBox`, `FacePoint`, `RedEyeSpot`,
  `FaceDetectSource` (`onnx | classic`), `FaceAdjustState`
  (`{boxes, amount, redEye, source}`), and optional
  `EditState.faceAdjust` (null/absent when unapplied, including legacy
  server recipes; the skin-anchored WB rides the plain sliders).
- `packages/core/src/adjustments.ts`: `renderAdjustedPixels` applies the
  masked lift + red-eye discs after the point pass and before the
  clarity/sharpness passes; `isNeutralEdit` accounts for them. Preview
  and export share the path, so both pick faces up with no extra work.
- `packages/core/src/data.ts`: `isOriginalLook` returns false when
  `faceAdjust` is set (the optional key is absent from `DEFAULT_EDIT`,
  so it needs the explicit check — a masked lift is a visible look).
- `apps/server/src/face-detect.ts` (new) + routes in `app.ts`
  - `GET /api/face-detect/health` (always serving; `source` is `"onnx"`
    once YuNet weights + session are warm, else `"classic"`; also reports
    the model file/size/license/URL), `POST /api/face-detect/warmup`
    (background provisioning, health-poll progress like object-detect),
    `POST /api/face-detect/detect` (downsampled RGBA → faces + eyes).
  - YuNet weights (~227KB) download once into
    `<data>/models/face-detect`; every ONNX failure falls through to the
    classical proposer, so detect never 503s for ML reasons. Env:
    `F8_FACE_DETECT_URL` / `F8_FACE_DETECT_DIR` /
    `F8_FACE_DETECT_OFFLINE` (plus `PHOTOMATOR_*` aliases).
- `apps/web/src/vision/remoteFaceDetect.ts` (new): warmup/health polling
  + detect transport mirroring `remoteObjectDetect.ts`.
- `apps/web/src/vision/useFaceEnhance.ts` (new): `detect(src)` decodes a
  ≤640px downsample, warms + runs detection, and derives the skin WB, the
  classic-WB fallback, and the lift/red-eye state from the same pixels
  (no second decode); resets on photo switch. All-or-nothing apply, no
  per-face toggles (the WB is global from all faces' skin).
- `apps/web/src/App.tsx`: `enhance-faces` action (detects + switches to
  the editor's adjust tool), Shift+E shortcut, context-menu requests with
  parked detect-then-auto-apply (mirrors scene enhance), one-undo-step
  apply with a toast naming faces/WB/lift/red-eye + ML-ness, Clear for
  the stored masks (WB stays as slider values).
- `packages/ui/src/components/Inspector.tsx`: `FaceEnhanceAssist` view
  model + `FaceEnhanceControl` in the adjust tool under the scene row:
  idle (Enhance Faces + ML badge) → detecting (shared `MlProgressView`)
  → ready (summary: faces, skin/classic WB, lift EV, red-eye count, `·
  ML` only when YuNet served) → applied (`N faces · ML` + Rescan/Clear)
  → empty/error states. Classical results are labeled a scan, never ML.
- `packages/ui/src/components/Topbar.tsx`: `enhance-faces` menu action;
  the Image menu gains `Enhance Faces · ML` (shortcut Shift+E).
- `packages/ui/src/components/PhotoStrips.tsx`: the photo context menu
  (grid + filmstrip) gains an `Enhance Faces · ML` entry via optional
  `onFaceEnhance` (both ML entries are now independently conditional).
- `packages/ui/src/components/EditorDialogs.tsx`: shortcuts dialog lists
  `Enhance Faces (ML)` / Shift+E.
- `packages/ui/src/hooks/useEditor.ts`: reset clears `faceAdjust`.
- `apps/web/src/index.css`: `.face-enhance` block + applied-row layout;
  the rest reuses inspector classes.
- Tests: `face-exposure.test.ts` (core, 26), `face-detect.test.ts`
  (server, 6: validation, health naming the model, classical fallback
  direct + over HTTP, empty result, HTTP 400), `faceEnhance.test.tsx`
  (UI, 6 markup cases), 2 new context-menu cases, 1 new `isOriginalLook`
  case.
- Docs: this writeup + `README.md` (feature bullet, env table,
  demo-boundary note).

## Model choice

YuNet 2023mar ONNX from the OpenCV Zoo (~227KB fp32, input 640, twelve
raw stride heads), chosen over SCRFD-tiny (heavier, multi-head decode
without bundled landmarks in the tiny export) and UltraFace (no
landmarks — red-eye would fall back to proportional eye guesses). YuNet
is the only tiny option that ships decoded eye landmarks, which the
red-eye stage needs, and at 227KB the "zero new infra" promise holds
(one lazy download on the existing photo server, ~30ms CPU inference).

- Default URL:
  `https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx`
- License: Apache-2.0 (OpenCV Zoo). Surfaced in `/health` (`model`
  object) so clients and operators always see it; no weights are
  committed — they download once into the git-ignored data dir.
- No new runtime: `onnxruntime-node` CPU on the server, already a
  dependency for ml-heal.
- Gotcha documented in code: the zoo stores weights in Git LFS, so
  `raw.githubusercontent.com` serves the 131-byte LFS pointer — the
  default URL uses the `github.com/.../raw/...` path, which resolves
  LFS (verified: exactly 232,589 bytes, matching `FACE_DETECT_FILE_SIZE`).

## Fallback behavior

- Weights absent (first run offline, `F8_FACE_DETECT_OFFLINE=1`, ORT
  missing, corrupt output, inference throw): the classical skin-tone
  proposer serves. It misses non-skin-visible faces and can fire on warm
  wood/brick; results carry the fixed 0.5 score and the UI calls them a
  "classical scan", shows an explanatory note, and omits the `· ML` tags
  — a fallback result is never presented as ML. A full-frame veto keeps
  sprawling warmth from turning the masked lift into a global shift.
- Too few skin pixels (< 64 at working res): the skin-anchored WB yields
  to the whole-image auto computed on the same pixels; the summary says
  `WB` instead of `skin WB`.
- Faces need nothing (bright + flash-free): `faceAdjustForFaces` returns
  null, so the apply sets WB only and stores no badge.
- Server unreachable: the hook reports an error with Retry; nothing is
  applied. Detection never blocks painting (a discrete button, not a
  gate).
- Empty result ("No faces found") is an explicit state, not a silent
  no-op; context-menu auto-apply toasts it.

## Decisions

- **Real YuNet decode, verified against the real weights.** The zoo ONNX
  exposes raw stride heads, not decoded detections, so the parser ports
  OpenCV's `face_detect.cpp` postprocess (score, box/landmark decode,
  NMS defaults) rather than inventing a contract. Unlike task 09's
  "verified by construction" ONNX branch, this one ran end to end here:
  the 2023mar weights on Lena yield 1 face @0.91 with plausible eyes,
  two f/8 landscapes yield 0 faces, and a fresh-dir provisioning run
  downloads + warms to `source: "onnx"`.
- **Red-eye gates beat skin with margin.** The first red test (r−g ≥ 25,
  ratio ≥ 1.3) fired on plain warm skin — the unit tests caught it. Both
  the finder (gap ≥ 60 per channel, red ratio ≥ 2) and the fix (red
  excess ≥ 0.3) now clear skin (≈50 gap, ≈1.3 ratio, ≈0.24 excess) with
  room, and a dedicated test pins "skin inside a fix disc is untouched".
  Mild pink-eye may escape; the boundary note says so.
- **One recipe field, masks plus badge.** `faceAdjust` stores the lift
  boxes + amount, the red-eye discs, and the serving source, so the
  applied badge (`N faces · ML`), undo, persistence, and preview/export
  all ride the existing recipe machinery with no extra plumbing. The WB
  anchor sets the ordinary sliders (staying user-tweakable); Clear
  removes only the masks.
- **No per-face confirm list.** Removal and dust spots ask per item
  because each maps to a destructive-ish stroke; here the WB is global
  from all skin and the lift/red-eye are gentle, so one reviewed summary
  + Apply keeps the control compact. A fresh scan replaces the stored
  adjust (never stacks).
- **Lift before detail passes.** The masked lift lands between the point
  pass and clarity/sharpness so detail work operates on lifted faces
  instead of ringing the lift edge.
- **Source framing, like removal/dust.** Detection runs on `photo.src`;
  boxes align on unrotated/uncropped photos and do not remap through
  rotation/crop yet (README boundary; remapping is the follow-up).

## How verified

- Core: 34 files / 610 tests pass (26 new: 640-grid BGR pack, YuNet cell
  decode incl. landmark mapping, threshold/NMS/caps/ordering/misshape,
  classical proposer find/skip/full-frame veto, eye estimates, skin
  means, skin-vs-backdrop WB anchoring + null cases, skin-preferred
  luminance, lift curve incl. caps, mask shape/feather, lift application
  + no-op + outside-untouched, red-eye find + fix + skin-sparing,
  recipe builder incl. no-op-null, active-state contract, pipeline
  render + neutrality).
- Server: 12 files / 110 tests pass (6 new: body validation, health
  without weights naming the YuNet model, classical face direct + over
  HTTP, empty result, HTTP 400).
- UI: 8 files / 46 tests pass (8 new: control absent/idle ML badge, ML
  summary with skin WB + lift + red-eye, classical labeling without the
  ML tag, empty/error states, applied badge with rescan/clear,
  context-menu entry present/absent).
- `yarn typecheck` in `packages/core`, `apps/server`, `packages/ui`,
  `apps/web` — pass (after rebuilding core + UI + server `dist`, which
  dependents resolve `@f8/*` through; `dist` is git-ignored, not
  committed).
- Real-model probes (throwaway scripts in `/tmp`, not committed):
  YuNet 2023mar weights + Lena → 1 face @0.913 with eyes at the right
  height; two f/8 landscape previews → 0 faces; server
  `ensureFaceDetectReady` + `runFaceDetect` on a seeded dir → health
  `onnx`, same Lena result in ~30ms; fresh-dir provisioning downloads
  exactly 232,589 bytes and warms to `onnx`.
- Playwright was not run (per task instructions).
- Right-click open/dismiss and the Shift+E/context-menu flows could not
  be exercised in the SSR-only UI suite (no jsdom/click simulation);
  the open markup is pinned through the `initialContextMenu` seam and
  interaction needs one manual pass.
