# Reset to Original highlighted when the image has edits

Task: `Reset to Original button should be highlighted if the image has been edited.`

## What changed

- `packages/ui/src/components/Topbar.tsx`: the toolbar's `Reset to original`
  `IconButton` now receives `active={canReset}`. When the photo has edits
  (`canReset` true, derived App-side as `!isDefaultEdit(editor.edit)`), the
  button renders with the shared `is-active` class — the same accent-color
  highlight used by the compare and presets-toggle states — plus
  `aria-pressed="true"`. When the recipe is clean, the button keeps its
  previous dimmed disabled look with no active class and
  `aria-pressed="false"`. No prop signature, App-side, or CSS change.
- `packages/ui/src/components/toolbarReset.test.tsx`: updated the
  source-pinned reset-props string to include `active={canReset}`; added a
  `highlights the reset button only when the image has edits` test asserting
  `is-active` + `aria-pressed="true"` for `canReset=true` and the default
  render, and neither for `canReset=false`. Header comment updated.

## Important decisions

- **Reuse `IconButton active`, don't invent a new style**: the `is-active`
  accent highlight already exists for toolbar icon buttons (compare,
  presets), so the edited signal is one prop — consistent with the app's
  visual language and free `aria-pressed` semantics.
- **Highlight exactly mirrors the enabled gate**: `active={canReset}` on the
  same predicate as `disabled={!canReset}`, so the button is highlighted iff
  clicking it would do something. No new derivation to drift.
- **No README update**: one-prop visual state change, no architecture or
  feature change.

## Tests (unit/integration only, no Playwright)

- `toolbarReset.test.tsx` (updated, 6 tests): existing order/disabled/
  dispatch/derivation pins still pass with the new prop string; new
  highlight test covers edited, default, and clean renders via
  `renderToStaticMarkup`.
- Full suite: `@f8/ui` 441/441 pass (56 files). `@f8/ui` typecheck clean.
