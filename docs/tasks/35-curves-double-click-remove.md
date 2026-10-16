# Task: Curves point double-click to remove

## Request

Curves point right click to remove doesn't work, just opens browser
right click menu. Double click to remove instead.

## Change

The tone-curve dots in `ToneCurveEditor`
(`packages/ui/src/components/Inspector.tsx`) now remove on
double-click instead of right-click:

- The dot's `onContextMenu` removal handler became an `onDoubleClick`
  handler calling the same `removeCurvePoint` reducer. Double-click is
  safe against the add-on-press gesture: the dot's `onPointerDown`
  stops propagation, so the two presses only grab the dot and never
  drop a duplicate point.
- The double-click handler clears `dragIndex` before removing, so a
  pointer that keeps moving after the removal cannot start dragging a
  neighboring anchor under the stale index.
- A `preventDefault`-only `onContextMenu` stays on the dots so
  habitual right-clicks still try to suppress the browser menu rather
  than removing.
- Tooltip, svg `aria-label`, editor doc comment, and
  `docs/features.md` updated from right-click to double-click
  wording. Keyboard removal (Delete/Backspace/arrows) is unchanged.

## Decisions

- **Kept a menu-suppressing `onContextMenu` instead of deleting the
  handler outright.** The reported bug is that right-click opens the
  browser menu; leaving `preventDefault` in place keeps trying to
  suppress it for users who right-click out of habit, while removal
  moves to the reliable gesture.
- **Clear the drag index in the double-click handler.** The two
  presses of a double-click each set `dragIndex` via the dot's
  pointerdown; without clearing it, a post-removal pointermove would
  call `moveCurvePoint` with the removed index against the shortened
  array and shove a neighbor. `moveCurvePoint` is bounds-safe, but
  the neighbor-drag would still be wrong.
- **Source-pin test, not a jsdom gesture test.** The UI suites render
  with `renderToStaticMarkup` (no jsdom); the new test pins the
  `onDoubleClick` wiring and the tooltip text at the source, following
  the `detailsReset.test.tsx` precedent. The `removeCurvePoint`
  reducer itself is already covered in `toneCurve.test.ts`.

## Tests

- `packages/ui/src/components/curvesPoints.test.tsx`: updated the
  graph tooltip expectation to the double-click wording; added a
  "removes dots on double-click, not right-click" source-pin test.
- UI suite: `yarn workspace @f8/ui test` — all pass. `typecheck`
  clean for `@f8/ui`. No Playwright, per the task rules.
