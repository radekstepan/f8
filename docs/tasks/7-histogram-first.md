# Task 7: Histogram leads the Adjustments panel

## What changed

The histogram is now the first child of the Adjustments scroll region,
ahead of Auto Enhance, the ML sections (Scene Enhance, Enhance Faces,
Subject & Background, Denoise), and all slider sections. Before, it sat
between Denoise and White Balance — mid-panel, after every ML action.

Files: `packages/ui/src/components/Inspector.tsx` (moved the one
`<Histogram>` element from after the Denoise section to the head of the
`tool === 'adjust'` fragment),
`packages/ui/src/components/histogramFirst.test.tsx` (new),
`packages/ui/src/components/denoise.test.tsx` and
`packages/ui/src/components/mlSections.test.tsx` (order assertions
updated to the new contract). No prop, styling, or behavior changes:
the Histogram component itself is untouched.

## Decisions

- Moved the element rather than introducing ordering props or CSS
  `order`: the panel is a static JSX sequence, so source order is the
  ordering mechanism — one move, no new API.
- Updated the two existing "above the histogram" assertions instead of
  deleting them: they still pin the Denoise/ML-group placement, now
  relative to the histogram's new leading position.
- No README change: this is a presentational reorder, not an
  architectural or feature change.

## Tests

- `packages/ui`: all 27 files / 219 tests pass, including the new
  `histogramFirst.test.tsx` (histogram precedes Auto Enhance, all four
  ML sections, and the first three slider sections; histogram is the
  first child of `.inspector-scroll`). `yarn typecheck` clean. No
  Playwright (per brief).
