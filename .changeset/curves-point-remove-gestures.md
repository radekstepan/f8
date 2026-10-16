---
'@f8/ui': patch
---

Curves points now remove on Shift-click or right-click instead of double-click: the double-click handler never fired because the drag captures the pointer to the graph element, which retargets the follow-up double-click event there. Removal now runs on the press itself (exact hits and near-misses within the grab radius), a right press on empty graph no longer drops a stray point, and the browser context menu stays suppressed over the graph. Keyboard removal with Delete/Backspace is unchanged.

## Task writeup (docs/tasks/46-curve-point-remove.md)

Task: double click on a point on a curve doesn't remove it. Try with
right click overriding the browser right click menu. If it doesn't work
then let's go with Shift click to remove.

## Summary

Third round on the same gesture (after `25-curves-reset-points.md` and
`34-curves-double-click-remove.md`), so this pass fixes the mechanism
instead of swapping gestures again. Both prior failures share one root
cause: the dot's `onPointerDown` captures the pointer to the svg
element (`svgRef.current?.setPointerCapture`), and while capture is
held the compatibility mouse events (`dblclick`, `contextmenu`) are
retargeted to the capture element — the svg, not the dot. So the
dot-level `onContextMenu` removal (original report: "just opens the
browser menu") and the dot-level `onDoubleClick` removal (this report:
"doesn't remove it") never fired.

Fix in `ToneCurveEditor` (`packages/ui/src/components/Inspector.tsx`):
removal now runs on the press itself, which always hits the dot before
any capture exists:

- Dot exact hit: `Shift`-click or right-button (`button === 2`) press
  calls `removeCurvePoint` and returns before any drag or capture
  starts (drag index cleared, mirroring the dblclick handler).
- Svg near-miss: the same press hit-tests the generous 12-unit grab
  radius and removes that anchor — or no-ops. A right press on empty
  graph previously fell into the add path and dropped a stray point;
  that can no longer happen.
- Menu suppression: the dot keeps its `preventDefault`-only
  `onContextMenu`, and the svg gains one as a backstop for
  near-misses. Removal presses return before `setPointerCapture`, so
  the follow-up `contextmenu` still targets the pressed node and the
  suppression actually lands.
- Tooltip, svg `aria-label`, editor doc comment, and
  `docs/features.md` updated to the Shift-click/right-click wording.
  Keyboard removal (Delete/Backspace/arrows) is unchanged, and the
  `onDoubleClick` removal stays as a harmless unadvertised fallback.

## Files changed

- `packages/ui/src/components/Inspector.tsx` — pointerdown-level
  Shift-click/right-click removal on the dot and the svg, svg-level
  `contextmenu` suppression, tooltip/aria/comment rewording.
- `packages/ui/src/components/curvesPoints.test.tsx` — tooltip +
  aria-label markup expectations updated; the "double-click, not
  right-click" source-pin test rewritten to pin the new wiring
  (dot branch, svg hit-test branch, removal-before-capture order,
  svg menu suppression, retained dblclick fallback).
- `docs/features.md` — tone-curve bullet reworded to the new
  gestures.
- `docs/tasks/46-curve-point-remove.md` — this writeup.
- `.changeset/curves-point-remove-gestures.md` — patch changeset for
  `@f8/ui` (written manually in `yarn changeset` format; the CLI is
  interactive).

No `README.md` update: gesture fix, no architectural or
structural change. No Playwright, per the task rules.

## Decisions

- **Both gestures, not right-click-only.** The task names right-click
  as the attempt and Shift-click as the fallback. Both ride the same
  pointerdown branch (one condition), and since browser behavior
  cannot be verified here (no Playwright per the rules), shipping the
  sanctioned fallback alongside the primary guarantees a working
  removal gesture either way. Cost is one `shiftKey` check plus test
  pins.
- **Remove at pointerdown, not on contextmenu.** Handling removal in
  `onContextMenu` would repeat the original failure: the event
  targets the dot only when no capture is active. Removal on the
  press is deterministic, and the menu only needs suppression, which
  the dual-level `preventDefault` handlers provide.
- **No capture on removal presses.** Returning before
  `setPointerCapture` keeps `contextmenu` targeting natural (dot for
  exact hits, svg for near-misses), which is what makes both
  suppression handlers effective. The ordering is pinned in the test
  so a future refactor cannot silently re-capture first.
- **Right press on empty graph is a no-op, never an add.** Previously
  any button (including right) on empty graph added a point — so a
  right-click that missed the 4.5-unit dot added a duplicate AND
  opened the menu. The `button === 2` branch returns without adding,
  matching the `event.button !== 0` guard precedent in
  `PhotoCanvas.tsx` (minimap drag).
- **Svg removal uses the grab radius, not exact hits.** Near-misses
  within 12 svg units remove the anchor via `hitAnchor`, fixing the
  "missed the tiny dot" failure mode for both gestures.
- **Kept `onDoubleClick` removal unadvertised.** It is a proven no-op
  on desktop (same retargeting), but removing it is extra churn with
  no behavior gain, and it may still fire where dblclick dispatches
  to the dot. The test pins its retention so the decision is
  explicit.
- **Source-pin test, not a jsdom gesture test.** Same constraint as
  task 34: the UI suites render with `renderToStaticMarkup` (no
  jsdom), so gesture wiring is pinned at the source following the
  `detailsReset.test.tsx` precedent. The `removeCurvePoint` reducer
  itself is already covered in `toneCurve.test.ts`.

## Test evidence

- `yarn workspace @f8/ui test src/components/curvesPoints.test.tsx` —
  8/8 pass (updated file).
- `yarn workspace @f8/ui test` — full suite 580/580 pass.
- `yarn workspace @f8/ui typecheck` — clean.
- `yarn workspace @f8/web typecheck` — clean.
- Not run: Playwright (forbidden by task instructions).
