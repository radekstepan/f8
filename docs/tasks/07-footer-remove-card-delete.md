# Task 07 — Footer remove entry + card delete placement

## Problem
Two gaps around removing photos:
1. Right-clicking a footer (filmstrip) photo offered ML actions and favorite,
   but no way to remove the photo.
2. In the album grid the delete button sat at the bottom of the whole photo
   card — under the caption text — instead of the photo's bottom-right corner
   like the favorite button sits at the top-right.

## Root cause
1. `Filmstrip` never accepted an `onRemove` prop and hard-coded
   `showRemove={false}` on the shared `PhotoContextMenu`, so the remove entry
   could not render there (only `PhotoBrowser` wired it).
2. `.browser-remove` is absolutely positioned `right + bottom`, but its offset
   parent was `.browser-photo` — the whole card including the filename/location
   caption. `bottom: 6px` therefore anchored below the caption, not on the
   image. The favorite button only looked right because the image is at the top
   of the card, so `top: 6px` coincides with the image corner.

## Fix
- `packages/ui/src/components/PhotoStrips.tsx`:
  - `Filmstrip` accepts optional `onRemove(id)` and forwards it to
    `PhotoContextMenu` (`showRemove` + `onRemove`), mirroring `PhotoBrowser`.
  - Each grid card now wraps the open button and overlay buttons in a
    `.browser-photo-frame` div; the caption moved out of the open `<button>`
    to sit below the frame. Overlay buttons keep working because they were
    already siblings of the open button (a `<button>` cannot nest inside one).
- `apps/web/src/App.tsx`: the `Filmstrip` gets `onRemove={requestRemove}`, so
  the footer menu entry opens the same confirm dialog as everywhere else.
- `apps/web/src/index.css`: new `.browser-photo-frame { position: relative; }`
  rule — the frame wraps the image only, so the bottom-anchored delete button
  lands on the photo's bottom-right corner, mirroring the top-right favorite.

## Decisions
- Restructure over a CSS offset: the caption height varies (location line is
  optional), so no fixed `bottom` offset from the card could track the image
  edge. Anchoring to an image-only frame is exact at any caption height.
- Caption no longer opens the editor (it left the open button with the
  overlays). The button keeps its `Edit <title>` accessible name, so the
  existing e2e selectors are unaffected; only the image is the click target.
- Reused the existing `requestRemove` confirm flow rather than adding a new
  dialog: removal from the footer behaves identically to the grid and
  photo-view entries.

## Verification
- New tests (4): filmstrip context menu offers `Remove from Library…` when
  `onRemove` is provided (`photoContextMenu.test.tsx`); the grid remove button
  renders inside `.browser-photo-frame` above the caption, the caption renders
  outside the open button with the accessible name intact, and the frame rule
  is positioned (`removeFromLibrary.test.tsx`). Existing "no remove entry
  without `onRemove`" assertions still pass unchanged.
- `yarn workspace @f8/ui test`: 98/98 pass. `yarn typecheck`: 6/6 ok.
