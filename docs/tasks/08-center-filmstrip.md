# Task 08 — Center active photo in footer filmstrip

## What changed

- `packages/core/src/filmstripScroll.ts`
  - New `FilmstripCenterIntent` (current/viewport/content/item geometry,
    item edges in list content coordinates) and `FilmstripScrollOffset`.
  - New `filmstripCenteredScrollOffset(intent)`: pure, DOM-free reveal
    math following the existing helper conventions:
    - Horizontal: centers the item (`itemCenter - viewport/2`), clamped
      to `[0, scrollWidth - clientWidth]` so edge items pin to the
      start/end instead of exposing empty space. Always recenters, like
      `scrollIntoView({ inline: 'center' })`, even when already visible.
    - Vertical: nearest-row reveal, like `block: 'nearest'`: rows above
      align their top, rows below align their bottom, visible rows stay
      put, clamped to the content end.
    - Axes without overflow (shared 1px `filmstripOverflows` tolerance)
      or with a non-positive viewport keep the current offset.
  - Re-exported automatically via `index.ts` (`export *`).
- `packages/ui/src/components/PhotoStrips.tsx` (`Filmstrip`)
  - The `selectedId` effect no longer calls `scrollIntoView({ block:
    'nearest', inline: 'nearest' })` (which landed opened photos at the
    right edge). It measures the list/item with `getBoundingClientRect`,
    converts to content coordinates, and applies one computed `scrollTo`.
  - Reduced-motion handling unchanged: the same `matchMedia`
    (`prefers-reduced-motion: reduce`) check picks `behavior: 'auto'`
    vs `'smooth'`.
  - Keyboard nav keeps `scrollIntoView({ block: 'nearest', inline:
    'nearest' })`: focus steps are incremental, not explicit jumps, so
    minimal scrolling stays correct there.
- Tests: `packages/core/src/filmstripScroll.test.ts` gains 7
  `filmstripCenteredScrollOffset` cases (middle centering, recenter when
  visible, start/end clamps, no-overflow/tolerance/zero-viewport holds,
  vertical above/below reveal, visible-row hold, vertical end clamp).

## Decisions

- **Computed offset over `inline: 'center'`.** A one-line `inline:
  'center'` would fix the reported symptom, but the repo convention
  keeps filmstrip scroll math as pure, unit-tested core helpers (tasks
  03/07); the computed `scrollTo` also settles both axes in one call
  instead of stacking two smooth scrolls.
- **Always recenter horizontally.** Opening a photo is an explicit jump,
  so the strip settles with neighbors visible on both sides — the
  point of the request ("easy to see if there are other photos after
  it"). Vertical stays nearest-only so opening a photo in an already
  visible row never jumps the rows.
- **Rect-based measurement, not `offsetLeft`.** The list has no
  positioned-ancestor guarantee, so `offsetLeft` chains are fragile;
  `itemRect - listRect - clientLeft/Top + scroll` is exact in content
  coordinates (verified: `.filmstrip-list` carries no border, only 1px
  padding, so residual error is sub-pixel).
- **Wrapping-rows note (task 03 interaction).** The wrapped strip's real
  overflow is vertical (`overflow-x: hidden`), so horizontal centering
  is mostly a no-op there by design and the vertical nearest reveal
  does the work; the horizontal branch still covers the narrow-viewport
  single-row case where `overflow-x: hidden` content remains
  programmatically scrollable.

## How verified

- `vitest run src/filmstripScroll.test.ts` (core) — 26 pass (19 old + 7 new).
- Full core suite — 30 files / 533 tests pass.
- UI suite — 3 files / 18 tests pass (unaffected).
- `yarn typecheck` in `packages/core` and `packages/ui` — pass (after
  rebuilding core `dist`, which UI resolves `@f8/core` through; `dist`
  is git-ignored, not committed).
- Playwright was not run (per task instructions).
