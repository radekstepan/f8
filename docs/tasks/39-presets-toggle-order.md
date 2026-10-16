# Task: Move the presets toggle between compare and info

## Request

Move the presets icon from the menu at the top in photo mode to be
between compare and info.

## Change

- `packages/ui/src/components/Topbar.tsx`
  - The photo toolbar's actions row is now reset, compare, presets
    toggle, info, Export (was presets, reset, compare, info, Export).
    The toggle's labels (`Show/Hide presets`), SwatchBook glyph, active
    state, and `onTogglePresets` wiring are unchanged; only its position
    moved.
  - The reset button gained a `toolbar-reset` class hook so the
    narrow-viewport rule can target it directly — see Decisions.
- `apps/web/src/index.css`: the `@media (max-width: 850px)` rule changed
  from `.toolbar-actions > .icon-button:nth-of-type(2)` to
  `.toolbar-actions > .toolbar-reset`. Same visible behavior as before
  the move (reset hidden at ≤850px); the selector just no longer depends
  on button order.
- Tests (`packages/ui/src/components/presetsToggleOrder.test.tsx` new,
  `toolbarReset.test.tsx` updated):
  - New: the toggle sits directly between compare and info (adjacent on
    both sides, no button in between) in both the Show and Hide states.
  - New: reset is the row's first button.
  - New: the narrow-viewport stylesheet hides `.toolbar-reset`, the
    reset button carries that class, and no positional
    `toolbar-actions > .icon-button:nth-of-type` selector remains.
  - Updated: the reset-order test now pins reset-first (ahead of
    compare, adjacent to it) instead of reset-after-presets, and the
    dispatch pin includes the new `className`.

## Decisions

- **Hid reset by class instead of re-pointing the positional rule.**
  The `:nth-of-type(2)` selector has silently changed victims on every
  past reorder (it hid info at init, then compare, then reset),
  and this move would have made it hide compare — a core action. The
  `toolbar-reset` class preserves today's behavior (reset hidden, still
  reachable via Edit > Reset All Adjustments) and survives future
  reorders, including the planned delete-button insertion left of info.
- **Left the View > Show Presets menu entry untouched.** The request
  names the toolbar icon, not the menu checklist entry; both keep
  toggling the same strip.
- **No README update.** This is a pure toolbar-layout move with no
  behavior or architecture change.

## Tests

- UI suite: 72 files / 563 tests pass (`yarn workspace @f8/ui test`),
  including the 4 new `presetsToggleOrder` tests.
- Full unit suite passes (`yarn test`); `yarn typecheck` clean for all
  workspaces (after rebuilding the gitignored `@f8/ui` dist, which
  `@f8/web` typechecks against). No Playwright, per the task rules.
