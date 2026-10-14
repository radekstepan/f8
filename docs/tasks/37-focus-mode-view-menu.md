# Task: Move Focus Mode to View, drop the Window menu

## Request

Move "Focus Mode" from Window to "View" as the first option in its own
section. And remove "Photo Browser" from Window. Then remove the Window
from the menu at the top since it's empty.

## Change

- `packages/ui/src/components/Topbar.tsx`
  - The View dropdown now opens with `Focus Mode (Shift F)` followed by a
    `MenuSeparator`, ahead of the Show toggles — its own section at the
    top. The `fullscreen` action, label, and shortcut are unchanged, so
    the App wiring, the `Shift F` handler, the toolbar focus button, and
    the shortcuts dialog entry all keep working untouched.
  - The `Window` menu entry is deleted. It held only Focus Mode (moved)
    and a shortcut-less duplicate `Photo Browser` entry; the canonical
    `Photo Browser (G)` entry at the bottom of View stays.
- `apps/web/src/index.css`: removed the `@media (max-width: 460px)` rule
  that hid `.menu-anchor:nth-child(5)` (formerly Window). With Window
  gone the 5th trigger is Help, which must stay visible — see Decisions.
- Tests (`packages/ui/src/components/topbarMenus.test.tsx`,
  `zoomLens.test.tsx`):
  - Trigger-label pins updated to `File, Edit, Image, View, Help` in both
    files.
  - New: View opens with Focus Mode first in its own section (fragment
    opener immediately precedes it; a separator sits between it and the
    Show toggles).
  - New: no `Window:` key in the source, no Window trigger rendered, and
    exactly one `Photo Browser` (the View entry with `G`).
  - The small-screen test now pins that no menu is hidden and that the
    5th trigger is Help.

## Decisions

- **Removed the small-screen hiding rule instead of re-pointing it.**
  The rule existed to save 460px-wide space by hiding Window, whose items
  all had alternatives (toolbar button / shortcuts / the View entry).
  Re-pointing it at the new 5th menu would hide Help and strand About +
  Keyboard Shortcuts, which have no alternative route. With one fewer
  menu the bar fits better, so hiding nothing is the safe minimal move.
- **Kept the `grid`/`fullscreen` actions and shortcuts untouched.** This
  is a pure menu-layout move; no App behavior changes, so no README or
  `docs/features.md` update (the `Shift F` shortcut row is unaffected).

## Tests

- UI suite: 71 files / 559 tests pass (`yarn workspace @f8/ui test`).
- `typecheck` clean for `@f8/ui` and `@f8/web` (after rebuilding the
  gitignored `@f8/ui` dist, which `@f8/web` typechecks against). No
  Playwright, per the task rules.
