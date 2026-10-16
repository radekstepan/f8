# Task: Clicking "Zoom in View" clears the zoom preview

## Request

Clicking on "Zoom in view" in the dropdown (not one of the 4x 8x
16x) is how you clear the zoom in view.

## Change

- `packages/ui/src/components/Topbar.tsx`: the Zoom in View submenu
  parent's click now depends on state. While the preview is on, it
  fires the active factor's action
  (`action(zoomLensActions[zoomLensMagnification])`) — re-picking the
  active factor hits the existing App toggle-off rule, and `action()`
  dismisses the menu like any other Show item. While off, click still
  toggles the flyout open/closed (the touch path; hover opens it on
  desktop).
- `packages/ui/src/components/Topbar.tsx` (keyboard): ArrowRight on a
  closed submenu parent now opens the flyout via `setSubmenu`
  directly instead of clicking the parent, which would fire the new
  clear action. Menu triggers still open via click; ArrowLeft/Escape
  behavior is unchanged.
- No `App.tsx` change: the existing "re-picking the active factor
  turns the preview off" rule already implements the clear.

## Decisions

- **Reuse the active factor's action, no new `MenuAction`.** The
  toggle-off rule from the submenu task already turns the preview off
  on re-pick, so the parent just re-picks — one rule, no new action
  type, no App change.
- **Off-click still opens the flyout.** Making the parent a full
  on/off toggle would strand touch users with no way to reach the
  4x/8x/16x options, so while off the parent keeps its old
  toggle-submenu behavior. Hover opens the flyout on desktop either
  way.
- **Clear also dismisses the menu.** The parent goes through
  `action()`, matching every other View-menu item (including the Show
  toggles it sits with).

## Tests

- `packages/ui/src/components/zoomLens.test.tsx` (new
  `zoom-in-view parent clears the preview` block, 3 tests): parent
  click fires the active factor while on, keeps the submenu toggle
  while off, and ArrowRight opens the flyout via `setSubmenu` without
  clicking the parent. UI suite: 66 files / 529 tests pass.
- `typecheck` clean for the UI package. No Playwright, per the task
  rules.
