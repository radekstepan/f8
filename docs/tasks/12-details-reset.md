# 12 — Details gains its header reset

## Request
"Why does adjust Details not have a reset button???"

## Previous state
Details was the last slider section without a header reset. Task 3 gave
resets to White Balance / Lightness / Hue & Saturation / Curves /
Effects but explicitly deferred Details to this task; Task 11 then
removed Details' duplicate header toggle and converged it onto the
self-managed Curves/Effects disclosure shape, leaving `onReset` + `dirty`
as the only missing wiring.

## Change
- `packages/ui/src/components/Inspector.tsx`
  - Details passes `onReset={() => onChange({ clarity: 0, sharpness: 0,
    grain: 0 })}` and `dirty={edit.clarity !== 0 || edit.sharpness !== 0
    || edit.grain !== 0}` — byte-for-byte the Curves/Effects shape.
    No `AdjustmentSection` or CSS change: the shared Task 10 gate
    (`onReset` set AND non-default) renders the persistent
    `section-reset is-dirty` control, and clean Details renders no reset
    at all.

## Tests
- New `packages/ui/src/components/detailsReset.test.tsx` (repo
  convention: server-rendered, no jsdom):
  - clean Details renders no reset in its slice (bounded by the Details
    and Effects headings);
  - each of `clarity`/`sharpness`/`grain` dirty persists the reset;
  - the dirty reset stays in the header while collapsed (Details starts
    collapsed);
  - legacy-disabled at defaults counts as clean, disabled-but-dirty
    still resets (the Task 3 values-alone convention);
  - dirty Details renders no other section's reset (aria-label absence);
  - source-level pin that `dirty` mirrors exactly the keys the reset
    restores (the `collapsePanels.test.tsx` precedent) — the reset can
    never get stuck on.
- Updated to the Details-reset contract: `resetPerAdjustment` (defaults
  absence list, 14-key dirty matrix becomes 17-key with the three
  Details keys, Details/Denoise test now asserts the persistent Details
  reset), `singleResetIcon` (all-dirty sweep gains Details; collapsed
  one-icon check covers Curves/Details/Effects),
  `detailsToggle` (test title drops the "reset arrives in Task 12"
  wording).
- Full `@f8/ui` suite (34 files / 272 tests) passes; `@f8/ui` and
  `@f8/web` typechecks pass (`ui` dist rebuilt first — web resolves
  `@f8/ui` from dist); lint is an unconfigured no-op echo. No
  Playwright (per task rules).

## Decisions
- `dirty` reads values alone, not `detailsEnabled`: the reset patch does
  not touch the flag (same as White Balance / Lightness / Hue &
  Saturation), so including it would let the reset get stuck on. A
  legacy-disabled-but-default recipe counts as clean, matching Task 3.
- No README update: header-control completion on the converged uniform
  contract, no architecture or feature-surface change.
