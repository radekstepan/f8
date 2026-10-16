---
'@f8/ui': patch
'@f8/web': patch
---

The photo toolbar gained a remove action directly left of the info button, taking over from the trash icon that used to sit in the photo heading next to the favorite star; both open the same Remove from Library confirmation.

## Task writeup (docs/tasks/40-toolbar-remove-action.md)

## Request

Move the delete icon from photo canvas to be an action right to the left
of the info icon.

## Change

- `packages/ui/src/components/Topbar.tsx`
  - The photo toolbar's actions row is now reset, compare, presets
    toggle, remove, info, Export (was reset, compare, presets, info,
    Export). The new button reuses the heading's verbatim copy
    (`Remove from library (Del)`), the Trash2 glyph at the toolbar's
    18px size, and dispatches the existing `remove` menu action — the
    same handler as Image > Remove from Library — so the confirm
    dialog, Del shortcut, and copy are all unchanged. Photo-only
    (`showPhotoTools`), like its neighbors.
- `packages/ui/src/components/PhotoCanvas.tsx`
  - The heading trash (`photo-remove`) is gone; the heading keeps
    rating + favorite. The now-dead `onRemove` prop (interface entry
    + destructure) and the unused Trash2 import are removed.
- `apps/web/src/App.tsx`: the `PhotoCanvas` call drops its `onRemove`
  prop. No new wiring was needed — `case 'remove'` already targeted
  the open photo.
- `apps/web/src/index.css`: the danger hover tint (`#f29c97`) moved
  with the button from `.photo-rating .photo-remove:hover` to
  `.toolbar-actions .toolbar-remove:hover`; no `photo-remove`
  selector remains.
- Tests (`toolbarRemoveOrder.test.tsx` new, three files updated):
  - New: remove sits directly between the presets toggle and info
    (adjacent on both sides) in both Show/Hide presets states.
  - New: the button renders the `lucide-trash-2` glyph under the
    `toolbar-remove` hook, and the stylesheet pins the danger hover
    on that hook with no `photo-remove` rule left.
  - New: the dispatch pin (`onAction('remove')` in Topbar,
    `case 'remove'` targeting the open photo in App) and the
    photo-only gate (absent when `showPhotoTools` is false).
  - Updated: `presetsToggleOrder` now pins the toggle between
    compare and remove (was compare/info); `toolbarReset` and
    `photoToolsGating` comments/listings include the new button;
    `removeFromLibrary` pins the heading as remove-free (single
    test replacing the provided/omitted pair).

## Decisions

- **Removed the `onRemove` prop instead of leaving it.** Only App and
  one test passed it, so keeping it would have been a dead callback
  inviting a second trash to drift back in. Typecheck + the full
  suite confirm nothing else referenced it.
- **Kept the narrow-viewport behavior untouched.** The ≤850px rule
  hides `.toolbar-reset` by class (task 38), so inserting a button
  changes nothing there; the new button stays visible on small
  screens, like compare/presets/info.
- **No README update.** This is a pure control relocation with no
  behavior or architecture change; the Remove from Library dialog,
  Del shortcut, and menu entry are untouched.

## Tests

- UI suite: 73 files / 568 tests pass (`yarn workspace @f8/ui test`),
  including the 5 new `toolbarRemoveOrder` tests.
- Full unit suite passes (`yarn test`); `yarn typecheck` clean for
  all workspaces (the `@f8/ui` dist rebuilds through the
  `^build`-dependent tasks, so `@f8/web` typechecks against the
  current UI). No Playwright, per the task rules.
