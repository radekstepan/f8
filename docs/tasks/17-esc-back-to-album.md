# Task 17 — Esc on a photo returns to the album

## Problem

On an open photo, pressing Esc only cleared compare mode and reset the
tool to Adjust — the user stayed on the photo with no keyboard way back
to the album grid.

## Change

- New pure predicate `shouldEscapeToLibrary(view)` in
  `packages/core/src/escapeNavigation.ts` (exported from `@f8/core`):
  true only when the view is `editor`. Follows the `isInspectorVisible`
  precedent so the rule is unit-testable without a DOM.
- `App.tsx` Esc handler now also flips the view to `library` when the
  predicate says so (`view` added to the effect deps). The existing
  compare/tool reset stays, so the next opened photo starts neutral.
- Shortcuts dialog (`EditorDialogs.tsx`) lists the new `Back to album —
  Esc` row under Navigation. No README change (small UX fix, no
  architecture change).

## Decisions

- Unconditional navigation in the editor (not "first Esc exits compare,
  second goes back"): the request is explicit that Esc takes you back,
  and a layered Esc would reproduce the same complaint for anyone
  mid-compare or mid-tool.
- No change to dialog/menu layering: Modal and context menus already
  consume Esc through their own listeners, and App's handler bails out
  while a dialog is open or focus sits in a menu — so Esc still closes
  those first and only navigates when nothing transient is open.

## Verification

- `vitest run src/escapeNavigation.test.ts` in `@f8/core`: 2/2 pass.
- Full `@f8/core` suite: 754 tests pass; `@f8/ui` suite: 20 files /
  135 tests pass.
- `typecheck` passes for `@f8/core`, `@f8/ui`, and `@f8/web` (core
  rebuilt so web picks up the new export).
- Playwright not run (per task-loop rules).
