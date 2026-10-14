# Undo/Redo/Reset hidden on album view

Task: `Undo Redo and Reset to Original buttons show on album view - wrong.`

## What changed

- `packages/ui/src/components/Topbar.tsx`: the toolbar's Undo/Redo
  `history-buttons` block and the `Reset to original` button are now gated
  behind the existing `showPhotoTools` prop (already `false` in the library
  grid via `shouldShowPhotoTools(view)` in `apps/web/src/App.tsx`, already
  gating the Adjust/Repair/Crop switcher, presets toggle, compare, and
  photo-info buttons). On album view the three buttons are omitted entirely
  (not disabled — absent); on photo view the markup is unchanged. No prop
  signature or App-side change was needed.
- `packages/ui/src/components/photoToolsGating.test.tsx`: moved the Undo,
  Redo, and Reset labels from the library-kept set to the photo-only set,
  and pinned the `history-buttons` block present on photo / absent in the
  grid. Test names and header comment updated to match.

## Important decisions

- **Reuse the existing gate, don't add a new prop**: `showPhotoTools`
  already expressed exactly "photo open vs. library grid", so the fix is
  two `showPhotoTools &&` wrappers — no new props, no App.tsx change, no
  CSS change.
- **Omit, not disable**: matches the established pattern for every other
  photo-only toolbar control (absent in the grid), and matches the task
  ("show on album view - wrong").
- **No README update**: small bug fix, no architecture or feature change.

## Tests (unit/integration only, no Playwright)

- `photoToolsGating.test.tsx` (updated, 5 tests): photo toolbar contains
  all 9 photo-only labels incl. undo/redo/reset + `history-buttons` block;
  default render stays photo-shaped; grid render omits all 9 labels plus
  `editing-tools`/`history-buttons`/`tool-button`; grid keeps sidebar,
  export, focus; App derivation pinned from source.
- `toolbarReset.test.tsx` (untouched, 5 tests): still passes — it renders
  the default (photo) toolbar, and the source-pinned reset dispatch string
  is unchanged inside the new wrapper.
- Results: `@f8/ui` 440/440 pass (56 files). Typecheck clean for `@f8/ui`
  and `@f8/web`.
