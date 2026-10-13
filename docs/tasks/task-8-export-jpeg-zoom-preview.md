# Task 8 — 16× quality preview for lossy export formats

## Problem

The export dialog gave no way to judge JPEG/WebP compression artifacts
before exporting. The task: for lossy formats, show a denoise-style 16×
zoom preview — a full view with a focus box, side by side with a 16×
zoom of the focused area — with the focus remembered across preset
switches. (Per the Task 7 writeup, the dialog has no saved export
presets; the size options — Original / Large / Medium / Small — act as
the presets, so "switching the preset" means any format/size/quality
change.)

## What changed

- `packages/core/src/exportEstimate.ts` (auto-exported via `index.ts`):
  - `isLossyExportFormat(format)` — true for `jpeg`/`webp`, false for
    lossless PNG, fails closed on unknown values.
  - `renderExportPreview(...)` — the estimate's pipeline
    (render-at-size, encode-with-settings, no repair binding) returning
    `{ bytes, width, height, blob }`.
  - `estimateExportBytes(...)` reimplemented on top of it (drops the
    blob) — one run now feeds both the size number and the preview
    pixels, so they can never disagree.
- `packages/ui/src/components/EditorDialogs.tsx`:
  - New exported `ExportQualityPreview` component: full encoded export
    with a focus box next to a 16× closeup (denoise closeup geometry:
    1600% background, 6.25% square focus rect, click-to-move). Renders
    nothing for PNG; a failed run hides the section like the size line;
    while pending it shows "Rendering quality preview…".
  - `ExportDialog` owns one `focus` state (centered by default, reset
    only when the photo changes) and passes it down — preset switches
    re-render with the same focus, so it is remembered. The estimate
    effect now runs `renderExportPreview` and mints an object URL for
    lossy formats; every URL goes through a revoking setter (+ unmount
    cleanup) so superseded previews never leak. 2x-armed hides the
    section (no pre-export pixels exist, same as the size estimate).
- `apps/web/src/index.css`: `export-quality-*` rules mirroring the
  denoise closeup, laid out side by side (`flex-direction: row`).
- Tests: `packages/core/src/exportEstimate.test.ts` (+4:
  `isLossyExportFormat` true/false incl. fail-closed, `renderExportPreview`
  wiring incl. blob passthrough + no repair binding, failure
  propagation), `packages/ui/src/components/exportQualityPreview.test.tsx`
  (new, 13: dialog placeholder + placement + 2x hiding, PNG/failure
  null-rendering, full+zoom markup with injected URL, off-center focus
  following, edge clamping through the rect style, WebP, and CSS pins
  for 1600%/pixelated/focus geometry/side-by-side).
- No `README.md` update: a dialog section, not architecture (same call
  as Task 7).

## Decisions

- **Actual encoded output, not the source photo.** The preview shows
  the encoded blob at the selected format/quality/size — byte-identical
  to the download (modulo the estimate's documented repair caveat) —
  because a zoom of the uncompressed source could not show the
  artifacts the user is judging. Sharing the estimate's run adds no
  extra render.
- **Stale pixels hide, like the size line.** While a new run is
  pending the section shows a loading note rather than old pixels
  under a new quality label, which would mislead.
- **`image-rendering: pixelated` on the zoom.** Unlike the denoise
  closeup (smooth), a quality preview must show compression blocks as
  blocks — smoothing would blur exactly the artifacts under judgment.
- **Focus is dialog-owned `%` state.** `%` coordinates stay valid
  across size presets, so nothing about a preset switch invalidates
  them; only a photo change resets to center. SSR tests pin the
  controlled wiring (any injected focus renders in both box and zoom);
  click/persistence behavior follows structurally (repo tests are
  SSR-only, no DOM interaction harness).

## Tests (unit/integration only, no Playwright)

- `@f8/core`: 879/879 pass (was 875; +4 new), `build` + `typecheck`
  clean (rebuilt dist first so dependents resolve the new export).
- `@f8/ui`: 430/430 pass (was 417; +13 new), `build` + `typecheck`
  clean.
- `@f8/web`: `typecheck` clean.
