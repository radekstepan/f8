# Task 9: Auto straighten no longer shifts the Auto button text

## What changed

Applying Auto straighten no longer nudges the Auto button text down ~1px.
Root cause was layout, not the button itself: `.straighten-auto-row` is
`display: flex; align-items: center` with no fixed height, the Auto pill
is 17px tall, and the 19px `.ml-revert` icon only mounts after Auto
applies (`assist.snapshot !== null`). The row therefore grew 17px -> 19px
on apply, and centering dropped the button 1px.

Files: `apps/web/src/index.css` (one declaration — `min-height: 19px` on
`.straighten-auto-row`, plus an explanatory comment),
`packages/ui/src/components/straightenToggle.test.tsx` (new regression
test). No markup, prop, or behavior changes.

## Decisions

- `min-height`, not `height`: reserves the tallest child's height so the
  button sits identically in both states, while multi-line error text can
  still grow the row.
- Matched to the shared `.ml-revert` height (19px) rather than shrinking
  the icon: the icon size is shared with the section headers, where the
  41px heading absorbs it — only this 17px row needed the reservation.
- Test asserts the invariant (`row min-height >= revert height` by parsing
  both rules from `index.css`), following the existing CSS-assertion
  convention in `mlSections.test.tsx`, so a future icon resize fails the
  test instead of silently reintroducing the shift.
- No README change: one-line presentational fix, no architecture change.

## Tests

- `packages/ui`: all 224 tests pass, including the new
  `reserves row height for the revert icon` case in
  `straightenToggle.test.tsx`. `yarn typecheck` clean. No Playwright
  (per brief).
