# Task 02 — Portrait orientation seamless in album

## Root cause

Two stacked causes, both confirmed against the real
`DSC06308.ARW` (Sony ILCE-6400, EXIF orientation 8, portrait):

1. **Sideways `/thumb` bytes (server).** The full-res preview was fine all
   along: `dcraw_emu` auto-rotates, so the cached preview is upright
   portrait (4024×6024) and the stored dimensions are correct. But the
   grid/filmstrip/presets thumb is the camera's embedded JPEG sliced
   verbatim out of the RAW — 1616×1080 landscape pixels with **no**
   orientation tag — so every surface using `photo.thumbnail` rendered the
   portrait shot as a sideways landscape image.
2. **Landscape-only presentation (web).** Even with upright bytes, the album
   grid forces `aspect-ratio: 1.5` + `object-fit: cover`, and the presets
   strip and footer filmstrip use fixed landscape boxes + `cover`, so a
   portrait photo could only ever appear as a landscape crop.

## What changed

- `apps/server/src/thumbs.ts` — portrait-class captures (EXIF orientation
  5–8) now get an upright thumb: the embedded slice's tag is removed
  (`stripExifApp1`) and the pixels are rotated through the existing
  magick/convert/sips toolchain (`orientArgsFor`, one table per CLI).
  Previews already stored upright (cameras that pre-rotate) only lose a
  misleading tag — no re-encode, no spawn. Rotation failure or a missing
  encoder resolves to null, so `/thumb` falls back to the upright full
  preview instead of caching a sideways thumb. Stale pre-rotation
  `<hash>-thumb.jpg` files are unlinked once replaced; the new cache name
  is `<hash>-thumb2.jpg`.
- `apps/server/src/app.ts` — thumbnail URLs are now
  `/api/photos/:id/thumb?v=2` (the old bytes were cached `immutable` for a
  year, so the versioned URL is what makes the fix visible) and the thumb
  ETag moved to `"<hash>-thumb2"`.
- `packages/core/src/jpeg.ts` (+ test) — `stripExifApp1` drops only the
  APP1 Exif segment (JFIF/XMP/ICC/scan data stay byte-identical); malformed
  input returns unchanged, never throws.
- `packages/core/src/image.ts` (+ tests) — `isPortraitPhoto` reads the
  stored upright dimensions; square/unknown read as landscape.
- `packages/ui/src/components/PhotoStrips.tsx` — portrait photos set
  `is-portrait` on the grid cell, the filmstrip item, and (strip-level,
  since every preset thumb shows the same photo) the presets list.
- `apps/web/src/index.css` — portrait grid cells and preset thumbs
  letterbox (`contain`) inside the unchanged geometry, so rows keep their
  uniform height (the virtualized grid math is untouched); filmstrip
  portrait items narrow to 43px at full 58px height with ellipsis filenames.
- `apps/server/src/fixtures.ts` — `makeTiffWithJpeg` accepts `orientation`
  (TIFF tag 274) and `embeddedOrientation` (tag inside the slice).

## Decisions

- **Rotate server-side, not via CSS.** CSS could un-sideways the pixels, but
  only the server can fix the cached bytes every surface shares.
- **Letterbox, not variable-height grid cells.** The grid virtualizes on a
  uniform row height; portrait cells keep the exact cell geometry and show
  the whole photo on the existing cell background — no layout jumps, no
  virtualization rewrite.
- **Orientations 2–4 stay verbatim.** They don't swap axes, so stored
  dimensions can't tell "needs 180°/flip" from "already fine"; rotating
  blindly could break pre-rotated previews. Only the transpose class (5–8)
  is disambiguated by the stored aspect check.
- **Strip EXIF node-side before encoding, not `-strip` after.** sips keeps
  the tag on rotated output (verified: double rotation in browsers); the
  input-side strip is encoder-agnostic and also preserves ICC profiles.
- **Rotation tables verified empirically,** not from memory: every
  magick/sips mapping checked pixel-identical against ImageMagick's own
  `-auto-orient` on EXIF-tagged references (magick RMSE=0, sips at JPEG
  noise floor), plus the real ARW against its upright full preview.

## How verified

- `node …/vitest.mjs run src/thumbs.test.ts` (server) — 25 pass, incl. new
  rotation/sips/tag-strip/pre-rotated/no-encoder/failure/legacy-cleanup
  tests, the 7×3 `orientArgsFor` table, and the versioned-URL route test.
- `node …/vitest.mjs run` (core) — 505 pass, incl. new `jpeg.test.ts` and
  `isPortraitPhoto` tests; full server suite — 89 pass.
- `yarn typecheck` (turbo, all workspaces) — passes.
- Real-file end-to-end with the production toolchain: `ensureThumb` on
  `DSC06308.ARW` yields a 1080×1616 tag-free thumb matching the upright
  full preview (RMSE 0.138, the preview-vs-decode floor); a landscape ARW
  still slices verbatim in ~17ms with no spawn.
- Playwright was not run (per task instructions).
