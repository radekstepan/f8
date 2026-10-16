---
'@f8/ui': patch
'@f8/web': patch
---

The Color Adjustments "..." menu gained a Saved Presets submenu listing your saved adjustment presets with the active one checked — pick one to apply it without opening the preset strip. The flyout opens left of the menu (the panel docks at the right edge) and scrolls once the list grows.

## Task writeup (docs/tasks/65-saved-presets-submenu.md)

## Request

I do not see where the saved preset for adjustments is. It should be in
the ... Saved Presets submenu.

## Change

- `packages/ui/src/components/Inspector.tsx`: the header ... menu
  gained a `Saved Presets` parent (new `savedPresets` /
  `selectedPreset` / `onSelectPreset` props) with a flyout following the
  Image > Presets pattern — hover opens, click toggles for touch,
  `data-submenu` parent, active preset checked, parent checked while a
  saved preset is the active look. An empty library renders a disabled
  "No saved presets yet" item instead of an empty flyout. Picking a
  preset applies it through the shared picker and dismisses the whole
  menu; `Save as Preset...` stays untouched directly below.
- `apps/web/src/App.tsx`: the Inspector receives
  `savedPresets={customPresets}`, `selectedPreset={editor.edit.preset}`,
  and the shared `selectPreset` (the same toggle-off picker the strip
  and the Image > Presets flyout use), so all three surfaces apply
  identically.
- `apps/web/src/index.css`: `.inspector-options .dropdown-submenu`
  opens left of the parent (the inspector docks at the right edge; the
  generic submenu rule opens right, which would run off the viewport);
  `.dropdown-menu.saved-presets-submenu` caps at `min(60vh, 320px)`
  with a scroll like the Image > Presets flyout.
- `packages/ui/src/components/savedPresetsSubmenu.test.tsx` (new, 11
  tests): parent markup/chevron/placement/checks, flyout listing with
  active check, empty state, hover/click wiring, dismiss resets,
  left-opening + scroll CSS, and the App wiring.

## Decisions

- **Saved Presets = the user's `customPresets` only.** The ... menu is
  the adjustments panel's own menu; built-ins already live in the
  preset strip and Image > Presets. Listing just the saved ones keeps
  the flyout short and answers "where did my preset go?".
- **Shared `selectPreset`, no second apply path.** Re-picking the
  active saved preset reverts to Original, exactly like the strip —
  one behavior to learn, no divergent code.
- **Ungated by tool.** Like `Save as Preset...`, the submenu shows in
  Crop/Repair too; applying a preset preserves geometry and retouching,
  so it is safe from any tool.
- **`initialMenuOpen` / `initialSubmenu` test seams.** The closed menu
  never renders in SSR (the autoEnhance.test.tsx precedent pins it from
  source instead); the seams follow the Filmstrip `initialContextMenu`
  precedent and let the new tests assert real open-menu markup.
- **`closeAction` left byte-identical.** It is pinned exactly by
  autoEnhance.test.tsx and still closes the menu for every existing
  item; the flyout resets through the ... toggle, the outside-dismiss
  `closeMenu`, and the pick handler, so it can never reopen stale.
- **No arrow-key flyout nav.** The ... menu has no arrow navigation
  today (unlike the top menu bar); adding it is a menu-wide change,
  left for a follow-up. The parent still exposes
  `aria-haspopup`/`aria-expanded` and the flyout `role="menu"`.
- **No README update.** Small additive menu wiring, no architecture
  change or complex feature.

## Tests

- New `savedPresetsSubmenu.test.tsx`: 11 tests pass.
- Full UI suite: 88 files / 699 tests pass (no existing test needed
  changes — the `closeAction` and `Save as Preset...` pins hold).
- `yarn typecheck` clean for all workspaces; `yarn test` (core + ui +
  server) green; `@f8/web` build succeeds. No Playwright, per the task
  rules.
