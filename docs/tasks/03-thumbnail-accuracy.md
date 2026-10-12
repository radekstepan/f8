# Task 03 — Album thumbnail accuracy

## Finding

Thumbnails showed the **original photo**, not the latest edits.

- `PhotoBrowser` (album grid) rendered `<img src={photo.src}>` with no style.
- `Filmstrip` rendered `<img src={photo.thumbnail}>` with no style.
- Both already received `LibraryPhoto` objects carrying the persisted `edit`
  recipe (`App.tsx` passes `filteredPhotos`), but never read it.
- The editor canvas (`PhotoCanvas`) renders the full pipeline
  (`geometryCanvas` → `renderAdjustedCanvas` → `drawEffects`), so the grid
  visibly disagreed with the canvas for any edited photo.

## Fix

Apply the codebase's existing thumbnail approximation — `getPhotoFilter`,
whose own doc comment says it exists "for small thumbnails" — to both views.

- `packages/core/src/image.ts`: new `thumbnailFilterForPhoto(photo, liveEdit?)`.
  Live session edit wins over the persisted recipe; returns `undefined` when
  the look matches the original (including geometry-only edits, which have no
  CSS equivalent), so unedited thumbs keep a plain `<img>` with no style cost.
- `packages/ui/src/components/PhotoStrips.tsx`: `PhotoBrowser` and `Filmstrip`
  accept optional `edits?: Record<string, EditState>` and set
  `style={{ filter }}` per photo; new `PhotoWithEdit` prop element type.
- `apps/web/src/App.tsx`: builds `liveEdits` from `editor.histories` and
  passes it to both views, so thumbs match the canvas immediately instead of
  lagging the 500 ms save debounce.

Deliberately unchanged: `PresetStrip` (each thumb previews a *candidate*
preset — by design), sidebar album covers (static URL snapshot), and
`PhotoBrowser` using `photo.src` instead of `photo.thumbnail` (perf, task 09).

## Known limitation

Geometry (crop, rotation, straighten, flips) and repair strokes are
full-pipeline effects with no CSS equivalent, so a rotated/cropped-only photo
still thumbs as unrotated/uncropped. Same documented trade-off as the preset
strip and export preview. A CSS `transform` rotation was rejected: thumbs live
in fixed-aspect `object-fit: cover` boxes, so a 90° turn would clip/overflow.

## Tests

- Added `packages/core/src/image.test.ts` (7 tests): no edit → undefined,
  default → undefined, geometry-only → undefined, B&W/exposure/color reflected,
  live-beats-saved precedence, live reset clears stale look.
- `packages/core` full suite: 22 files, 445 tests, all pass.
- `yarn typecheck`: all 4 workspaces pass (one TS2559 weak-type error found and
  fixed via the `PhotoWithEdit` prop type).
- No component test: `@photomator/ui` has no test runner (no vitest/jsdom);
  the selection logic is covered in core where it lives.

## How to verify

1. `yarn dev`, open a photo, apply Black & White or strong exposure.
2. Press G (library grid) and check the filmstrip: the thumb now shows the
   edited look (compare against main canvas).
3. Reset the photo: thumbs return to the original with no inline `style`.

## Unresolved

- None for this task. Follow-ups owned elsewhere: grid uses full-res `src`
  (task 09), album covers never refresh after edits.
