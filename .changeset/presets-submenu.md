---
'@f8/core': patch
'@f8/ui': patch
'@f8/web': patch
---

The Add Adjustment button is gone: presets now live in an Image > Presets submenu (grouped by category, active preset checked, Save as Preset at the bottom), and Black & White is a regular always-visible section. Presets, saving, and copy/paste carry basic adjustments only — denoise and heal strokes stay with their photo and are never stored in or overwritten by a preset.

## Task writeup (docs/tasks/60-presets-submenu.md)

## Request

Remove the "Add Adjusment" button, I presume that's what Save as Preset
does, showing a menu of presets (in a submenu like we show zoom options
in the menu at the top) do. And make sure we don't copy denoise or heal
as an adjusments, it should just do the basic adjustments.

## Change

- `packages/ui/src/components/Inspector.tsx`: removed the
  `inspector-footer` "Add Adjustment" button, its dropdown menu
  (`addMenu`/`addMenuRef`), and the whole extra-sections mechanism
  (`extraSections`, `openedExtra`, `extraRevision`, `addSection`).
  Black & White — the only section the menu could add — now always
  renders as a plain section after Effects. Curves/Details/Effects keep
  `initiallyOpen={false}` explicitly: the old
  `initiallyOpen={openedExtra === ...}` was always false (the only
  addable name was 'Black & White'), and the shared section defaults to
  open. Save as Preset stays in the header ... menu.
- `packages/ui/src/components/Topbar.tsx`: new Image > Presets submenu
  following the zoom-options pattern — hover opens, click toggles for
  touch, a `data-submenu` parent, and a flyout grouped by the strip's
  categories (Essentials, Cinematic, Black & White, My Presets) with
  the active preset checked and `Save as Preset...` in its own section
  at the bottom (new `'save-preset'` MenuAction). The parent checks
  while the recipe is non-Original. ArrowRight/ArrowLeft now read the
  focused parent's `data-submenu` instead of hardcoding `zoom-lens`, so
  both flyouts share the one keyboard handler.
- `packages/core/src/data.ts`: new `presetValuesForEdit()` — the
  recipe minus geometry, heal strokes (`retouches`), and `denoise`.
- `apps/web/src/App.tsx`: `savePreset` and `copyAdjustments` both go
  through `presetValuesForEdit` (clipboard is now
  `Partial<EditState>`); new shared `selectPreset` for the strip and
  the submenu (re-picking the active preset reverts to Original, a
  menu pick from the library lands in the editor); `'save-preset'`
  opens the preset dialog; MenuBar receives
  `presetList`/`selectedPreset`/`onSelectPreset`.
- `packages/ui/src/hooks/useEditor.ts`: `applyPreset` preserves the
  target photo's `denoise` from its own recipe, so even a legacy
  custom preset saved with denoise cannot overwrite it (geometry and
  heal strokes were already preserved).
- `packages/ui/src/components/EditorDialogs.tsx`: the Save Preset note
  now reads "Crops, retouching, and denoise are not included."
- `apps/web/src/index.css`: removed the footer/button/menu rules;
  `.dropdown-menu.presets-submenu` caps at `min(60vh, 420px)` with a
  scroll so long preset lists stay in the viewport.

## Decisions

- **Black & White always visible, not moved into the ... menu.**
  Removing the footer had to leave the section reachable; it is a
  one-toggle basic adjustment, so rendering it unconditionally (after
  Effects) is simpler than a second home and matches every other
  section's contract.
- **Presets submenu in Image, after Enhance Faces.** Looks sit together
  (Auto/Scene/Faces + presets); Edit stays for undo/copy/paste
  mechanics. No new top-level menu.
- **Denoise preserved on apply, not reset.** Denoise is per-photo
  (ISO-keyed, re-run on reopen): applying a color look keeps the
  target's own strength rather than wiping it or taking the preset's.
- **Face/selective ML masks and enhance bookkeeping untouched.** The
  task names denoise and heal; masks ride their own flows and were left
  as-is rather than expanding scope.
- **One shared `selectPreset`.** The strip's toggle-off (re-click
  reverts to Original) now lives in App so the menu behaves
  identically; passing it to the strip is behavior-preserving because
  the strip resolves Original before calling.
- **No `dist/` in the commit.** `dist/` is gitignored but is what
  `@f8/*` imports resolve to locally, so core/ui were rebuilt for
  tests/typecheck/build; the rebuilds stay untracked.

## Tests

- `packages/core/src/data.test.ts` (new `presetValuesForEdit` block, 3
  tests): strips geometry/heal/denoise, keeps sliders/curves/selective
  color/B&W/enabled flags, omits denoise when absent. Core suite: 1119
  tests pass.
- `packages/ui/src/components/presetsSubmenu.test.tsx` (new, 16
  tests): no Add Adjustment markup/source/CSS, B&W unconditional, Save
  as Preset kept in header menu, submenu placement/parent/flyout
  grouping/checks/save entry, no new top-level menu, shared keyboard
  handling, flyout scroll rule, App wiring (save-preset action, menu
  props, shared picker, save/copy helper), apply-preserves-denoise,
  dialog note.
- Updated contract counts for the always-rendered section:
  `collapsePanels` (8→9 sections), `autoMlToggle` (12→13 switches),
  `adjustmentConsistency` (10→11 switches), `mlSections` (the only
  secondary button is B&W's labeled action), `detailsToggle` (stale
  comment), `topbarDropdownFlush` (footer-menu rule replaced with the
  flyout anchoring pin), `zoomLens` (generalized ArrowRight pin);
  deleted `addAdjustmentLayout.test.tsx` with the button. UI suite: 84
  files / 653 tests pass.
- `typecheck` clean for core, ui, and web; server suite 181 pass;
  `web build` succeeds. No Playwright, per the task rules.
