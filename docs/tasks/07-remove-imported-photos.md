# Task 07 — Remove imported photos (library only, never the file)

## Finding

The server half already existed: `DELETE /api/photos/:id` in
`apps/server/src/app.ts` deletes only the library record, its derived
preview, and heal overlays — never the original file — and
`createLibraryClient().deletePhoto()` in `packages/core/src/library.ts`
already called it. What was missing was everything the user touches:
`useLibrary` exposed no remove function and the UI had no affordance.
This task wires the existing endpoint through to the UI.

## What I did

- `packages/ui/src/hooks/useLibrary.ts` — added `removePhoto(id)`:
  calls `client.deletePhoto(id)`, drops the photo from local state,
  marks offline on network failure like the other mutators.
- `packages/core/src/types.ts` — added `'remove'` to `DialogType`.
- `packages/ui/src/components/EditorDialogs.tsx` — added a confirm
  `RemoveDialog` (names the photo, states the original file on disk is
  never deleted and can be reimported) with a new required
  `onRemovePhoto` prop; added `Del` to the shortcuts dialog.
- `packages/ui/src/components/Topbar.tsx` — added `'remove'` to
  `MenuAction` and a danger-styled `Remove from Library…` (Del) item to
  the Image menu; the `item()` helper now forwards `danger`.
- `packages/ui/src/components/PhotoStrips.tsx` — `PhotoBrowser` accepts
  optional `onRemove` and shows a hover-reveal trash button per photo.
- `apps/web/src/App.tsx` — `requestRemove` opens the confirm dialog
  (carries the target id so browser-trash on a non-open photo names the
  right photo); `confirmRemovePhoto` calls `library.removePhoto`,
  advances selection to a neighbour, and toasts
  "Removed from your library. The original file is untouched." Removal
  is reachable via Image menu, `Delete`/`Backspace` (Mac keyboards send
  Backspace), and the browser trash button. Dialog close clears the
  pending target.
- `apps/web/src/index.css` — `.browser-remove` hover button (top-left,
  mirrors `.browser-favorite`) and a red `.danger-button` for confirm.
- `README.md` — component table now lists the remove-confirm dialog.

No server product code changed: `store.deletePhoto` plus the route's
preview/overlay-only cleanup already implement the "must not delete
original file" contract.

## Files changed

- `packages/ui/src/hooks/useLibrary.ts`
- `packages/core/src/types.ts`
- `packages/ui/src/components/EditorDialogs.tsx`
- `packages/ui/src/components/Topbar.tsx`
- `packages/ui/src/components/PhotoStrips.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/index.css`
- `README.md`
- `packages/core/src/library-client.test.ts` (new)
- `apps/server/src/routes.test.ts` (new test only)

## Tests added/run with results

- New `packages/core/src/library-client.test.ts` (3 tests): DELETE is
  issued against the encoded `/api/photos/:id` URL; server error
  message surfaces as `LibraryError` with status; unreachable server
  reports status 0. Pass.
- New `routes.test.ts` case: DELETE on unknown id → 404, second DELETE
  after removal → 404, original file still on disk. Pass.
- Full suites: core 24 files / 455 tests pass; server 7 files /
  54 tests pass. `yarn typecheck` passes for all 4 packages;
  `yarn build` succeeds.
- UI packages have no unit-test runner (Vitest only in core/server),
  so the dialog/menu/browser wiring is verified by typecheck + build,
  not a component test.

## How to verify

1. `yarn dev`, import a photo, open it.
2. Image menu → Remove from Library… (or Del) → confirm → photo
   leaves the library, neighbour opens, original file still on disk
   (reimport works).
3. Library view → hover a grid photo → trash icon → confirm names that
   photo. Removing the last photo shows the empty-library gate.

## Unresolved items

- None for this task. Note: the shared tree contains other agents'
  in-progress changes; this task's hunks were re-verified present after
  build/typecheck. Changes left uncommitted.
