# Task: Zoom dropdown alignment — own section, left-aligned labels

## Request

Align "Zoom in View" in the dropdown beautifully with the other items.
And put it in its own section. Same with the 4x 8x and 16x. 8x is to
the left, the other to the right.

## Change

- `apps/web/src/index.css`: `.menu-item` switches from
  `justify-content: space-between` to `flex-start`. This is the whole
  alignment fix: with space-between, two-child items (`[check,
  label]` — the Show toggles, 4x, 16x) pushed the label flush right
  while three-child items (`[check, label, kbd/chevron]` — 8x with its
  Z shortcut, the Zoom in View parent with its chevron) centered it.
  Hence "8x is to the left, the others to the right", and the Zoom in
  View label sitting left of its Show siblings. `kbd` and `.menu-chevron`
  already carry `margin-left: auto`, so shortcuts stay right-aligned
  and unchecked `[label]` / `[label, kbd]` items render exactly as
  before. The album sort menu's checked items get the same fix for free.
- `packages/ui/src/components/Topbar.tsx`: the View menu gains a
  `<MenuSeparator />` before `{zoomLensSubmenu}`, so Zoom in View sits
  in its own section (Show toggles / Zoom in View / Photo Browser +
  Zoom to Fit). Comment above the submenu updated to match.
- `packages/ui/src/components/zoomLens.test.tsx` (19 tests): the
  submenu-placement test now asserts the own-section layout (a
  separator on each side of the parent, still above Photo Browser /
  Zoom to Fit), and a new alignment test pins `flex-start` on
  `.menu-item` with `margin-left: auto` on `kbd`, plus the parent's
  `[check, label]` lead matching its MenuItem siblings.

## Decisions

- **One shared rule, not per-item overrides.** The misalignment came
  from the flex distribution on every `.menu-item`, so fixing the
  rule fixes the parent, the flyout, and the sort menu together. No
  markup or per-item CSS was needed.
- **No separators inside the flyout.** "Same with the 4x 8x and 16x"
  was read as the alignment half only: the flyout holds just those
  three options, so separators would sit at its edges and add noise.
  Its labels now all start at the same x.
- **Previous placement test updated, not weakened.** It asserted no
  separator between the Show items and the submenu — exactly the
  layout this task replaces — so it now asserts separators on both
  sides instead. All other submenu expectations are unchanged.
- **No `dist/` in the commit.** `dist/` is gitignored but is what
  `@f8/*` imports resolve to locally, so ui was rebuilt after the
  change for typecheck/build; the rebuild stays untracked.

## Tests

- New assertions failed before the fix (2 failed / 17 passed) and
  pass after: UI suite 66 files / 524 tests pass.
- `typecheck` clean for ui; `web build` succeeds.
  No Playwright, per the task rules.
