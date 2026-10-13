# Task 12: Person-removal download failure → setup prefetch + error message box

## Problem

Person-removal (YOLOv8n) weights failed to download with `Model download
failed: HTTP 404`, and the Inspector showed the failure as a bare note with
two link-styled buttons (Retry / Dismiss). The user asked for (a) a small
"message" holding the two options, and (b) an install script that fetches
all ML assets ahead of time instead of on demand.

## Root cause of the 404

The default URL `.../ultralytics/assets/releases/download/v0.0.0/yolov8n.onnx`
never existed: the `ultralytics/assets` v0.0.0 release hosts only `.pt`
files (verified via the GitHub API — no `yolov8n.onnx` asset on any page),
and Ultralytics publishes no pre-exported ONNX anywhere (their HuggingFace
`Ultralytics/YOLOv8` repo is `.pt`-only too). The URL is copy-paste
folklore; many projects reference the same dead link.

## Changes

1. **Working YOLOv8n default URL** (`packages/core/src/vision/object-detect.ts`).
   New default is the Kalray YOLOv8n COCO fp32 export on HuggingFace, pinned
   to commit SHA `9e0af089be9c...` for reproducible installs. Verified by
   downloading it and running it under the repo's own `onnxruntime-node`:
   input `images` 1x3x640x640, output `[1,84,8400]` — exactly what
   `parseYoloDetections` expects. Size constant is now the exact 12,834,838
   bytes (used for download progress). License stays AGPL-3.0 (Kalray repo
   is tagged `license:agpl-3.0`; upstream weights are Ultralytics').
   SHA-256 `65158dad...afd8b5` independently matches a SHA pinned by
   another project using this file. Override via `F8_OBJECT_DETECT_URL`
   still works.
2. **`yarn setup` prefetches every ML asset** (new `apps/server/src/fetch-models.ts`,
   wired as `@f8/server` `setup` + root `setup` scripts). The plan covers
   ml-heal/lama, ml-heal/moebius, object-detect, face-detect,
   selective-mask, denoise, superres, and semantic-search (~1.5GB total).
   Each entry reuses its module's `ensure*Weights` — the same function the
   warmup path calls — so the prefetch can never drift from on-demand URLs,
   dirs, or truncation guards. Entries already on disk are skipped;
   failures are collected per entry and exit 1 with a summary (one bad
   host must not starve the rest). Straighten-ml joins the plan only when
   `F8_STRAIGHTEN_ML_URL` is configured (weights unpublished); dust spots
   is absent by design (classifier embedded in `@f8/core`). On-demand
   download remains as the fallback — removing fallbacks is task 20's job,
   not this one.
3. **Person-removal errors render as a message box** (`Inspector.tsx` +
   `index.css`). The error state is now a boxed `.assist-message.is-error`
   (`role="alert"`, `data-testid="object-removal-error"`) holding the
   message plus both options: Retry as a `slim-button`, Dismiss as a
   `text-button`. Dust-spots error UI intentionally untouched (task 13
   owns that surface next).
4. **README** documents `yarn setup` in Running Locally.

To share the download code, each single-file server module's private
`downloadWeights` was renamed to an exported `ensure*Weights`
(object/face/selective/denoise/superres/semantic/straighten); behavior is
unchanged — warmup callers just use the new names.

## Decisions

- Pinned HF commit SHA instead of `resolve/main`: setup-time assets must
  be bit-reproducible; a silent upstream re-export must not change what
  users install. Recorded SHA + size above for future rotation.
- Continue-on-error with exit 1 rather than fail-fast: a setup run should
  fetch everything fetchable and report the rest, not stop at the first
  bad host.
- No `postinstall` hook: a ~1.5GB surprise download on every `yarn
  install` (including offline CI) would be hostile; `yarn setup` is
  explicit and documented.

## Follow-up noticed (not changed)

`ensureLamaWeights` ignores `F8_ML_HEAL_OFFLINE=1` (Moebius honors it), so
it attempted a real 198MB download in an offline-flagged CLI smoke test.
Pre-existing quirk, left for its owner — the prefetch test does not pin
either behavior.

## Verification

- `apps/server`: 172/172 pass (incl. 5 new `fetch-models.test.ts`: plan
  contents, straighten conditional, per-entry failure collection,
  all-cached run with `fetch` stubbed to throw, all-offline failure run).
- `@f8/ui`: 124/124 pass (incl. new message-box test asserting
  `object-removal-error` holds Retry before Dismiss).
- `@f8/core`: 745/745 pass. `yarn typecheck`: 6/6.
- Live: `ensureObjectDetectWeights` into a temp dir downloaded exactly
  12,834,838 bytes with the expected SHA-256; second call hit the cache.
  CLI smoke with all offline flags printed the per-entry summary and
  exited 1 (except the LaMa quirk above).
