# Task 10 — Album footer filmstrip cutoff + not scrollable

## Finding

The editor footer (`Filmstrip` in `packages/ui/src/components/PhotoStrips.tsx`,
styled in `apps/web/src/index.css`) had two compounding defects, both
confirmed by reading the component and CSS:

1. **Cutoff.** `.filmstrip` was a fixed `height: 112px` box with
   `overflow: hidden`, sized to *exactly* fit its content
   (32 px heading + 58 px thumbs + filename + paddings ≈ 111 px), so any
   font/rounding variance clipped the bottom. Worse, `.filmstrip-filename`
   had no `white-space: nowrap`: any name too long for the 91 px item
   wrapped to a second line and was cut off by the fixed box.
2. **Not scrollable.** `.filmstrip-list` is a horizontal scroller with a
   fully hidden scrollbar (`scrollbar-width: none`, `display: none`), and
   nothing translated input: a plain mouse wheel carries only a vertical
   delta, which did nothing over the strip, and arrow keys didn't move
   between items. Touchpad horizontal swipe was the only way to reach
   photos past the visible edge.

## What I did

- `packages/core/src/filmstripScroll.ts` (new) — pure, DOM-free helpers in
  the `canvasPan.ts` style: `filmstripWheelShift(intent)` (vertical-dominant
  wheels translate to horizontal px; zoom chords, horizontal-dominant
  gestures, and non-overflowing strips return 0 = native handling; line and
  page `deltaMode`s scaled) and `filmstripArrowIndex(key, current, count)`
  (ArrowLeft/Right/Home/End focus math, -1 = leave focus alone).
- `packages/core/src/index.ts` — export the new module.
- `packages/ui/src/components/PhotoStrips.tsx` — `Filmstrip` gains a
  non-passive `wheel` listener that applies `filmstripWheelShift` to
  `scrollLeft` (Ctrl/Meta zoom chords untouched), an `onKeyDown` that walks
  focus through items with `filmstripArrowIndex` (focus scrolls each item
  into view), and a `prefers-reduced-motion` check for the smooth
  selection scroll.
- `apps/web/src/index.css` —
  - `.filmstrip`: `height: 112px` → `min-height: 112px` (same in the
    short-viewport query: 101 px), so the box fits content instead of
    clipping it; rendered height is unchanged when content fits.
  - `.filmstrip-filename`: single line with `line-height: 1.25`,
    `white-space: nowrap`, ellipsis truncation (full name still on `title`).
  - `.filmstrip-list`: explicit `overflow-y: hidden` (single-axis scroll,
    no vertical trap). Scrollbar stays visually hidden by design — edge
    cut-off thumbs are the scroll affordance; no hover-scrollbar layout
    shift introduced.

## Tests

- Added `packages/core/src/filmstripScroll.test.ts`: 10 tests covering
  wheel translation, horizontal-dominance passthrough, zoom-chord and
  no-overflow no-ops, line/page delta scaling, arrow stepping, end
  clamping (no wrap), Home/End, and ignored keys/empty-row/outside-focus.
- No component/e2e test added: the repo has no DOM test env (no
  jsdom/happy-dom) and no Playwright browsers installed, so neither is
  runnable here; adding an unverifiable e2e spec would risk breaking CI.
- Ran: `yarn workspace @photomator/core build` (so `@photomator/ui`
  resolves the new export), `yarn workspace @photomator/core test` —
  **27 files / 486 tests pass, including the 10 new ones** — and
  `typecheck` for `@photomator/core`, `@photomator/ui`, `@photomator/web`:
  **all pass**. Full-suite scope beyond core was not run (touched scope +
  typechecks only).

## How to verify

1. Open an album with more photos than fit the footer width.
2. Hover the filmstrip and roll a plain mouse wheel: the row scrolls
   horizontally; pinch-zoom / Shift+wheel still behave natively.
3. Click a thumb, then use Left/Right/Home/End: focus walks the row and
   off-screen items scroll into view.
4. Check long filenames: single truncated line with ellipsis, nothing
   clipped below; selecting the last photo auto-scrolls it into view.

## Unresolved

- Extremely short windows (< ~500 px tall) can still bottom-clip the
  footer: `.photo-workspace` keeps `min-height: 170px` while the strips
  are `flex-shrink: 0` inside an `overflow: hidden` column. Relaxing the
  canvas minimum changes canvas measuring, so it was left alone.
- Focus-ring tips at the strip's top edge can clip by ~1 px
  (`outline-offset: 3px` vs 1 px list padding) — cosmetic, pre-existing,
  untouched.
