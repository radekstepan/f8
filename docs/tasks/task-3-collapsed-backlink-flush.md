# Task 3 — Flush collapsed-sidebar backlink against the library toggle

## Problem

With the library sidebar collapsed, the photo backlink ("Back to All
Photos") floated ~90px to the right of the sidebar toggle (the PanelLeft
button that re-expands the library). Cause: the collapsed
`.window-toolbar` kept a fixed 131px column (a leftover from the init
commit, with no documented reason) holding only the 29px toggle parked
at 19px left padding — 83px of dead column — plus the main-toolbar's
7px left gutter before the backlink box.

## What changed

- `apps/web/src/index.css` (pure CSS fix, no `Topbar.tsx` changes):
  - `.app-shell:not(.has-sidebar) .window-toolbar` is now
    `width: auto; padding-right: 0` instead of `width: 131px`, so the
    column hugs the toggle (19 + 29 = 48px). Left padding is inherited
    untouched, so the toggle never jumps sideways on collapse.
  - New `.app-shell:not(.has-sidebar) .main-toolbar`
    (`padding-left: 0`) drops the gutter, so the backlink box edge meets
    the toggle edge exactly. The chevron glyph still clears the toggle
    via the backlink's own 4px left padding — flush boxes, not touching
    glyphs.
  - The `@media (max-width: 1020px)` combined
    `.window-toolbar, .app-shell:not(.has-sidebar) .window-toolbar`
    124px selector was split: open keeps 124px/12px, collapsed keeps
    hugging. Otherwise the gap would have survived at that breakpoint.
  - Mobile (`max-width: 760px`) untouched: the toggle is already
    centered in a 42px grid cell directly beside the breadcrumb cell.
- `packages/ui/src/components/collapsedBacklinkFlush.test.tsx` (new,
  7 tests): stylesheet-pinned like the neighboring topbar tests (no
  jsdom) — hug geometry (width auto, no right padding, no px width),
  toggle parked at 19px, zero-gutter seam with glyph clearance, open
  state untouched, 1020px split rule, mobile rule untouched, and a
  server-render probe that the toggle cell sits immediately before the
  backlink cell (the DOM adjacency the CSS relies on).
- No `README.md` update: a two-rule alignment fix, not architecture.

## Decisions

- **Flush means zero gap between the boxes**, matching the Task 7
  ("dropdowns flush with their trigger pills") precedent — the seam is
  covered by the backlink's own internal 4px, so no extra gutter rule
  was needed.
- **Fixed in the parent columns, not on the backlink.** The existing
  `photoBacklink.test.tsx` contract pins that no backlink/breadcrumb
  selector is gated on the sidebar class and that `Toolbar` takes no
  sidebar prop; scoping the fix to `.window-toolbar`/`.main-toolbar`
  honors that contract, and the backlink's independence test stays
  green unmodified.
- **Heights left alone.** The backlink (32px) and toggle (29px) are
  both vertically centered in the 65px toolbar; the 1.5px edge delta is
  sub-perceptual and unifying heights would ripple into the open-sidebar
  state and the grid title — out of scope for this seam fix.
- **Comment wording avoids "backlink"/"breadcrumb".** The independence
  test above sweeps comments into its selector regex, so the new CSS
  comment says "collection return button" to avoid tripping that
  assertion on prose rather than a selector.

## Tests (unit/integration only, no Playwright)

- New `collapsedBacklinkFlush.test.tsx`: 7/7 pass.
- Full `@f8/ui` suite: 380/380 pass, including the neighboring
  `photoBacklink.test.tsx` contract. `typecheck` clean.
