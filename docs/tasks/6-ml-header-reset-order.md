# Task 6: One reset control left of a clearly on/off ML button

## What changed

Every `AdjustmentSection` header with an ML action (White Balance,
Lightness, Hue & Saturation, Scene Enhance, Enhance Faces, Subject &
Background) now renders the same two-control row: a single reset icon on
the left, the `ML` button rightmost.

- Before, ML sections with defaults (WB/Lightness/Hue) showed three
  controls: `ML`, then the ML revert icon, then a separate defaults
  reset — two icons that both "undo" with unclear precedence. Now one
  icon occupies the left slot: while a pre-ML snapshot exists it is the
  revert icon (`-ml-revert`, restores pre-ML values, including any manual
  edits made before the ML apply); otherwise it is the plain defaults
  reset (`Reset {section}`). Reverting clears the snapshot (existing
  `revertCategoryMl` behavior), so the next click resets to defaults —
  one button, most-specific-undo-first.
- The `ML` button moved to the right end of the row (after the reset
  icon), so it is right-aligned in every ML header.
- The ML on/off state is now readable at a glance. Before, idle and
  applied both used gold text on a near-identical background (only an
  inset shadow differed). Idle is now muted gray (the `.auto-small`
  idle treatment); applied is gold text on a filled gold-brown
  background with a brighter border. `aria-pressed`/`is-active` markup
  is unchanged; this is a restyle of the same state.

Files: `packages/ui/src/components/AdjustmentSection.tsx` (order +
merge), `apps/web/src/index.css` (`.ml-button` idle/active restyle),
`packages/ui/src/components/adjustmentMl.test.tsx` (updated + new
tests). No hook, Inspector, or reset-handler changes: the merge only
chooses which existing callback (`ml.onRevert` vs `onReset`) the one
icon fires.

## Decisions

- When both a snapshot and defaults exist, the single button reverts
  rather than resetting to defaults. Revert restores the user's own
  pre-ML values; defaults would destroy them. The defaults reset
  returns on the next click after the revert clears the snapshot.
- Collapsed headers keep showing the defaults reset (as before) even
  with a snapshot, since the revert icon only renders when open — the
  collapsed heading keeps one icon either way.
- Straighten's Auto + revert row is untouched: it is an `.auto-small`
  button, not an `ML` header button, and task 9 owns straighten UX.

## Tests

- `packages/ui`: all 26 files / 217 tests pass, including the updated
  order test (revert left of ML) and three new tests: snapshot-vs-
  defaults single-control switching, ML-rightmost row shape for all
  three slider sections, and on/off (`is-active` + `aria-pressed`)
  markup. `yarn typecheck` clean. No Playwright (per brief).
