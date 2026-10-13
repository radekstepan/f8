# Task 7 — Estimated file size in the export dialog

## Problem

The export dialog (format + image-size preset + quality + 2x toggle)
gave no indication of the resulting file size before exporting. The
task: show an estimated size when a preset is selected — but only if a
reasonably accurate number is feasible; otherwise ship nothing rather
than a misleading figure.

(Note: the dialog has no saved export presets; the size options —
Original / Large / Medium / Small — act as the presets. The estimate
updates on any export-setting change: format, size, quality, edits.)

## Accuracy assessment (the task's go/no-go question)

**Feasible — the estimate is byte-exact by construction for the
standard path.** Export is fully client-side
(`renderExportCanvas` → `canvas.toBlob` with the chosen format/quality),
so the dialog can run that same pipeline in the background at the
selected settings and report the encoded blob's size. Identical pixels
through the identical browser encoder produce identical bytes (the
grain effect uses a fixed seed, so it is deterministic too). A
proxy/heuristic approach (encode small, scale by pixel ratio) was
rejected: JPEG/WebP size is content- and encoder-dependent and such
scaling errs by tens of percent.

Two documented exceptions, both handled honestly:

1. **Repair strokes** estimate with the blur fallback (no worker
   inpaint binding), while the real export heals via the worker. Pixel
   differences are confined to the small repair regions, so the size
   delta is negligible — and it keeps the estimate off the potentially
   slow ML heal path instead of doubling heal work.
2. **Super-resolution 2x has no accurate pre-export number**: the final
   pixels only exist after the server ML run. When 2x is armed the line
   reads "File size estimate unavailable for 2x upscales." — no
   guessing, no scaled-up fiction.

A failed estimate (unreadable pixels, CORS-tainted canvas) hides the
line rather than showing a stale number.

## What changed

- `packages/core/src/exportEstimate.ts` (new, exported from
  `packages/core/src/index.ts`):
  - `estimateExportBytes(src, edit, format, quality, maxSize)` —
    renders the export canvas at the selected size (no repair
    binding, per above) and encodes with the selected format/quality;
    returns `{ bytes, width, height }`. Optional `deps` seam swaps the
    render/encode stages for tests (core tests run in node, where the
    DOM pipeline cannot execute).
  - `formatByteSize(bytes)` — pure formatter ("842 B", "1.5 MB";
    en dash for unusable input).
- `packages/ui/src/components/EditorDialogs.tsx`: the export dialog
  gains an estimate line under the quality control
  (`data-testid="export-size-estimate"`): "Estimating file size…"
  while pending, then "Estimated file size ≈ X (W × H)". A 400ms
  debounce lets slider drags settle; a live-flag guards races. The
  2x-armed state shows the unavailable note instead.
- Tests: `packages/core/src/exportEstimate.test.ts` (4
  `formatByteSize` cases incl. boundaries/degenerate input; wiring
  case proving render-at-size → encode-with-settings → bytes+dims and
  that no repair binding is passed; failure-propagation case),
  `packages/ui/src/components/exportSizeEstimate.test.tsx` (SSR-pinned
  placeholder, placement before the superres option, 2x unavailable
  note with no number).
- No `README.md` update: a dialog line, not architecture.

## Decisions

- **Real pipeline over heuristic.** Slightly more work per estimate
  (a background render + encode, debounced) in exchange for an exact
  number. At "Original source size" on very large photos this costs a
  noticeable background render — accepted, since the export itself
  does the same work; the dialog stays responsive via the debounce
  and the async encode.
- **Dimensions in the label.** The estimate also reports the true
  output dimensions after rotation/crop/resize, which the size
  preset's "Up to N px" cannot.
- **Blur-fallback repairs in the estimate.** Passing the worker
  binding would make the number exact to the byte but would double
  heal round-trips (estimate + export); the sub-1% size effect of
  repair regions does not justify that.

## Tests (unit/integration only, no Playwright)

- `@f8/core`: 875/875 pass (was 869; +6 new), `build` + `typecheck`
  clean (rebuilt dist first so dependents resolve the new export).
- `@f8/ui`: 417/417 pass (was 414; +3 new), `build` + `typecheck`
  clean.
- `@f8/web`: `typecheck` clean.
