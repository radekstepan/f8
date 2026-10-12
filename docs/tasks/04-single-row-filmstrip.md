# Task 04 — Footer filmstrip is always a single centered row

## Problem

The footer strip below the main photo wrapped its thumbnails into
multiple rows (`flex-wrap: wrap` with vertical scroll) and grew up to
`min(280px, 34vh)`, stealing space from the photo and hiding neighbors
below the fold.

## Change

- `apps/web/src/index.css`: `.filmstrip-list` is now
  `flex-wrap: nowrap` with `overflow-x: auto; overflow-y: hidden`, so
  the footer is always one horizontal row; the `.filmstrip` container
  lost its multi-row `max-height` cap since it can no longer grow.
- Centering on navigation was already implemented
  (`filmstripCenteredScrollOffset` + a `scrollTo` effect on
  `selectedId` in `Filmstrip`) and is kept: the opened photo lands in
  the middle of the viewport (clamped at both ends) with older and
  newer photos visible on either side. Comments updated to the
  single-row wording.
- `packages/ui/src/components/PhotoStrips.tsx`: keyboard nav simplified
  from the wrapped-grid helper to the linear `filmstripArrowIndex`
  (Left/Right/Home/End; Up/Down hold), and the now-unused
  `firstRowCount` offsetTop measurement removed. The wheel handler no
  longer measures vertical overflow — a single row only ever scrolls
  sideways.
- `packages/core/src/filmstripScroll.ts`: docs updated to the single-row
  layout; no behavior change. `filmstripGridArrowIndex` is kept
  (exported, tested) for grid-style callers.
- New `packages/ui/src/components/filmstripSingleRow.test.tsx`: pins the
  `.filmstrip-list` stylesheet rule (nowrap, horizontal scroll), the
  footer having no row-growth cap, the single-list SSR markup with the
  selection marked, and linear arrow-key wiring. No README change (bug
  fix, no architecture change).

## Verification

- New UI test file: 5/5 pass.
- Full `@f8/ui` suite: 88 pass; full `@f8/core` suite: 722 pass.
- `yarn typecheck`: 6/6 tasks pass.
- Playwright not run (per task-loop rules).
