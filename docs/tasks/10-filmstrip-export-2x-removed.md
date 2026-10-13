# Task 10: Remove "Export 2x" from the filmstrip menu

## What changed

The filmstrip right-click menu no longer offers "Export 2x" — it shows
only Favorite / Remove from Library. The 2x upscale itself is untouched:
it lives in the export dialog's "Super-resolution 2x" checkbox and in the
library grid's context menu, both of which keep working.

Root cause of the reported behavior: `requestExport2x` in `App.tsx` parks
the target id in a ref and relies on the next render's effect to open the
export dialog. From the library grid that render always happens (the view
flips library → editor), but from the filmstrip the photo is usually
already open and the view already `editor`, so `selectPhoto`/`setView`
change no state, no render fires, and the ref sits parked until something
unrelated re-renders — e.g. switching to Adjust or Repair, when the export
dialog then pops up "by itself".

Files: `packages/ui/src/components/PhotoStrips.tsx` (`Filmstrip` loses the
`onExport2x` prop; the menu is now gated on `onFavorite`),
`apps/web/src/App.tsx` (filmstrip call site drops `onExport2x`; pending-2x
comment narrowed to the library grid),
`packages/ui/src/components/EditorDialogs.tsx` (one comment),
`packages/ui/src/components/photoContextMenu.test.tsx` (filmstrip cases
updated + regression test).

## Decisions

- Remove the entry rather than fix the parking: the export dialog already
  exposes the checkbox one click away, and a filmstrip shortcut that opens
  a dialog for the already-open photo adds no value over it.
- Keep the library grid's "Export 2x": that path always changes view, so
  the pending effect fires immediately and works as designed.
- Gate the filmstrip menu on `onFavorite` (previously on `onExport2x`) so
  Favorite/Remove keep working; `App.tsx` always passes it.
- No README change: menu-entry removal, no architecture change.

## Tests

- `packages/ui`: all 224 tests pass, including the updated filmstrip cases
  and the new `never offers 2x export in the filmstrip` regression test in
  `photoContextMenu.test.tsx`. `yarn typecheck` clean for `@f8/ui` and
  `@f8/web`. No Playwright (per brief).
