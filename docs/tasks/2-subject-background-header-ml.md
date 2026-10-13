# Task 2: Subject & Background runs from a header ML button

## What changed

The "Subject & Background" section no longer renders the full-width
"Enhance Subject & Background" bar (`selective-mask-detect`). Segmentation
now runs from the section header's `ML` button — the same shared
`AdjustmentSection` `ml` pattern White Balance and Lightness use:

- Idle (no mask): header shows an unhighlighted `ML` button
  (`selective-mask-ml`, tooltip "Automatically adjust subject &
  background with ML"); content shows only the explanatory note.
- Mask stored: the `ML` button highlights (`is-active`,
  `aria-pressed="true"`) and the header revert icon
  (`selective-mask-ml-revert`, "Revert ML subject & background") appears;
  content keeps the enable toggle, subject/background sliders, Rescan, and
  Clear exactly as before.
- The header `ML` badge was removed: sections with a header `ML` button
  carry no badge (White Balance precedent), so keeping both would double
  the same affordance in one header.

Files: `packages/ui/src/components/Inspector.tsx` (section wiring +
`SelectiveMaskControl` idle state),
`packages/ui/src/components/selectiveMask.test.tsx`,
`packages/ui/src/components/mlSections.test.tsx`. No CSS or App changes.

## Decisions

- Header `onToggle` mirrors White Balance exactly: segment when no mask is
  stored, clear when one is (`applied ? onClear : onDetect`), so the
  shared "ML … applied — click to revert" title stays accurate. Rescan
  stays a content text button (it keeps slider values; the header action
  is segment-or-clear, not rescan).
- The `ML` highlight means "mask stored", not "enabled": bypassing via the
  content toggle keeps the highlight and the revert icon. The toggle owns
  on/off; the header owns segment/clear.
- The `Clear` text button was kept alongside the new header revert icon.
  Removing it would shrink discoverability, and revert-button
  consolidation is task 6's scope.
- No README change: no architecture or data-flow change, UI-only.

## Tests

- Rewrote the idle-state test to pin the header `ML` button (testid,
  class, `aria-pressed`, tooltip) and the absence of the detect bar, the
  old label, the badge, and the revert icon.
- New test: stored mask highlights the header `ML` button and shows the
  revert icon with its label/title.
- Pinned highlight-kept-while-bypassed in the toggle test; updated the
  two `mlSections` tests (badge-or-button headers, no subject detect bar).
- `yarn workspace @f8/ui test`: 206 passed (26 files).
- `yarn typecheck`: all packages pass.
