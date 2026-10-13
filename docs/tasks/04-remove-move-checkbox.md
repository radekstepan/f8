# Task 4: Remove the "Move the current photo into this album" checkbox

## What changed

The New Album dialog no longer offers a "Move the current photo into
this album" checkbox. Creating an album now always just creates an
empty album and navigates to it; the current photo stays where it is.

- `packages/ui/src/components/EditorDialogs.tsx`: removed the checkbox
  and its `includePhoto` state from `AlbumDialog`; `onCreateAlbum`
  narrowed from `(name, includePhoto) => void` to
  `(name) => void`.
- `apps/web/src/App.tsx`: `createAlbum` takes only the album name —
  no `updatePhoto` move, no photo-thumbnail cover seeding. Photos can
  still be filed into albums via the existing move flows
  (`movePhotosToAlbum`).
- `packages/ui/src/components/createAlbum.test.tsx` (new, 3 tests):
  pins the dialog markup (name field, Create/Cancel) and asserts no
  checkbox remains, plus the single-argument callback wiring.

## Decisions

- **Fixed behavior is "do not move."** The checkbox defaulted to
  unchecked, so the fixed behavior matches what most creations already
  did: the album is created empty. Nothing about the move itself was
  kept — the task calls the option "not useful".
- **Cover left empty.** The only caller that seeded an album cover from
  the current photo's thumbnail was the checked path; with the move
  gone there is no photo to seed from, so the album is created without
  a cover.
- **No README update.** Small dialog removal, no architecture change.

## Verification

- `yarn workspace @f8/ui test` — 24 files / 167 tests pass (+1 file /
  +3 vs HEAD).
- `yarn workspace @f8/ui typecheck` clean; `tsc --noEmit` clean for
  `@f8/web` against the rebuilt ui `dist` (dist is git-ignored).
- Playwright not run (per task rules).
