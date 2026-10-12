# Task 01 — Hide color/ML adjustments in the library view

## Problem

Opening an album grid (library view) still showed the full Inspector —
White Balance, Curves, Auto Enhance, ML face/selective/denoise controls —
even though no photo was in focus. The panel was bound to a stale
`selectedId ?? photos[0]` fallback, so its sliders edited a photo the user
wasn't looking at.

## Root cause

In `apps/web/src/App.tsx` the Inspector mounted whenever the
`inspectorOpen` preference was true, regardless of `view`. There was no
view gate at all.

## Change

- New pure predicate `isInspectorVisible(view, inspectorOpen)` in
  `packages/core/src/inspectorVisibility.ts` (exported from `@f8/core`):
  true only when the panel preference is open AND the view is `editor`.
  Follows the existing core convention for DOM-free view predicates
  (`filmstripScroll.ts`, `libraryUrl.ts`, …).
- `App.tsx` computes `showInspector` once and uses it for both the
  `has-inspector` shell class and the `<Inspector>` mount, so the grid
  reclaims the full width in library view.
- The open/closed preference itself is untouched: toggling the panel in
  the library only flips the preference, and returning to a photo
  restores the panel as it was. No README change (bug fix, no
  architecture change).

## Verification

- `vitest run src/inspectorVisibility.test.ts` in `@f8/core`: 4/4 pass.
- Full `@f8/core` suite: 40 files / 717 tests pass.
- `typecheck` passes for `@f8/core` and `@f8/web` (core rebuilt so web
  picks up the new export).
- Playwright not run (per task-loop rules).
