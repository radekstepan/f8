# Task 4: Scene Enhance and Enhance Faces run from header ML buttons

## What changed

The "Scene Enhance" and "Enhance Faces" sections no longer render
full-width bars that repeat the section title (`scene-enhance-apply`,
`face-enhance-detect`). Both actions now run from their section header's
`ML` button — the same shared `AdjustmentSection` `ml` pattern White
Balance, Lightness, and (since task 2) Subject & Background use:

- Idle: header shows an unhighlighted `ML` button (`scene-enhance-ml`,
  `face-enhance-ml`); content shows only the explanatory note. Scene
  keeps its persisted `Portrait · 86% · ML` label once a run stored it.
- Applied: the `ML` button highlights (`is-active`, `aria-pressed="true"`)
  and the header revert icon (`-ml-revert`) appears. Faces content keeps
  the enable toggle, applied summary, Rescan, and Clear exactly as before.
- The header `ML` badges were removed: sections with a header `ML` button
  carry no badge (White Balance precedent), so keeping both would double
  the same affordance in one header.
- The dead `.scene-enhance-row` CSS went with the deleted button row.

Files: `packages/ui/src/components/Inspector.tsx` (section wiring +
both controls), `apps/web/src/index.css` (dead row rules removed),
`packages/ui/src/components/sceneEnhance.test.tsx`,
`packages/ui/src/components/faceEnhance.test.tsx`,
`packages/ui/src/components/mlSections.test.tsx`. No App or hook changes:
`onAutoScene` already toggles (the editor reverts a pure scene run on
re-click), so it satisfies the shared `ml` toggle contract as-is.

## Decisions

- Scene `onToggle` is `onAutoScene` unchanged: the editor's runEnhance
  already reverts when the same mode is pure, which is exactly the
  shared "revert when highlighted, otherwise apply" contract. The
  shared revert icon keeps the last-used-mode behavior (classic vs
  scene), unchanged.
- Faces `onToggle` mirrors Subject & Background exactly: detect when no
  face adjust is stored, clear when one is (`applied ? onClear :
  onDetect`). The highlight means "face adjust stored", not "enabled":
  bypassing via the content toggle keeps the highlight and the revert
  icon. The toggle owns on/off; the header owns detect/clear.
- The faces revert clears the stored masked lift + red-eye discs while
  the skin-anchored white balance stays on its sliders (pre-existing
  `onClear` semantics, kept); the Clear button's tooltip still says so.
- The `Clear` text button was kept alongside the new header revert icon.
  Removing it would shrink discoverability, and revert-button
  consolidation is task 6's scope.
- No README change: no architecture or data-flow change, UI-only.

## Tests

- Rewrote the idle-state tests to pin the header `ML` buttons (testid,
  class, `aria-pressed`, tooltip) and the absence of the content bars,
  the old labels, the badges, and the revert icons.
- New tests: applied states highlight the header `ML` buttons and show
  the revert icons with their labels/titles; pinned
  highlight-kept-while-bypassed in the faces toggle test.
- Updated the five `mlSections` tests (badge-or-button headers, pure
  enhance highlight, revert placement, flex-row CSS, header-button
  actions).
- `yarn workspace @f8/ui test`: 212 passed (26 files).
- `yarn typecheck`: all packages pass. `yarn test`: all 5 tasks pass
  (one transient core failure on the first run; core is untouched and
  green standalone and on re-run).
