# Task 1: Reset-to-original action in the photo toolbar

Task: In photo mode at the top next to show/hide presets have an action/icon
to reset the image to original.

## What changed

- `packages/ui/src/components/Topbar.tsx`
  - `Toolbar` renders a new `IconButton` labeled "Reset to original" with the
    `RotateCcw` glyph, placed immediately after the show/hide presets toggle
    in `toolbar-actions` (before compare/info/export).
  - New optional `canReset` prop (defaults to `true`) drives the button's
    disabled state, following the existing `canUndo`/`canRedo` pattern.
  - The button dispatches the shared `reset` menu action — the same handler
    as Edit > Reset All Adjustments and the Inspector's `onReset` — so no new
    reset logic was introduced.
- `apps/web/src/App.tsx`
  - Passes `canReset={!isDefaultEdit(editor.edit)}` to `Toolbar` (new
    `isDefaultEdit` import from `@f8/core`).
- `packages/ui/src/components/toolbarReset.test.tsx` (new)
  - Server-rendered tests pinning: the button's presence/label/glyph, its
    adjacency to the presets toggle, the disabled-when-clean gate (including
    the enabled-by-default behavior existing renders rely on), the
    `onAction('reset')` dispatch, and the App-side `canReset` derivation.

No README update: small UI affordance, no architecture change.

## Decisions

- **Disabled when clean, not hidden.** Matches the toolbar's undo/redo
  convention and the repo's no-reset-when-clean philosophy. The predicate
  mirrors `useEditor.reset()` exactly (it reports "changed" iff
  `!isDefaultEdit`), so the button is enabled exactly when clicking it does
  something.
- **`RotateCcw` glyph.** Same reset vocabulary the Inspector already uses for
  its revert/reset controls.
- **Optional prop defaulting to enabled.** Existing `Toolbar` renders in other
  tests keep working unchanged.

## Verification

- `yarn workspace @f8/ui test` — 45 files, 346 tests, all pass.
- `yarn workspace @f8/core test` — 49 files, 844 tests, all pass.
- `yarn workspace @f8/ui typecheck` and `yarn workspace @f8/web typecheck` —
  pass (after rebuilding `@f8/ui`, see Learnings).
- Playwright not run per task instructions.

## Learnings

- **Cross-workspace typecheck needs a rebuild.** `apps/web` resolves `@f8/ui`
  from `packages/ui/dist`, so a new prop is invisible to the web typecheck
  until `yarn workspace @f8/ui build` runs. A "property does not exist" error
  after editing the UI package means rebuild, not a code bug. (`dist/` is
  gitignored, so the rebuilt output does not pollute the commit.)
- **Substring traps in markup assertions.** `'</button>'`-style closers and a
  target attribute sitting inside its own opening tag make naive
  `slice(a, b).not.toContain('<button')` checks fail on the boundary tags
  themselves. Pin button boundaries explicitly (`lastIndexOf('<button', …)`)
  instead.
