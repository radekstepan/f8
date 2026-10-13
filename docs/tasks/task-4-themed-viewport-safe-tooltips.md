# Task 4 — Themed viewport-safe custom tooltips

## Problem

Every hint in the app was a native `title` attribute: OS-styled (no
theme match), clipped by the viewport with no flipping, and with no
control over timing or placement.

## What changed

New custom tooltip library in `packages/ui/src/components/Tooltip.tsx`
(hand-rolled, no dependency — the app needs one themed bubble, not a
positioning engine):

- Triggers carry `data-tooltip="..."` (optional
  `data-tooltip-placement="top|bottom"`); a single `<TooltipHost/>`
  mounted in `apps/web/src/App.tsx` (main shell + all three library
  gates) listens via delegation and portals one bubble to `<body>`.
- `positionTooltip()` (pure, no DOM) centers the bubble on the trigger,
  prefers top, flips to the other side on overflow, and clamps both
  axes into the viewport with an 8px padding + 8px gap — so a tooltip
  can never be cut off. Two-pass render (measure, then place before
  paint) avoids a first-frame flash.
- Hover dwells 350ms like a native tooltip; keyboard focus shows
  immediately; Escape / scroll / resize / pointer-down hides (the
  bubble is fixed-positioned, so it hides instead of chasing).
- `Tooltip` wrapper + `tooltipProps()` helper for triggers that cannot
  carry props themselves. Server render is null — SSR markup keeps
  only the `data-tooltip` attributes.
- `apps/web/src/index.css`: `.f8-tooltip` themed after
  `.dropdown-menu` (same `#303033f5` panel, `#515157` border, shadow),
  `z-index: 300` (above modal/toast/marquee), 260px max-width with
  wrapping, fade-in, `prefers-reduced-motion` support, and the
  inline-flex `.tooltip-anchor`.

Migration (native `title` → `data-tooltip` on every host element):

- `EditorUI.tsx` (IconButton, Toggle, RangeControl slider + value
  hint, SegmentedControl, MlBadge), `AdjustmentSection.tsx` (ML/Auto
  action), `Topbar.tsx` (backlink, tool buttons, vision indicator),
  `Inspector.tsx` (~30 triggers incl. transform buttons),
  `PhotoStrips.tsx` (presets, filmstrip, filter chips, search note,
  cull badges), `PhotoCanvas.tsx` (rating, dimensions, compare),
  `EditorDialogs.tsx` (label button, file path), `FsBrowser.tsx`.
- Remaining `title=` attributes are heading props only (`Modal`,
  `AdjustmentSection`, `PhotoBrowser`, `FsBrowser`) — the new test
  file sweeps all component sources and fails on any native tooltip
  added back.
- Tooltip-feeding identifiers renamed `title` → `hint` for
  coherence: `SegmentedOption.title`, `AdjustmentMl.title` (+ the
  Denoise/Removal/DustSpots override locals), the filter-chip param.
- Crop transform buttons gained `aria-label`s (they previously had
  only a tooltip as their accessible name); the two Playwright specs
  using `getByTitle("Rotate left 90 degrees")` now use
  `getByRole("button", { name: ... })`. Not run (no Playwright).
- `packages/ui/src/components/Tooltip.test.tsx` (new, 29 tests):
  positioning math (center/flip/clamp/wide-bubble/tiny-viewport/
  custom gap), `tooltipProps`, trigger markup pins (incl. Toolbar),
  host SSR null + wrapper markup, the no-native-title source sweep,
  and CSS theme pins. Existing tooltip assertions updated
  `title=` → `data-tooltip=` (19 files).
- `README.md`: one project-map row for the new shared library.

Verified: `yarn workspace @f8/ui test` — 51 files / 409 tests pass;
`typecheck` clean for `@f8/ui` and `@f8/web` (after rebuilding the
ui `dist`, which web typechecks against).

## Decisions

- `data-tooltip` + one delegated host instead of per-trigger
  components or floating-ui: a one-word-per-site migration, one
  positioning implementation to verify, zero new dependencies, and
  future tooltips work by adding an attribute.
- No `title` fallback kept: keeping both would double-render (native
  + custom) in the browser. Accessible names were already on
  `aria-label` everywhere except the transform buttons, which got
  them now.
- No jsdom behavior tests: the repo tests SSR markup + pure logic in
  node; host hover/focus timing is intentionally left to the
  positioning unit tests plus the Playwright suite.
