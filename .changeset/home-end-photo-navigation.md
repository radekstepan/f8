---
'@f8/core': patch
'@f8/ui': patch
'@f8/web': patch
---

Home and End now jump to the first and last photo of the album while viewing a photo. Previously they only moved focus in the filmstrip without changing the open photo. In the library grid the keys keep their native scroll behavior.

## Task writeup (docs/tasks/51-home-end-photo-navigation.md)

## Request

Home and End keys while being on a photo should navigate to the first/last
photo. Right now it just highlights the item in the strip at the bottom.

## Investigation

Two key handlers share photo navigation:

- App's global `keydown` effect (`apps/web/src/App.tsx`) moves the
  *selection* for ArrowLeft/ArrowRight (with album wraparound). It ignored
  Home/End entirely.
- The filmstrip's `onListKeyDown` (`packages/ui/src/components/PhotoStrips.tsx`)
  moves *focus* for ArrowLeft/ArrowRight/Home/End via `filmstripArrowIndex`,
  without touching the selection. It calls `preventDefault` but not
  `stopPropagation`, so the global handler still runs afterwards — arrows
  already compose this way (focus and selection move together).

So pressing Home/End moved only the strip focus ("highlights the item in
the strip") while the open photo stayed put — and with focus outside the
strip the keys did nothing at all.

## Change

- `packages/core/src/photoEndNavigation.ts` (new)
  - `shouldNavigateToPhotoEnd(key, view)`: claims Home/End in the editor
    view only. Follows the `shouldEscapeToLibrary` precedent (pure
    predicate, raw `event.key` like `filmstripArrowIndex`).
  - `photoEndTargetId(key, photos, selectedId)`: the first/last photo id,
    or `null` for other keys, empty collections, and the end already open
    (a no-op, so re-pressing never resets zoom or clears search via
    `selectPhoto`).
  - Exported from `packages/core/src/index.ts`.
- `apps/web/src/App.tsx`
  - New block in the global `keydown` handler, right after the arrow block:
    `preventDefault`, resolve the target id, `selectPhoto` when non-null.
    `view` was already in the effect deps, so no dep change was needed.
- `packages/ui/src/components/EditorDialogs.tsx`
  - Shortcuts dialog Navigation section gains
    `First / last photo — Home / End`.
- Tests
  - `packages/core/src/photoEndNavigation.test.ts`: view gating, first/last
    targets, already-there/empty/other-key no-ops, plus an agreement check
    that the selection target id equals the photo the strip focus moves to
    for the same key (7 cases).
  - `packages/ui/src/components/photoEndNavigation.test.tsx`: source-pinned
    wiring (the `focusMode.test.tsx` precedent — the behavior lives in an
    effect): App calls the helpers, the shortcuts row exists, and the strip
    still keys focus on the same `event.key` (3 cases).
- No README change: a keyboard shortcut, not an architecture change or a
  complex feature (same reasoning as task 1).

## Decisions

- Editor-only, unlike arrows: in the library view Home/End keep their
  native grid-scroll meaning instead of jumping into the editor. The task
  asks for behavior "while being on a photo", and stealing grid scroll
  would remove the only scroll-to-top/bottom keys (arrows only ever took
  Left/Right).
- No change to the filmstrip handler: with focus in the strip, Home now
  both focuses the first item (strip handler) and opens it (global
  handler) — the two agree because both key on `event.key`, mirroring how
  arrows already compose. Changing the strip to select would have been the
  other option, but it would leave focus-outside-the-strip still broken.
- Already-there is a silent no-op (not even `selectPhoto` with the same
  id), because `selectPhoto` resets zoom and clears search state.

## Verification

- `yarn workspace @f8/core test`: 1060 tests pass (incl. 7 new).
- `yarn workspace @f8/ui test`: 79 files / 598 tests pass (incl. 3 new).
- `typecheck` passes for `@f8/core`, `@f8/ui`, `@f8/web` (after rebuilding
  core so web resolves the new exports).
- Playwright not run (per task rules).
