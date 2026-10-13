# Task 08 — Grid multi-select + move to album

## Problem
The album grid was single-photo only: no way to select several photos at
once, and no way to move photos between albums from the grid at all.

## Fix
- `packages/core/src/photoSelection.ts` (new): pure selection rules —
  `togglePhotoSelection` (Ctrl/Cmd-click), `extendPhotoRange`
  (Shift-click from an anchor), `resolveMoveTargets` (a gesture on a
  selected photo acts on the whole selection, otherwise re-targets to that
  photo alone), `rectsIntersect` + `marqueeSelectedIds` (rubber-band
  hit-testing), and `MOVE_PHOTOS_MIME` + payload encode/decode for the
  sidebar drop. Exported from `packages/core/src/index.ts`.
- `packages/ui/src/components/PhotoStrips.tsx` (`PhotoBrowser` only; the
  filmstrip keeps single-photo behavior):
  - Controlled `selectedIds` + `onSelectionChange`; plain click still
    opens, Ctrl/Cmd toggles, Shift ranges. Selected cards get
    `.is-selected`, `aria-selected`, and a check badge.
  - Rubber-band marquee: a mouse press on the grid background (not on a
    photo) sweeps a fixed-position band that selects intersecting cards
    live; Ctrl adds, a plain sweep replaces, a click clears. Touch keeps
    native scroll (mouse only).
  - Right-click menu gains a "Move N photo(s) to…" section listing user
    albums (scrollable), excluding the open album. The menu now also opens
    when only moving is available. Right-clicking an unselected photo
    re-targets the selection to it first.
  - Cards are `draggable` with the move payload when `onMoveToAlbum` is set.
- `packages/ui/src/components/Sidebar.tsx`: album rows accept photo drops
  (`onMoveToAlbum`), highlight with `.is-drop-target` on drag-over, and
  ignore OS file drags so the app-shell import overlay keeps working.
- `apps/web/src/App.tsx`: owns the selection (cleared whenever the list
  identity — collection, search, filters — changes) and `movePhotosToAlbum`,
  which PATCHes each photo's `albumId` via the existing
  `library.updatePhoto` (no server change needed), skips photos already
  home with an "Already in …" note, and toasts the move count.
- `apps/web/src/index.css`: selected outline + check badge, marquee band,
  move-list scroll, drop-target highlight.

## Decisions
- Inline album list instead of a nested submenu: no flyout positioning or
  hover-timing complexity, and it scrolls for large album counts.
- Selection lives in App (controlled), not in the grid: moves and
  list changes both need to clear it, and the sidebar drop needs the ids.
- No multi-remove/favorite batch actions: the task asked only for moving;
  the selection plumbing makes those trivial follow-ups.

## Verification
- `packages/core/src/photoSelection.test.ts`: 13 tests (toggle, range,
  targets, marquee, payload).
- `packages/ui/src/components/photoMultiSelect.test.tsx`: 15 tests
  (selection markup, marquee seam, draggable, move section incl. current-
  album exclusion and no-ML-handler menu, sidebar drop highlight, CSS).
- Full suites: core 736 pass, UI 113 pass; `yarn typecheck` 6/6.
- Pointer/drag-drop behavior is client-only (SSR tests pin markup);
  verify by hand: Ctrl-click, Shift-click, background drag, right-click
  move, drag cards onto a sidebar album.
