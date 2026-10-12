# Task 03 — Filmstrip vertical scrollbar on overflow

## Which filmstrip

The footer `Filmstrip` below the photo in the editor view
(`packages/ui/src/components/PhotoStrips.tsx`, `.filmstrip` in
`apps/web/src/index.css`). The album `PhotoBrowser` grid already scrolls
vertically; the footer strip was a single-row horizontal scroller with its
scrollbar hidden, so large albums were a long sideways hunt with no scroll
affordance at all.

## What changed

- `apps/web/src/index.css`
  - `.filmstrip-list` now wraps (`flex-wrap: wrap`) with
    `overflow-x: hidden; overflow-y: auto`, so rows flow downward and a
    vertical scrollbar appears only when content overflows. The
    `scrollbar-width: none` / `::-webkit-scrollbar { display: none }`
    overrides are gone, so the scrollbar is the app-standard thin style
    from the global `*` rule — no new scrollbar styling.
  - `.filmstrip` is a flex column with `max-height: min(280px, 34vh)`:
    280px fits exactly three full rows (heading 32 + 3×72 rows + 2×9 gaps
    + list/section padding), and 34vh shrinks the cap on short viewports
    (a peek of the next row signals scrollability). Few photos render one
    row exactly as before; the heading is `flex-shrink: 0` and the list
    `min-height: 0` so the cap binds the list, not the heading.
- `packages/ui/src/components/PhotoStrips.tsx` (`Filmstrip`)
  - Wheel routing now measures both axes via `filmstripOverflows` and
    passes `canScrollY`: with vertical overflow the wheel scrolls the rows
    natively; the vertical→horizontal translation only fires for a
    single row that overflows horizontally (narrow viewport).
  - Arrow-key nav uses the new `filmstripGridArrowIndex` with a live
    column count (`firstRowCount`: items sharing the first item's
    `offsetTop` ±1px). Left/Right/Home/End behave as before across rows;
    Up/Down step one row in the same column. Focused items still
    `scrollIntoView`, and the `:focus-visible` outline is unchanged.
  - No selector changes (`section.filmstrip`, `[data-photo-id]` intact),
    so e2e locators are unaffected.
- `packages/core/src/filmstripScroll.ts` (+ tests)
  - `FilmstripWheelIntent.canScrollY?` (optional; absent = no vertical
    overflow, so legacy callers keep old behavior).
  - `filmstripOverflows(scrollSize, clientSize)` centralizes the 1px
    sub-pixel tolerance (`FILMSTRIP_OVERFLOW_TOLERANCE_PX`) previously
    inline in the component.
  - `filmstripGridArrowIndex(key, currentIndex, itemCount, columns)`:
    linear keys delegate to `filmstripArrowIndex`; Up/Down step ±columns
    with no wrap, hold on a partial last row without a cell below, and
    hold when columns < 1 (unmeasurable). `filmstripArrowIndex` itself is
    unchanged.

## Decisions

- **Wrap + vertical scroll, not a visible horizontal scrollbar.** A
  horizontal scrollbar would keep the one-photo-wide viewport for large
  albums; wrapping shows ~3 rows at once and matches the task's explicit
  "vertical scrollbar".
- **Cap in px + vh, not rows.** CSS can't cap flex rows directly;
  `min(280px, 34vh)` equals three rows on desktop and degrades to ~two
  rows on short windows without touching the canvas minimum.
- **Keep the wheel-translation path.** It is nearly dead with wrapping
  (horizontal overflow needs a sub-item-width viewport), but it costs one
  branch and preserves behavior where horizontal overflow is still
  possible.
- **Keyboard grid math in core, measurement in the component.**
  `offsetTop` reading stays in the DOM layer; the pure index math is
  unit-tested like the existing helpers (no jsdom in this repo — core
  tests are DOM-free by convention).

## How verified

- `node ../../node_modules/vitest/vitest.mjs run src/filmstripScroll.test.ts`
  (core) — 19 pass, incl. new `canScrollY` routing, `filmstripOverflows`
  tolerance edges, and 6 `filmstripGridArrowIndex` cases (row stepping,
  edge holds, partial last row, linear parity, single-row/unknown-column
  holds, out-of-range focus).
- Full core suite — 29 files / 514 tests pass.
- `yarn typecheck` (turbo, all 4 workspaces) — passes.
- `yarn workspace @f8/web build` — passes; bundled CSS confirmed as
  `.filmstrip-list{…overflow:hidden auto}` with wrap and
  `.filmstrip{…max-height:min(280px,34vh)}`.
- Playwright was not run (per task instructions).
