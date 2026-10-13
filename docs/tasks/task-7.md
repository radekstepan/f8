# Task 7: Top menu dropdowns open flush with their triggers

Task: The dropdowns in the menu at the top are not flish with the
dropdown triggers.

## What changed

- `apps/web/src/index.css`
  - Added a scoped `.menu-bar .dropdown-menu` override:
    `top: calc(100% - 3px)`.
  - Root cause: the menu trigger is a slim pill with
    `margin: 3px 0` inside the full-height `.menu-anchor`, while the
    shared `.dropdown-menu` base rule anchors at `top: 100%` of the
    anchor — so every File/Edit/Image/View/Window/Help dropdown
    opened 3px below its trigger pill's bottom edge, with a visible
    dead gap. Subtracting the trigger's bottom margin lands the
    menu's top edge exactly on the pill's bottom edge. Horizontal
    alignment was already flush (`left: 0`, plus the small-screen
    right-aligned variant) and is untouched.
- `packages/ui/src/components/topbarDropdownFlush.test.tsx` (new)
  - Pins the scoped override: `top: calc(100% - Npx)` where N is
    parsed from the trigger's own `margin` shorthand, so a future
    margin change fails loudly instead of drifting the menu off
    the pill.
  - Pins that the override sets no `left`/`right` (horizontal
    flush stays on the base rule and the small-screen variant).
  - Pins that other `.dropdown-menu` users keep their anchoring:
    base `top: 100%`, `.add-adjustment-menu` bottom-anchored,
    `.sidebar-album-menu` fixed with `top: auto`,
    `.inspector-options` with no top override.

## Decisions

- **Scoped override, not a base-rule change.** `.dropdown-menu`
  is shared by the inspector options, add-adjustment (opens
  upward), sidebar album (fixed + inline coords), and browser
  sort/album menus. Changing the base `top` would have shifted
  all of them; the `.menu-bar` scope limits the fix to the top
  menu bar the task complains about.
- **Subtract the margin instead of removing it.** The 3px vertical
  margin is what makes the triggers slim pills (pinned by
  `topbarMenus.test.tsx`); the menu must adapt to the trigger,
  not the other way around.
- **Left the existing `topbarMenus.test.tsx` untouched.** It pins
  the base rule (`top: 100%`, no calc), which is still true and
  still the correct default for the other menus; the new file
  pins the topbar-specific flush behavior.

## LEARNINGS

- Absolute `%` offsets resolve against the *positioned ancestor*,
  not the visual trigger: when the trigger has margin inside its
  anchor, `top: 100%` is not flush with the trigger. Always
  compare the menu edge against the trigger's border box, not the
  anchor's.
- Shared CSS classes need a usage grep before editing:
  `.dropdown-menu` has five distinct consumers with different
  anchoring, so the fix had to be scoped. A base-rule edit would
  have passed the topbar tests while silently shifting the
  inspector and browser menus.
- The stylesheet-pinning test seam (regex over `index.css`) can
  assert *relationships* between rules, not just literals —
  parsing the trigger margin and comparing it to the calc offset
  couples the two values so they cannot drift apart.
