# Task 09 — Fast RAW album scrolling (embedded thumbs + virtualized grid)

## Finding

Scrolling an album of RAWs was slow for two compounding reasons, both
confirmed in the code:

1. Every grid cell loaded a full-resolution image. The server sets both
   `src` and `thumbnail` to `/api/photos/:id/file`
   (`apps/server/src/app.ts` `toApiPhoto`), which for RAW serves the
   multi-megabyte full-res LibRaw decode — and the grid rendered
   `photo.src` at that. Dozens of cells = dozens of multi-MB downloads.
2. The grid rendered every photo in the album with no windowing
   (`PhotoBrowser` mapped all `photos`), so off-canvas items still paid
   layout + decode cost, and cells popped in "cutoff" as huge images
   streamed in. Back-nav from the editor also remounted the grid at
   scroll-top, losing the user's place.

## What I did

- `packages/core/src/tiffThumb.ts` (new) — `extractEmbeddedJpeg(bytes)`:
  pure, dependency-free TIFF scan (II/MM, IFD chain + SubIFDs, tags
  513/514 and old-style-JPEG single strips, strict SOI/EOI validation,
  fully bounds-checked, never throws, returns a copy). Verified on real
  Sony ARW files: 1616×1080 preview (~350 KB) sliced from a 24.8 MB RAW
  in ~1 ms.
- `packages/core/src/virtualGrid.ts` (new) — `computeGridWindow(...)`:
  pure row-window math (visible rows + overscan, spacer heights that
  conserve total grid height, overscroll/edge clamping, full-list
  fallback without a measurement).
- `packages/core/src/index.ts`, `raw.ts` — export the new modules;
  clarified the "no embedded-JPEG fallback" comment (still true at
  import; embedded bytes are now used for grid thumbs).
- `apps/server/src/thumbs.ts` (new) — `ensureThumb(...)`: lazy,
  best-effort, cached by hash as `<hash>-thumb.jpg`. RAW thumbs are
  the embedded preview (no subprocess); rendered originals are
  downscaled to 640 px long-edge via magick/convert/sips (injectable
  deps). Any failure resolves to null — never throws.
- `apps/server/src/app.ts` — new `GET /api/photos/:id/thumb`
  (immutable caching; falls back to the display bytes so it never 404s
  a photo `/file` would serve); `thumbnail` now points at `/thumb`
  for file rows (editor keeps full-res `src`); DELETE removes the
  cached thumb too. `AppContext` gains injectable `thumbDeps`.
- `apps/server/src/raw-decode.ts` — export `defaultToolDeps` for the
  production thumb route.
- `apps/server/src/fixtures.ts` — test context accepts `thumbDeps` and
  defaults to no-encoder (route tests never touch system binaries).
- `packages/ui/src/components/PhotoStrips.tsx` — `PhotoBrowser` now
  renders `photo.thumbnail` with `decoding="async"`, virtualizes to
  the viewport + 3 overscan rows (measured columns/row-height/gap from
  the live grid, spacer divs preserve scrollbar + height), and
  remembers scroll per list identity (`scrollKey`) in memory +
  sessionStorage, revealing `activeId` when no position is saved.
- `apps/web/src/App.tsx` — passes
  `scrollKey={collection|search|edited|favorited|reversed}` and
  `activeId={photo?.id}` to the grid.
- `apps/web/src/index.css` — `.grid-spacer` (full-width spacer rows)
  and a neutral `.browser-photo-image` background so loading cells
  don't flash (aspect-ratio boxes already prevent layout shift).

No new dependencies (a hand-rolled windower instead of
react-window/virtuoso — same behavior, no install weight). Import
flow untouched: thumbs generate lazily on first view and backfill
existing libraries.

## Files changed

- `packages/core/src/tiffThumb.ts` (new), `tiffThumb.test.ts` (new)
- `packages/core/src/virtualGrid.ts` (new), `virtualGrid.test.ts` (new)
- `packages/core/src/index.ts`, `packages/core/src/raw.ts` (comment)
- `apps/server/src/thumbs.ts` (new), `thumbs.test.ts` (new)
- `apps/server/src/app.ts`, `raw-decode.ts`, `fixtures.ts`
- `packages/ui/src/components/PhotoStrips.tsx`
- `apps/web/src/App.tsx`, `apps/web/src/index.css`
- `docs/tasks/09-raw-scrolling-virtualize.md` (this report)

## Tests added/run with results

- Core `tiffThumb.test.ts` (+7): old-style-JPEG strip, big-endian +
  513/514, SubIFD largest-wins, no-retain copy, null cases, magic/
  bounds rejection, hostile structures. Pass.
- Core `virtualGrid.test.ts` (+5): fit/unmeasured/empty, mid-list
  window, edge clamps, height conservation, hostile inputs. Pass.
- Server `thumbs.test.ts` (+9): RAW slice + cache, RAW-without-
  preview null, rendered downscale args + tmp cleanup, no-encoder
  null, encoder-failure null, `/thumb` serves embedded bytes with
  immutable cache, rendered thumb + fallback, 404 parity with
  `/file`, DELETE removes the thumb. Pass.
- Full suites: core 26 files / 476 tests pass; server 8 files /
  65 tests pass. `yarn typecheck` passes for all 4 packages (core
  rebuilt to `dist` before the server run).
- Web/UI have no unit-test runner, so the grid component wiring is
  covered by typecheck plus the core-tested window math — no
  component test added.
- Real-binary spot checks: embedded preview extracted from 4 Sony
  ARWs (1616×1080, ~1 ms); `ensureThumb` through the real encoder
  produced a 428×640 JPEG with clean tmp. A live-server check was
  blocked by the sandbox (listening sockets denied); route wiring
  is covered by the `app.request` integration tests instead.

## How to verify

1. `yarn dev`, open an album of RAWs: grid cells show in one pass
   from KB-sized `/thumb` responses (Network tab), scroll smoothly
   with no cutoff pop-in, and only viewport rows exist in the DOM.
2. Open a photo, go back (G or browser back): the grid restores the
   exact scroll position; reload restores it too.
3. First view of an old library backfills `data/previews/*-thumb.jpg`
   on demand; deleting a photo removes its thumb; the editor still
   loads full resolution.

## Unresolved items

- CR3 / ISO-BMFF RAWs have no TIFF structure, so the scan returns
  null and `/thumb` falls back to the full preview for those files
  (correct, just not yet fast). A `dcraw_emu -e` or parser fallback
  could cover them.
- Machines without magick/convert/sips get no downscaled thumbs for
  rendered originals (fallback to the original, i.e. today's
  behavior). Changes left uncommitted.
