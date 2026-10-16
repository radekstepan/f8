---
'@f8/core': patch
'@f8/web': patch
---

Focus Mode (Shift F) now strips the shell down to the open photo and the album filmstrip. Previously it only hid the side panels; the menu bar, toolbar, preset strip, and status bar now unmount too, the filmstrip is forced on even when normally closed, and the panel preferences are left untouched so leaving the mode restores the exact previous layout. A floating button offers the way out (Shift F and Esc still work).

## Task writeup (docs/tasks/48-focus-mode.md)

## Request

Focus mode should remove all but the photo and the film strip at the
bottom of the album.

## Change

- `apps/web/src/App.tsx`
  - New explicit `focusMode` state (`useState(false)`). The `fullscreen`
    action (View → Focus Mode, Shift F, toolbar button) now toggles it
    and opens the editor on entry; it no longer flips the sidebar /
    inspector preferences.
  - Render gates: MenuBar, Toolbar, Sidebar, Inspector (via
    `showInspector`), PresetStrip, and AppStatus unmount while the mode
    is on; the main column renders the photo via `effectiveView` and the
    filmstrip via `showFilmstrip`, both forced by the new core
    predicates. The shell gains an `is-focus` class.
  - Exits: Shift F toggles, Esc leaves the mode first (before
    compare/tool reset and album navigation), `grid` (G, incl. the
    keyboard shortcut, which stays reachable) and browser Back/forward
    leave it too.
  - A floating `.focus-exit` button (shared `IconButton`, `Minimize2`
    glyph, `Exit focus mode (Shift F)` label) offers mouse users the way
    out while the toolbar is gone.
- `packages/core/src/focusMode.ts` (new, exported from the index):
  `resolveFocusView(view, focusMode)` forces the photo view and
  `isFilmstripVisible(filmstripOpen, focusMode)` forces the strip on —
  pure predicates in the `isInspectorVisible` / `shouldShowPhotoTools`
  style, unit-tested in `focusMode.test.ts`.
- `apps/web/src/index.css`: `.focus-exit` parks the exit button fixed
  top-right at z-index 90 (above canvas chrome, below dialogs at 100
  and toasts at 150), half-opacity until hover/keyboard focus.
- Tests: `packages/ui/src/components/focusMode.test.tsx` pins the App
  wiring from source (toggle, every mount gate, forced view/strip,
  exit paths incl. the keydown `focusMode` dep, exit-button markup)
  and the exit-button CSS. No Playwright, per the task rules.

## Decisions

- **Gate at render time instead of flipping prefs.** The old toggle set
  `sidebarOpen`/`inspectorOpen` false, clobbering the user's layout;
  hiding panels behind `!focusMode` mounts restores the exact previous
  layout on exit for free, including presets and filmstrip prefs.
- **`back` keeps its exact case statement.** It is dispatched only from
  the toolbar backlink, which is unmounted in focus mode, so an exit
  prefix there would be unreachable dead code — and
  `photoBacklink.test.tsx` pins the statement exactly. `grid` keeps
  its exit because the G shortcut stays reachable in the mode.
- **Force the photo view through a predicate, not just `setView`.**
  Entering sets `editor`, but state can still name the grid mid-mode
  (popstate, `/` search parking), so `resolveFocusView` keeps a
  photo-less grid from ever rendering under the mode.
- **No README / `docs/features.md` update.** The shortcut table row
  (`Shift F` → Focus mode) is unchanged; this redefines what the mode
  hides, not the app's architecture or its shortcut surface.

## Tests

- Core suite: 1040 tests pass (`yarn workspace @f8/core test`),
  including the 4 new `focusMode.test.ts` cases.
- UI suite: 77 files / 591 tests pass (`yarn workspace @f8/ui test`),
  including the 7 new `focusMode.test.tsx` cases.
- `typecheck` clean for `@f8/core`, `@f8/ui`, and `@f8/web` (after
  rebuilding the gitignored `@f8/core` dist, which `@f8/web`
  typechecks against). No Playwright, per the task rules.
